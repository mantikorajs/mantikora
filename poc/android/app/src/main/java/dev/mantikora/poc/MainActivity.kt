package dev.mantikora.poc

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import dev.mantikora.poc.host.WebViewHost
import dev.mantikora.poc.mirror.Events
import dev.mantikora.poc.mirror.MirrorNode
import dev.mantikora.poc.mirror.NodeStore
import dev.mantikora.poc.mirror.NodeView

class MainActivity : ComponentActivity() {
    private val store = NodeStore()
    private lateinit var host: WebViewHost

    private val events = object : Events {
        override fun send(node: MirrorNode, event: String, payload: String?): Int =
            if (event in node.listeners) host.sendEvent(event, node.id, payload) else 0

        override val acknowledged: Int get() = store.acknowledgedEvent
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        host = WebViewHost(this, onBatch = store::apply)
        setContent {
            MaterialTheme {
                Surface(Modifier.fillMaxSize()) {
                    Box(Modifier.safeDrawingPadding()) {
                        // The WebView stays attached and visible (1×1 px), so Chromium does not
                        // throttle its timers as it would for a hidden page.
                        AndroidView(factory = { host.webView }, modifier = Modifier.size(1.dp))
                        store.root?.let { NodeView(it, events) }
                    }
                }
            }
        }
        host.load()
    }

    override fun onDestroy() {
        host.destroy()
        super.onDestroy()
    }
}
