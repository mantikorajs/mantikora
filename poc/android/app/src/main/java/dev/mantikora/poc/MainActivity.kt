package dev.mantikora.poc

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import dev.mantikora.poc.host.Batch
import dev.mantikora.poc.host.WebViewHost

/** Node id of the counter's mk-button in the first batch (see app.spec.ts). */
private const val COUNTER_BUTTON = 5

class MainActivity : ComponentActivity() {
    private lateinit var host: WebViewHost

    /** Day 3: batches are only listed. Day 4 replaces this with the mirror tree. */
    private val received = mutableStateListOf<Batch>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        host = WebViewHost(this) { batch -> received.add(0, batch) }
        setContent {
            MaterialTheme {
                Surface(Modifier.fillMaxSize()) {
                    Box(Modifier.safeDrawingPadding()) {
                        // The WebView stays attached and visible (1×1 px), so Chromium does not
                        // throttle its timers as it would for a hidden page.
                        AndroidView(factory = { host.webView }, modifier = Modifier.size(1.dp))
                        BatchLog(
                            batches = received,
                            onTap = { host.sendEvent("tap", node = COUNTER_BUTTON) },
                        )
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

@Composable
private fun BatchLog(batches: List<Batch>, onTap: () -> Unit) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Batches: ${batches.size}", style = MaterialTheme.typography.titleMedium)
            Button(onClick = onTap) { Text("Send tap → node $COUNTER_BUTTON") }
        }
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(batches, key = { it.seq }) { batch ->
                Text(
                    text = "#${batch.seq} evt=${batch.evt} ops=${batch.ops.size}\n" +
                        batch.ops.joinToString("\n") { "  $it" },
                    fontFamily = FontFamily.Monospace,
                    fontSize = 12.sp,
                )
            }
        }
    }
}
