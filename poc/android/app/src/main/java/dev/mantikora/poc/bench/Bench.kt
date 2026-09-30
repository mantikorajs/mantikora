package dev.mantikora.poc.bench

import android.util.Log
import android.view.Choreographer
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import dev.mantikora.poc.host.Batch
import dev.mantikora.poc.host.Op
import dev.mantikora.poc.host.WebViewHost
import dev.mantikora.poc.mirror.NodeStore
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import java.util.Locale
import kotlin.coroutines.resume

/**
 * Phase 0 measurements M1–M3 (see PoC plan and poc/RESULTS.md). Native clock only.
 * Every batch goes through [apply], so M2 also covers the real batches from M1 and M3.
 */
class Bench(private val host: WebViewHost, private val store: NodeStore) {
    var status by mutableStateOf("M1 tap→frame · M2 batch apply · M3 stress")
        private set
    var running by mutableStateOf(false)
        private set

    private val typicalApplyMs = ArrayList<Double>()
    private var waiter: Waiter? = null

    private class Waiter(val seq: Int, val t0: Long, val done: CompletableDeferred<Double>)

    /** Applies a batch from the host and records how long it took on the main thread. */
    fun apply(batch: Batch) {
        val t = System.nanoTime()
        store.apply(batch)
        val ms = (System.nanoTime() - t) / 1e6
        if (batch.ops.size <= 50) typicalApplyMs += ms

        val w = waiter ?: return
        if (batch.evt >= w.seq) {
            waiter = null
            // The first frame after the batch: Compose draws the change in this frame.
            Choreographer.getInstance().postFrameCallback { w.done.complete((System.nanoTime() - w.t0) / 1e6) }
        }
    }

    /** M1: tap → first frame after the resulting batch, through the same path as the button. */
    suspend fun m1(taps: Int = 200) = measure {
        val button = store.find("mk-button") ?: return@measure "M1: no mk-button on screen"
        val samples = ArrayList<Double>(taps)
        for (i in 0 until taps) {
            val done = CompletableDeferred<Double>()
            val t0 = System.nanoTime()
            waiter = Waiter(host.sendEvent("tap", button.id), t0, done)
            val ms = withTimeoutOrNull(1_000) { done.await() }
            if (ms == null) {
                waiter = null
                return@measure "M1: tap $i got no batch within 1 s"
            }
            samples += ms
            status = "M1 ${i + 1}/$taps"
            delay(50)
        }
        "M1 tap→frame   n=$taps ${stats(samples)}"
    }

    /** M2: apply time of real batches (≤ 50 ops) and of a synthetic ~500-op batch. */
    suspend fun m2(runs: Int = 30, rows: Int = 125) = measure {
        val synthetic = ArrayList<Double>(runs)
        repeat(runs) { r ->
            val base = 1_000_000 + r * 1_000 // far from JS ids
            val ops = ArrayList<Op>(1 + rows * 4)
            ops += Op.Create(base, "mk-column", null)
            for (i in 0 until rows) {
                val el = base + 1 + i * 2
                ops += Op.Create(el, "mk-text", null)
                ops += Op.Text(el + 1, "row $i")
                ops += Op.Insert(el, el + 1, 0)
                ops += Op.Insert(base, el, i)
            }
            val t = System.nanoTime()
            store.apply(Batch(seq = -1, evt = store.acknowledgedEvent, ops = ops))
            synthetic += (System.nanoTime() - t) / 1e6
            store.apply(Batch(seq = -1, evt = store.acknowledgedEvent, ops = listOf(Op.Destroy(base))))
            delay(16)
        }
        "M2 typical     n=${typicalApplyMs.size} ${stats(typicalApplyMs)}\n" +
            "M2 ${1 + rows * 4} ops   n=$runs ${stats(synthetic)}"
    }

    /** M3: JS updates 60×/s and blocks 100 ms every second; native frames must keep coming. */
    suspend fun m3(seconds: Int = 30) = measure {
        host.runScript("__mantikoraBench.stress(${seconds * 1_000})")
        status = "M3 running ${seconds}s…"
        val deltas = ArrayList<Double>()
        val end = System.nanoTime() + seconds * 1_000_000_000L
        suspendCancellableCoroutine<Unit> { cont ->
            var last = 0L
            val callback = object : Choreographer.FrameCallback {
                override fun doFrame(frameTimeNanos: Long) {
                    if (last != 0L) deltas += (frameTimeNanos - last) / 1e6
                    last = frameTimeNanos
                    if (frameTimeNanos < end) Choreographer.getInstance().postFrameCallback(this) else cont.resume(Unit)
                }
            }
            Choreographer.getInstance().postFrameCallback(callback)
        }
        val interval = deltas.sorted()[deltas.size / 2]
        val janky = deltas.count { it > interval * 1.5 }
        "M3 stress ${seconds}s frames=${deltas.size} janky=$janky " +
            "(${fmt(100.0 * janky / deltas.size)}%) worst=${fmt(deltas.max())} ms interval≈${fmt(interval)} ms"
    }

    private suspend fun measure(block: suspend () -> String) {
        running = true
        try {
            status = block()
            Log.i(TAG, status)
        } finally {
            running = false
        }
    }

    private companion object {
        const val TAG = "MantikoraBench"

        fun stats(ms: List<Double>): String {
            if (ms.isEmpty()) return "no samples"
            val s = ms.sorted()
            fun p(q: Double) = s[((s.size - 1) * q).toInt()]
            return "p50=${fmt(p(0.5))} p95=${fmt(p(0.95))} max=${fmt(s.last())} ms"
        }

        fun fmt(v: Double) = String.format(Locale.US, "%.1f", v)
    }
}
