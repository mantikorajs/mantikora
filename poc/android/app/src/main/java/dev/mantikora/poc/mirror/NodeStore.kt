package dev.mantikora.poc.mirror

import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.Snapshot
import dev.mantikora.poc.host.Batch
import dev.mantikora.poc.host.Op
import dev.mantikora.poc.host.ProtocolException

/**
 * One node of the native mirror tree. Props, children and text are snapshot state,
 * so Compose recomposes only the NodeViews that read what a batch changed.
 */
@Stable
class MirrorNode(val id: Int, val type: String, val tag: String?) {
    val props = mutableStateMapOf<String, Any?>()
    val children = mutableStateListOf<MirrorNode>()
    var text by mutableStateOf("")

    /** Main-thread only, read at event time; not rendered, so not state. */
    val listeners = mutableSetOf<String>()
    var parent: MirrorNode? = null
        internal set

    /** Content of mk-text and label of mk-button: the concatenation of their text children. */
    val content: String get() = children.joinToString("") { it.text }
}

/** Applies protocol v0 batches to the mirror tree. See poc/PROTOCOL.md; must behave like reference-mirror.ts. */
class NodeStore {
    private val nodes = HashMap<Int, MirrorNode>()
    var root by mutableStateOf<MirrorNode?>(null)
        private set

    /** `evt` of the last applied batch: every native event up to this seq has been handled by JS. */
    var acknowledgedEvent by mutableIntStateOf(0)
        private set

    val size: Int get() = nodes.size

    /** Applies the whole batch in one mutable snapshot, so Compose never sees half a batch. */
    fun apply(batch: Batch) {
        Snapshot.withMutableSnapshot {
            batch.ops.forEachIndexed { i, op ->
                try {
                    applyOp(op)
                } catch (e: Exception) {
                    throw ProtocolException("batch ${batch.seq} op $i $op: ${e.message}", e)
                }
            }
            acknowledgedEvent = batch.evt
        }
    }

    fun node(id: Int): MirrorNode = nodes[id] ?: throw ProtocolException("unknown id $id")

    private fun applyOp(op: Op) {
        when (op) {
            is Op.Create -> {
                if (op.type != HOST && op.type !in Catalog.types) throw ProtocolException("unknown type ${op.type}")
                add(MirrorNode(op.id, op.type, op.tag))
            }
            is Op.Text -> add(MirrorNode(op.id, TEXT, null).also { it.text = op.value })
            is Op.SetText -> {
                val node = node(op.id)
                if (node.type != TEXT) throw ProtocolException("#${op.id} is not text")
                node.text = op.value
            }
            is Op.Insert -> {
                val parent = node(op.parent)
                val child = node(op.child)
                // Validate before mutating: the index counts siblings after the child is detached.
                val size = parent.children.size - if (child.parent === parent) 1 else 0
                if (op.index !in 0..size) throw ProtocolException("index ${op.index} out of range")
                if (child.parent != null) detach(child)
                parent.children.add(op.index, child)
                child.parent = parent
            }
            is Op.Remove -> {
                val node = node(op.id)
                if (node.parent == null) throw ProtocolException("#${op.id} is not attached")
                detach(node)
            }
            is Op.Destroy -> {
                val node = node(op.id)
                if (node.parent != null) detach(node)
                free(node)
                if (root === node) root = null
            }
            is Op.Prop -> {
                val node = node(op.id)
                if (!Catalog.hasProp(node.type, op.name)) throw ProtocolException("${node.type} has no prop ${op.name}")
                if (op.value == null) node.props.remove(op.name) else node.props[op.name] = op.value
            }
            is Op.Listen -> node(op.id).listeners += op.event
            is Op.Unlisten -> node(op.id).listeners -= op.event
            is Op.Root -> root = node(op.id)
        }
    }

    private fun add(node: MirrorNode) {
        if (nodes.containsKey(node.id)) throw ProtocolException("id ${node.id} already exists")
        nodes[node.id] = node
    }

    private fun detach(node: MirrorNode) {
        node.parent!!.children.remove(node)
        node.parent = null
    }

    private fun free(node: MirrorNode) {
        nodes.remove(node.id)
        node.children.forEach(::free)
    }

    /** The tree as it is drawn, in the same format as ReferenceMirror.render() in TypeScript. */
    fun render(): String {
        val lines = mutableListOf<String>()
        fun visit(node: MirrorNode, depth: Int) {
            if (node.type == HOST) return node.children.forEach { visit(it, depth) }
            val parts = mutableListOf(node.type)
            node.props.entries.sortedBy { it.key }.forEach { (k, v) -> parts += "$k=${json(v)}" }
            if (Catalog.holds(node.type) == Catalog.Holds.TEXT) parts += json(node.content)
            if (node.listeners.isNotEmpty()) parts += "(${node.listeners.sorted().joinToString(", ")})"
            lines += "  ".repeat(depth) + parts.joinToString(" ")
            if (Catalog.holds(node.type) == Catalog.Holds.NODES) node.children.forEach { visit(it, depth + 1) }
        }
        root?.let { visit(it, 0) }
        return lines.joinToString("\n")
    }

    private fun json(value: Any?): String = when (value) {
        is String -> "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
        else -> value.toString()
    }

    companion object {
        const val HOST = "#host"
        const val TEXT = "#text"
    }
}
