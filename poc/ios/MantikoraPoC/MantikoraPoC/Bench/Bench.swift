import QuartzCore
import SwiftUI
import os

/// Phase 0 measurements M1–M3 (see PoC plan and poc/RESULTS.md). Native clock only.
/// Every batch goes through `apply`, so M2 also covers the real batches from M1 and M3.
@MainActor
@Observable
final class Bench {
    private(set) var status = "M1 tap→frame · M2 batch apply · M3 stress"
    private(set) var running = false

    private let host: WebViewHost
    private let store: NodeStore
    @ObservationIgnored private var typicalApplyMs: [Double] = []
    @ObservationIgnored private var waiter: (seq: Int, t0: CFTimeInterval, done: CheckedContinuation<Double?, Never>)?
    private let log = Logger(subsystem: "dev.mantikora.poc", category: "bench")

    init(host: WebViewHost, store: NodeStore) {
        self.host = host
        self.store = store
    }

    /// Applies a batch from the host and records how long it took on the main thread.
    func apply(_ batch: Batch) throws {
        let t = CACurrentMediaTime()
        try store.apply(batch)
        let ms = (CACurrentMediaTime() - t) * 1000
        if batch.ops.count <= 50 { typicalApplyMs.append(ms) }

        guard let w = waiter, batch.evt >= w.seq else { return }
        waiter = nil
        // The first frame after the batch: SwiftUI draws the change in this frame.
        DisplayLinkProxy.run { _ in
            w.done.resume(returning: (CACurrentMediaTime() - w.t0) * 1000)
            return false
        }
    }

    /// M1: tap → first frame after the resulting batch, through the same path as the button.
    func m1(taps: Int = 200) async {
        await measure {
            guard let button = self.store.find("mk-button") else { return "M1: no mk-button on screen" }
            var samples: [Double] = []
            for i in 0..<taps {
                // Swift 5.10: the continuation body is not main-actor isolated, so re-enter explicitly.
                let ms: Double? = await withCheckedContinuation { cont in
                    MainActor.assumeIsolated {
                        let t0 = CACurrentMediaTime()
                        let seq = self.host.sendEvent("tap", node: button.id)
                        self.waiter = (seq, t0, cont)
                        Task { @MainActor in
                            try? await Task.sleep(nanoseconds: 1_000_000_000)
                            if let w = self.waiter, w.seq == seq {
                                self.waiter = nil
                                w.done.resume(returning: nil)
                            }
                        }
                    }
                }
                guard let ms else { return "M1: tap \(i) got no batch within 1 s" }
                samples.append(ms)
                self.status = "M1 \(i + 1)/\(taps)"
                try? await Task.sleep(nanoseconds: 50_000_000)
            }
            return "M1 tap→frame   n=\(taps) \(Self.stats(samples))"
        }
    }

    /// M2: apply time of real batches (≤ 50 ops) and of a synthetic ~500-op batch.
    func m2(runs: Int = 30, rows: Int = 125) async {
        await measure {
            var synthetic: [Double] = []
            for r in 0..<runs {
                let base = 1_000_000 + r * 1_000 // far from JS ids
                var ops: [Op] = [.create(id: base, type: "mk-column", tag: nil)]
                for i in 0..<rows {
                    let el = base + 1 + i * 2
                    ops += [
                        .create(id: el, type: "mk-text", tag: nil),
                        .text(id: el + 1, value: "row \(i)"),
                        .insert(parent: el, child: el + 1, index: 0),
                        .insert(parent: base, child: el, index: i),
                    ]
                }
                let evt = self.store.acknowledgedEvent
                let t = CACurrentMediaTime()
                try? self.store.apply(Batch(seq: -1, evt: evt, ops: ops))
                synthetic.append((CACurrentMediaTime() - t) * 1000)
                try? self.store.apply(Batch(seq: -1, evt: evt, ops: [.destroy(id: base)]))
                try? await Task.sleep(nanoseconds: 16_000_000)
            }
            return "M2 typical     n=\(self.typicalApplyMs.count) \(Self.stats(self.typicalApplyMs))\n"
                + "M2 \(1 + rows * 4) ops   n=\(runs) \(Self.stats(synthetic))"
        }
    }

    /// M3: JS updates 60×/s and blocks 100 ms every second; native frames must keep coming.
    func m3(seconds: Int = 30) async {
        await measure {
            self.host.runScript("__mantikoraBench.stress(\(seconds * 1000))")
            self.status = "M3 running \(seconds)s…"
            let deltas: [Double] = await withCheckedContinuation { cont in
                MainActor.assumeIsolated {
                    var deltas: [Double] = []
                    var last: CFTimeInterval = 0
                    let end = CACurrentMediaTime() + Double(seconds)
                    DisplayLinkProxy.run { link in
                        if last != 0 { deltas.append((link.timestamp - last) * 1000) }
                        last = link.timestamp
                        if link.timestamp < end { return true }
                        cont.resume(returning: deltas)
                        return false
                    }
                }
            }
            let interval = deltas.sorted()[deltas.count / 2]
            let janky = deltas.filter { $0 > interval * 1.5 }.count
            return "M3 stress \(seconds)s frames=\(deltas.count) janky=\(janky) "
                + "(\(Self.fmt(100 * Double(janky) / Double(deltas.count)))%) "
                + "worst=\(Self.fmt(deltas.max() ?? 0)) ms interval≈\(Self.fmt(interval)) ms"
        }
    }

    private func measure(_ block: () async -> String) async {
        running = true
        defer { running = false }
        status = await block()
        log.info("\(self.status, privacy: .public)")
    }

    private static func stats(_ ms: [Double]) -> String {
        guard !ms.isEmpty else { return "no samples" }
        let s = ms.sorted()
        func p(_ q: Double) -> Double { s[Int(Double(s.count - 1) * q)] }
        return "p50=\(fmt(p(0.5))) p95=\(fmt(p(0.95))) max=\(fmt(s.last!)) ms"
    }

    private static func fmt(_ v: Double) -> String { String(format: "%.1f", v) }
}

/// Calls `onFrame` on every display refresh until it returns false.
@MainActor
private final class DisplayLinkProxy: NSObject {
    private let onFrame: (CADisplayLink) -> Bool

    private init(_ onFrame: @escaping (CADisplayLink) -> Bool) {
        self.onFrame = onFrame
    }

    static func run(_ onFrame: @escaping (CADisplayLink) -> Bool) {
        let proxy = DisplayLinkProxy(onFrame)
        let link = CADisplayLink(target: proxy, selector: #selector(tick))
        link.add(to: .main, forMode: .common)
    }

    @objc private func tick(_ link: CADisplayLink) {
        if !onFrame(link) { link.invalidate() }
    }
}

/// Host-only panel for the Phase 0 measurements. Not part of the rendered app.
@MainActor
struct BenchPanel: View {
    let bench: Bench

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Divider()
            HStack(spacing: 8) {
                Button("M1") { Task { await bench.m1() } }
                Button("M2") { Task { await bench.m2() } }
                Button("M3") { Task { await bench.m3() } }
                // Spins on the main thread: a visual check that native frames keep coming during M3.
                if bench.running { ProgressView() }
            }
            .buttonStyle(.bordered)
            .disabled(bench.running)
            Text(bench.status)
                .font(.system(size: 11, design: .monospaced))
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 16)
    }
}
