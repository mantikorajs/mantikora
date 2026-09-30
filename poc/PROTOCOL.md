# Mantikora Protocol v0

Status: draft for the Phase 0 PoC. It covers exactly what the counter app needs and nothing more.

## 1. Model

- **JS owns the tree.** Angular runs in JS; our renderer turns Renderer2 calls into protocol ops.
- **JS keeps a shadow tree** of every node the renderer creates, including comments and nodes native never sees. All synchronous Renderer2 queries (`parentNode`, `nextSibling`) are answered from it. Native is never queried synchronously.
- **Native keeps a mirror tree** of the nodes it receives and renders it with Compose or SwiftUI.
- Two message kinds, one per direction: **batches** (JS → native) and **events** (native → JS). Every message is one UTF-8 JSON string.

## 2. Transport

| Host | JS → native | native → JS |
|---|---|---|
| Android WebView | `MantikoraAndroid.post(json)` (`@JavascriptInterface`) | `webView.evaluateJavascript("__mantikora.receive(" + quoted + ")")` |
| iOS WKWebView | `webkit.messageHandlers.mantikora.postMessage(json)` | `webView.evaluateJavaScript("__mantikora.receive(" + quoted + ")")` |
| iOS JSC (week 3) | global `__mantikoraPost(json)`, injected by the host | `__mantikora.receive(json)` called on the `JSContext` |

`quoted` is the JSON message encoded as a JS string literal, so `receive` always gets a string.

The JS side sees a single interface, so the renderer does not know which host it runs in:

```ts
interface MantikoraHost {
  post(json: string): void;
}
// The host delivers events by calling globalThis.__mantikora.receive(json: string).
```

Threading:
- Android calls `@JavascriptInterface` methods on a background thread. The host posts the batch to the main thread before applying it.
- `evaluateJavascript` / `evaluateJavaScript` are called on the main thread.

## 3. Batch (JS → native)

```json
{ "v": 0, "batch": 7, "evt": 12, "ops": [ ["setText", 4, "Clicked 3 times"] ] }
```

| Field | Meaning |
|---|---|
| `v` | Protocol version. Native rejects anything other than `0`. |
| `batch` | Sequence number: starts at 1, +1 per batch. Native rejects gaps. |
| `evt` | `seq` of the last native event JS had handled when the batch was flushed, `0` if none. Used only for measuring M1. |
| `ops` | Ops, applied in order. |

Rules:
- **One batch per change-detection cycle.** The renderer buffers ops and flushes them in a microtask scheduled by the outermost `RendererFactory2.end()`, so every view checked in one tick lands in one batch. Ops produced outside a cycle (bootstrap creation) wait for the next cycle; Angular always runs one right after bootstrap. Empty batches are not sent.
- **Atomic apply.** Native applies the whole batch before the next frame: on Android inside one `Snapshot.withMutableSnapshot`, on iOS in one `@MainActor` pass.

## 4. Nodes

- **Ids** are positive integers assigned by JS, monotonic, and never reused within a session.
- **Kinds:**
  - **element**: a catalog type (`mk-column`, `mk-text`, `mk-button`, `mk-text-field`).
  - **host**: a component host element (a tag containing `-` that does not start with `mk-`). It renders transparently: its children render as if they sat directly in the host's parent, at the host's position. The tag is kept for debugging only.
  - **text**: a string. Only visible as a child of `mk-text` or `mk-button`.
- **Never sent:** comments (`createComment`, which Angular uses as anchors for `@if` / `@for`). They exist only in the shadow tree.
- **Whitespace text:** a whitespace-only text node inserted into a parent that cannot hold text is kept in the shadow tree but never inserted on the native side. If it later becomes non-whitespace, the renderer throws.
- **Insert index** is the child's position among the parent's native-visible children (elements, hosts, visible text), computed by JS from the shadow tree. A host counts as one child; native flattens it at render time.

## 5. Ops

| Op | Shape | Renderer2 |
|---|---|---|
| create | `["create", id, type]`, or `["create", id, "#host", tag]` | `createElement` |
| text | `["text", id, value]` | `createText` |
| setText | `["setText", id, value]` | `setValue` |
| insert | `["insert", parent, child, index]` | `appendChild`, `insertBefore` |
| remove | `["remove", id]` | `removeChild` |
| destroy | `["destroy", id]` | `destroyNode` |
| prop | `["prop", id, name, value]` | `setAttribute`, `setProperty` |
| listen | `["listen", id, event]` | `listen` |
| unlisten | `["unlisten", id, event]` | the function `listen` returns |
| root | `["root", id]` | `selectRootElement` |

Semantics:
- `insert` of a node that is already attached **moves** it: native detaches it first, then inserts it at `index`.
- `remove` detaches a node. The node and its subtree stay alive and can be inserted again.
- `destroy` frees the node **and its whole subtree**. If the node is still attached, native detaches it first. Angular calls `destroyNode` only for the root nodes of a destroyed view, never for their descendants.
- JS sends no ops for a destroyed node, including `unlisten` during Angular's cleanup.
- `prop` values are JSON: number, string, boolean or `null`. `null` resets the prop to its default.
- `root` sets the mirror root. It is normally the host node of the bootstrapped component.

Changes from the PoC plan: `remove` takes only the child, because Angular may call `removeChild` without a parent. `destroy` is new.

The reference implementation of the native side is `angular/src/renderer/testing/reference-mirror.ts`. The Kotlin and Swift mirror trees must behave the same way.

### Errors

v0 fails loudly and never recovers.
- **Renderer (JS) throws on:** unknown `mk-*` tag, tag without `-`, unknown prop, `addClass`, `removeClass`, `setStyle`, `removeStyle`, non-whitespace text under a parent that cannot hold text.
- **Native crashes (debug) or logs and drops the batch (release) on:** wrong `v`, batch gap, unknown op, unknown id, unknown type, wrong prop type. The error message includes the batch number and the op index.

## 6. Catalog v0

Units are dp on Android and pt on iOS.

| Element | Props | Children | Events | Compose | SwiftUI |
|---|---|---|---|---|---|
| `mk-column` | `spacing: number = 0`, `padding: number = 0` | elements, hosts | — | `Column(verticalArrangement = Arrangement.spacedBy(...))` | `VStack(spacing:)` |
| `mk-text` | `variant: "body" \| "title" = "body"` | text only | — | `Text` | `Text` |
| `mk-button` | `disabled: boolean = false` | text only (the label) | `tap` | `Button { Text }` | `Button` |
| `mk-text-field` | `label: string = ""`, `value: string = ""` | none | `change` | `OutlinedTextField` with local state | `TextField` with local `@State` |

The content of `mk-text` and the label of `mk-button` are the concatenation of their text children.

`mk-text` uses `variant`, not `style`: Angular treats a static `style` attribute as CSS, and that would hit `setStyle`.

**Attributes.** Static attributes arrive through `setAttribute` as strings. The renderer coerces them using the catalog type:
- number: `Number(value)`, and throws on `NaN`
- boolean: `""` or `"true"` becomes `true`, `"false"` becomes `false`

The renderer ignores `ng-version` and `ng-reflect-*`.

## 7. Events (native → JS)

```json
{ "v": 0, "seq": 12, "event": "tap", "node": 4 }
{ "v": 0, "seq": 13, "event": "change", "node": 5, "payload": "abc" }
```

- `seq` is assigned by native: it starts at 1 and goes up by 1 per event.
- Native sends events only for pairs registered with `listen`. Everything else is dropped on the native side.
- JS calls the listener with `payload` as `$event` (`undefined` for `tap`). Angular's listener wrapper schedules change detection. The resulting batch carries `evt = seq`.

## 8. Text field ownership

- The native text field keeps its own state (`TextFieldValue` in Compose, `@State` in SwiftUI).
- Every user edit sends `change` with the full text.
- **While focused**, an incoming `prop value` is stored as pending and not applied. This prevents cursor jumps and lost characters.
- **On blur**, a pending value that differs from the local text is applied.
- **While not focused**, `prop value` is applied immediately.

## 9. Example: counter

```html
<mk-column spacing="12" padding="16">
  <mk-text variant="title">Clicked {{ count() }} times</mk-text>
  <mk-button (tap)="count.set(count() + 1)">Increment</mk-button>
  <mk-text-field label="Name" [value]="name()" (change)="name.set($event)" />
  <mk-text>Hello {{ name() }}</mk-text>
</mk-column>
```

First batch. It is illustrative: the exact op order follows Angular's creation and update passes.

```json
{ "v": 0, "batch": 1, "evt": 0, "ops": [
  ["create", 1, "#host", "app-root"], ["root", 1],
  ["create", 2, "mk-column"], ["prop", 2, "spacing", 12], ["prop", 2, "padding", 16],
  ["create", 3, "mk-text"], ["prop", 3, "variant", "title"],
  ["text", 4, ""], ["insert", 3, 4, 0], ["insert", 2, 3, 0],
  ["create", 5, "mk-button"], ["listen", 5, "tap"],
  ["text", 6, "Increment"], ["insert", 5, 6, 0], ["insert", 2, 5, 1],
  ["create", 7, "mk-text-field"], ["prop", 7, "label", "Name"], ["listen", 7, "change"], ["insert", 2, 7, 2],
  ["create", 8, "mk-text"], ["text", 9, ""], ["insert", 8, 9, 0], ["insert", 2, 8, 3],
  ["insert", 1, 2, 0],
  ["setText", 4, "Clicked 0 times"], ["prop", 7, "value", ""], ["setText", 9, "Hello "]
]}
```

A tap and the batch it produces:

```json
{ "v": 0, "seq": 1, "event": "tap", "node": 5 }
{ "v": 0, "batch": 2, "evt": 1, "ops": [ ["setText", 4, "Clicked 1 times"] ] }
```

## 10. Not in v0

Binary encoding, keyed lists and virtualization, navigation, styles and theming, layout measurement sent back to JS, synchronous calls, multiple roots, error recovery, version negotiation.

## 11. Open for Day 2

- How templates declare `mk-*` elements to the Angular compiler:
  - **`CUSTOM_ELEMENTS_SCHEMA`**: fast; the closed vocabulary is checked only at runtime, in the renderer.
  - **One empty directive per element**: the compiler checks the vocabulary.
  - PoC default: `CUSTOM_ELEMENTS_SCHEMA`.
