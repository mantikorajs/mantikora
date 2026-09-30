package dev.mantikora.poc.mirror

/** Catalog v0 on the native side — see poc/PROTOCOL.md §6. */
object Catalog {
    enum class Holds { NODES, TEXT, NONE }

    private class Spec(val props: Set<String>, val holds: Holds)

    private val specs = mapOf(
        "mk-column" to Spec(setOf("spacing", "padding"), Holds.NODES),
        "mk-text" to Spec(setOf("variant"), Holds.TEXT),
        "mk-button" to Spec(setOf("disabled"), Holds.TEXT),
        "mk-text-field" to Spec(setOf("label", "value"), Holds.NONE),
    )

    val types: Set<String> get() = specs.keys

    fun hasProp(type: String, name: String): Boolean = specs[type]?.props?.contains(name) == true

    /** Hosts are transparent and hold nodes. */
    fun holds(type: String): Holds = specs[type]?.holds ?: Holds.NODES
}
