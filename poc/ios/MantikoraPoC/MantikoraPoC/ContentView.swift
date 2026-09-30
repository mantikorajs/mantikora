import SwiftUI
import WebKit

/// Wires the WebView host to the mirror tree.
@MainActor
final class AppModel: Events {
    let store: NodeStore
    private var host: WebViewHost!
    private var started = false

    init() {
        store = NodeStore()
        host = WebViewHost { [weak self] batch in self?.apply(batch) }
    }

    var webView: WKWebView { host.webView }

    func start() {
        guard !started else { return }
        started = true
        host.load()
    }

    func send(_ node: MirrorNode, _ event: String, _ payload: String?) -> Int {
        node.listeners.contains(event) ? host.sendEvent(event, node: node.id, payload: payload) : 0
    }

    var acknowledged: Int { store.acknowledgedEvent }

    private func apply(_ batch: Batch) {
        do {
            try store.apply(batch)
        } catch {
            #if DEBUG
            fatalError("Mantikora: \(error)")
            #else
            print("Mantikora: \(error)")
            #endif
        }
    }
}

@MainActor
struct ContentView: View {
    let model: AppModel

    var body: some View {
        ZStack(alignment: .topLeading) {
            // The WebView stays in the window and visible (1×1 pt), so WebKit does not
            // suspend its timers as it would for an offscreen page.
            WebViewContainer(webView: model.webView)
                .frame(width: 1, height: 1)
            if let root = model.store.root {
                VStack(alignment: .leading) {
                    NodeView(node: root, events: model)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        // Pin to the top like the Android host; a bare ZStack would center its content.
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .onAppear { model.start() }
    }
}

@MainActor
private struct WebViewContainer: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> WKWebView { webView }

    func updateUIView(_ webView: WKWebView, context: Context) {}
}
