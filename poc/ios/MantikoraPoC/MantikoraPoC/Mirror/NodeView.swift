import SwiftUI

/// What NodeViews need from the host.
@MainActor
protocol Events: AnyObject {
    /// Sends a native event if the node listens for it. Returns its seq, or 0 when nothing was sent.
    func send(_ node: MirrorNode, _ event: String, _ payload: String?) -> Int

    /// Seq of the last event JS has handled (the `evt` of the last applied batch). Observed.
    var acknowledged: Int { get }
}

/// Draws one mirror node as idiomatic SwiftUI. Hosts draw their children in place.
@MainActor
struct NodeView: View {
    let node: MirrorNode
    let events: any Events

    var body: some View {
        switch node.type {
        case NodeStore.host:
            ForEach(node.children) { NodeView(node: $0, events: events) }

        case "mk-column":
            VStack(alignment: .leading, spacing: node.points("spacing")) {
                ForEach(node.children) { NodeView(node: $0, events: events) }
            }
            .padding(node.points("padding"))

        case "mk-text":
            Text(node.content)
                .font(node.props["variant"] == .string("title") ? .title2 : .body)

        case "mk-button":
            Button(node.content) { _ = events.send(node, "tap", nil) }
                .buttonStyle(.borderedProminent)
                .disabled(node.props["disabled"] == .bool(true))

        case "mk-text-field":
            TextFieldNode(node: node, events: events)

        default:
            Text("Unknown node \(node.type)").foregroundStyle(.red)
        }
    }
}

/// Native-owned text field (PROTOCOL.md §8). The field keeps its own text, so cursor, selection
/// and marked text never round-trip through JS. The JS `value` is applied only when the field
/// is not focused and JS has handled every change this field sent.
@MainActor
private struct TextFieldNode: View {
    let node: MirrorNode
    let events: any Events

    @State private var local = ""
    @State private var lastSent = 0
    @FocusState private var focused: Bool

    private var jsValue: String { node.props["value"]?.string ?? "" }

    var body: some View {
        TextField(node.props["label"]?.string ?? "", text: Binding(
            get: { local },
            set: { next in
                guard next != local else { return }
                local = next
                let seq = events.send(node, "change", next)
                if seq > 0 { lastSent = seq }
            }
        ))
        .textFieldStyle(.roundedBorder)
        .focused($focused)
        .onAppear { local = jsValue }
        .onChange(of: jsValue) { syncFromJS() }
        .onChange(of: focused) { syncFromJS() }
        .onChange(of: events.acknowledged) { syncFromJS() }
    }

    private func syncFromJS() {
        if !focused && events.acknowledged >= lastSent && jsValue != local {
            local = jsValue
        }
    }
}

private extension MirrorNode {
    func points(_ name: String) -> CGFloat { CGFloat(props[name]?.number ?? 0) }
}
