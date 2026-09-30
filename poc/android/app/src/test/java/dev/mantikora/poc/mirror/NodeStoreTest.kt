package dev.mantikora.poc.mirror

import dev.mantikora.poc.host.Batch
import dev.mantikora.poc.host.Op
import dev.mantikora.poc.host.ProtocolException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class NodeStoreTest {
    /** The first batch of the counter app, exactly as app.spec.ts expects it. */
    private val counter = Batch(
        seq = 1, evt = 0,
        ops = listOf(
            Op.Create(1, "#host", "app-root"), Op.Root(1),
            Op.Create(2, "mk-column", null), Op.Prop(2, "spacing", 12), Op.Prop(2, "padding", 16),
            Op.Insert(1, 2, 0),
            Op.Create(3, "mk-text", null), Op.Prop(3, "variant", "title"), Op.Insert(2, 3, 0),
            Op.Text(4, ""), Op.Insert(3, 4, 0),
            Op.Create(5, "mk-button", null), Op.Insert(2, 5, 1), Op.Listen(5, "tap"),
            Op.Text(6, "Increment"), Op.Insert(5, 6, 0),
            Op.Create(7, "mk-text-field", null), Op.Prop(7, "label", "Name"), Op.Insert(2, 7, 2),
            Op.Listen(7, "change"),
            Op.Create(8, "mk-text", null), Op.Insert(2, 8, 3), Op.Text(9, ""), Op.Insert(8, 9, 0),
            Op.SetText(4, "Clicked 0 times"), Op.Prop(7, "value", ""), Op.SetText(9, "Hello "),
        ),
    )

    @Test
    fun `counter renders the same tree as the TypeScript reference mirror`() {
        val store = NodeStore()
        store.apply(counter)
        assertEquals(
            listOf(
                "mk-column padding=16 spacing=12",
                "  mk-text variant=\"title\" \"Clicked 0 times\"",
                "  mk-button \"Increment\" (tap)",
                "  mk-text-field label=\"Name\" value=\"\" (change)",
                "  mk-text \"Hello \"",
            ).joinToString("\n"),
            store.render(),
        )
    }

    @Test
    fun `setText changes only the text`() {
        val store = NodeStore()
        store.apply(counter)
        store.apply(Batch(2, 1, listOf(Op.SetText(4, "Clicked 1 times"))))
        assertEquals("Clicked 1 times", store.node(3).content)
        assertEquals(1, store.acknowledgedEvent)
    }

    @Test
    fun `insert of an attached node moves it`() {
        val store = NodeStore()
        store.apply(counter)
        store.apply(Batch(2, 0, listOf(Op.Insert(2, 8, 0))))
        assertEquals(listOf(8, 3, 5, 7), store.node(2).children.map { it.id })
    }

    @Test
    fun `destroy frees the whole subtree and detaches it`() {
        val store = NodeStore()
        store.apply(counter)
        val before = store.size
        store.apply(Batch(2, 0, listOf(Op.Destroy(5))))
        assertEquals(before - 2, store.size)
        assertEquals(listOf(3, 7, 8), store.node(2).children.map { it.id })
    }

    @Test
    fun `null prop resets to default`() {
        val store = NodeStore()
        store.apply(counter)
        store.apply(Batch(2, 0, listOf(Op.Prop(2, "spacing", null))))
        assertEquals(setOf("padding"), store.node(2).props.keys)
    }

    @Test
    fun `protocol errors name the batch and op`() {
        val store = NodeStore()
        store.apply(counter)
        val cases = listOf(
            Op.Create(99, "mk-card", null) to "unknown type mk-card",
            Op.SetText(99, "x") to "unknown id 99",
            Op.Create(2, "mk-text", null) to "id 2 already exists",
            Op.Insert(2, 4, 9) to "index 9 out of range",
            Op.Prop(3, "size", 12) to "mk-text has no prop size",
            Op.SetText(3, "x") to "#3 is not text",
        )
        for ((op, message) in cases) {
            val e = assertThrows(ProtocolException::class.java) { store.apply(Batch(2, 0, listOf(op))) }
            assertEquals("batch 2 op 0 $op: $message", e.message)
        }
    }
}
