package dev.mantikora.poc.host

import org.json.JSONArray
import org.json.JSONObject

/** Mantikora protocol v0 — see poc/PROTOCOL.md. */
object Protocol {
    const val VERSION = 0

    fun parseBatch(json: String): Batch {
        val obj = JSONObject(json)
        val v = obj.getInt("v")
        if (v != VERSION) throw ProtocolException("unsupported protocol version $v")
        val seq = obj.getInt("batch")
        val raw = obj.getJSONArray("ops")
        val ops = ArrayList<Op>(raw.length())
        for (i in 0 until raw.length()) {
            val op = raw.getJSONArray(i)
            try {
                ops += parseOp(op)
            } catch (e: Exception) {
                throw ProtocolException("batch $seq op $i $op: ${e.message}", e)
            }
        }
        return Batch(seq = seq, evt = obj.getInt("evt"), ops = ops)
    }

    fun eventJson(seq: Int, event: String, node: Int, payload: String?): String =
        JSONObject()
            .put("v", VERSION)
            .put("seq", seq)
            .put("event", event)
            .put("node", node)
            .apply { if (payload != null) put("payload", payload) }
            .toString()

    private fun parseOp(op: JSONArray): Op = when (val name = op.getString(0)) {
        "create" -> Op.Create(op.getInt(1), op.getString(2), op.optString(3).ifEmpty { null })
        "text" -> Op.Text(op.getInt(1), op.getString(2))
        "setText" -> Op.SetText(op.getInt(1), op.getString(2))
        "insert" -> Op.Insert(op.getInt(1), op.getInt(2), op.getInt(3))
        "remove" -> Op.Remove(op.getInt(1))
        "destroy" -> Op.Destroy(op.getInt(1))
        "prop" -> Op.Prop(op.getInt(1), op.getString(2), op.get(3).takeUnless { it == JSONObject.NULL })
        "listen" -> Op.Listen(op.getInt(1), op.getString(2))
        "unlisten" -> Op.Unlisten(op.getInt(1), op.getString(2))
        "root" -> Op.Root(op.getInt(1))
        else -> throw ProtocolException("unknown op \"$name\"")
    }
}

data class Batch(val seq: Int, val evt: Int, val ops: List<Op>)

sealed interface Op {
    data class Create(val id: Int, val type: String, val tag: String?) : Op
    data class Text(val id: Int, val value: String) : Op
    data class SetText(val id: Int, val value: String) : Op
    data class Insert(val parent: Int, val child: Int, val index: Int) : Op
    data class Remove(val id: Int) : Op
    data class Destroy(val id: Int) : Op

    /** [value] is Int, Double, String, Boolean or null (reset to default). */
    data class Prop(val id: Int, val name: String, val value: Any?) : Op
    data class Listen(val id: Int, val event: String) : Op
    data class Unlisten(val id: Int, val event: String) : Op
    data class Root(val id: Int) : Op
}

class ProtocolException(message: String, cause: Throwable? = null) : RuntimeException(message, cause)
