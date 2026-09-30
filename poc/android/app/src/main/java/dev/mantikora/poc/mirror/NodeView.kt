package dev.mantikora.poc.mirror

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** What NodeViews need from the host. */
interface Events {
    /** Sends a native event if the node listens for it. Returns its seq, or 0 when nothing was sent. */
    fun send(node: MirrorNode, event: String, payload: String?): Int

    /** Seq of the last event JS has handled (the `evt` of the last applied batch). Snapshot state. */
    val acknowledged: Int
}

/** Draws one mirror node as idiomatic Compose. Hosts draw their children in place. */
@Composable
fun NodeView(node: MirrorNode, events: Events) {
    when (node.type) {
        NodeStore.HOST -> Children(node, events)

        "mk-column" -> Column(
            modifier = Modifier.padding(node.dp("padding")),
            verticalArrangement = Arrangement.spacedBy(node.dp("spacing")),
        ) {
            Children(node, events)
        }

        "mk-text" -> Text(
            text = node.content,
            style = if (node.props["variant"] == "title") {
                MaterialTheme.typography.titleLarge
            } else {
                MaterialTheme.typography.bodyLarge
            },
        )

        "mk-button" -> Button(
            onClick = { events.send(node, "tap", null) },
            enabled = node.props["disabled"] != true,
        ) {
            Text(node.content)
        }

        "mk-text-field" -> TextFieldNode(node, events)

        else -> error("NodeView cannot draw ${node.type}")
    }
}

/**
 * Native-owned text field (PROTOCOL.md §8). The field keeps its own TextFieldValue, so cursor,
 * selection and IME composition never round-trip through JS. The JS `value` is applied only
 * when the field is not focused and JS has handled every change this field sent.
 */
@Composable
private fun TextFieldNode(node: MirrorNode, events: Events) {
    val jsValue = node.props["value"] as? String ?: ""
    var local by remember(node) { mutableStateOf(TextFieldValue(jsValue, TextRange(jsValue.length))) }
    var focused by remember(node) { mutableStateOf(false) }
    var lastSent by remember(node) { mutableIntStateOf(0) }
    val acknowledged = events.acknowledged

    LaunchedEffect(jsValue, focused, acknowledged) {
        if (!focused && acknowledged >= lastSent && jsValue != local.text) {
            local = TextFieldValue(jsValue, TextRange(jsValue.length))
        }
    }

    OutlinedTextField(
        value = local,
        onValueChange = { next ->
            val textChanged = next.text != local.text
            local = next // cursor and composition changes stay native
            if (textChanged) {
                val seq = events.send(node, "change", next.text)
                if (seq > 0) lastSent = seq
            }
        },
        label = { Text(node.props["label"] as? String ?: "") },
        modifier = Modifier.onFocusChanged { focused = it.isFocused },
    )
}

@Composable
private fun Children(node: MirrorNode, events: Events) {
    for (child in node.children) {
        key(child.id) { NodeView(child, events) }
    }
}

private fun MirrorNode.dp(name: String): Dp = ((props[name] as? Number)?.toFloat() ?: 0f).dp
