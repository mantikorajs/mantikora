package dev.mantikora.poc.bench

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

/** Host-only panel for the Phase 0 measurements. Not part of the rendered app. */
@Composable
fun BenchPanel(bench: Bench) {
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxWidth()) {
        HorizontalDivider()
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedButton(onClick = { scope.launch { bench.m1() } }, enabled = !bench.running) { Text("M1") }
            OutlinedButton(onClick = { scope.launch { bench.m2() } }, enabled = !bench.running) { Text("M2") }
            OutlinedButton(onClick = { scope.launch { bench.m3() } }, enabled = !bench.running) { Text("M3") }
            // Spins on the main thread: a visual check that native frames keep coming during M3.
            if (bench.running) CircularProgressIndicator(Modifier.size(24.dp))
        }
        Text(
            text = bench.status,
            modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp),
            fontFamily = FontFamily.Monospace,
            fontSize = 11.sp,
        )
    }
}
