import Observation

/// One node of the native mirror tree. Observation tracks props, children and text per property,
/// so SwiftUI re-renders only the NodeViews that read what a batch changed.
@MainActor
@Observable
final class MirrorNode: Identifiable {
    let id: Int
    let type: String
    let tag: String?
    var props: [String: PropValue] = [:]
    var children: [MirrorNode] = []
    var text = ""

    /// Read at event time; not rendered, so not observed.
    @ObservationIgnored var listeners: Set<String> = []
    @ObservationIgnored fileprivate(set) weak var parent: MirrorNode?

    init(id: Int, type: String, tag: String?) {
        self.id = id
        self.type = type
        self.tag = tag
    }

    /// Content of mk-text and label of mk-button: the concatenation of their text children.
    var content: String { children.map(\.text).joined() }
}

/// Applies protocol v0 batches to the mirror tree. See poc/PROTOCOL.md; must behave like reference-mirror.ts.
@MainActor
@Observable
final class NodeStore {
    static let host = "#host"
    static let text = "#text"

    private(set) var root: MirrorNode?

    /// `evt` of the last applied batch: every native event up to this seq has been handled by JS.
    private(set) var acknowledgedEvent = 0

    @ObservationIgnored private var nodes: [Int: MirrorNode] = [:]

    var size: Int { nodes.count }

    /// Applies the whole batch synchronously on the main actor, so SwiftUI never renders half a batch.
    func apply(_ batch: Batch) throws {
        for (i, op) in batch.ops.enumerated() {
            do {
                try apply(op)
            } catch {
                throw ProtocolError("batch \(batch.seq) op \(i) \(op): \(error)")
            }
        }
        acknowledgedEvent = batch.evt
    }

    /// First node of a type; used by the bench to find the counter's button.
    func find(_ type: String) -> MirrorNode? {
        nodes.values.first { $0.type == type }
    }

    func node(_ id: Int) throws -> MirrorNode {
        guard let node = nodes[id] else { throw ProtocolError("unknown id \(id)") }
        return node
    }

    private func apply(_ op: Op) throws {
        switch op {
        case let .create(id, type, tag):
            guard type == Self.host || Catalog.types.contains(type) else { throw ProtocolError("unknown type \(type)") }
            try add(MirrorNode(id: id, type: type, tag: tag))

        case let .text(id, value):
            let node = MirrorNode(id: id, type: Self.text, tag: nil)
            node.text = value
            try add(node)

        case let .setText(id, value):
            let node = try self.node(id)
            guard node.type == Self.text else { throw ProtocolError("#\(id) is not text") }
            node.text = value

        case let .insert(parentId, childId, index):
            let parent = try self.node(parentId)
            let child = try self.node(childId)
            // Validate before mutating: the index counts siblings after the child is detached.
            let size = parent.children.count - (child.parent === parent ? 1 : 0)
            guard (0...size).contains(index) else { throw ProtocolError("index \(index) out of range") }
            if child.parent != nil { detach(child) }
            parent.children.insert(child, at: index)
            child.parent = parent

        case let .remove(id):
            let node = try self.node(id)
            guard node.parent != nil else { throw ProtocolError("#\(id) is not attached") }
            detach(node)

        case let .destroy(id):
            let node = try self.node(id)
            if node.parent != nil { detach(node) }
            free(node)
            if root === node { root = nil }

        case let .prop(id, name, value):
            let node = try self.node(id)
            guard Catalog.hasProp(node.type, name) else { throw ProtocolError("\(node.type) has no prop \(name)") }
            node.props[name] = value

        case let .listen(id, event):
            try self.node(id).listeners.insert(event)

        case let .unlisten(id, event):
            try self.node(id).listeners.remove(event)

        case let .root(id):
            root = try self.node(id)
        }
    }

    private func add(_ node: MirrorNode) throws {
        guard nodes[node.id] == nil else { throw ProtocolError("id \(node.id) already exists") }
        nodes[node.id] = node
    }

    private func detach(_ node: MirrorNode) {
        node.parent?.children.removeAll { $0 === node }
        node.parent = nil
    }

    private func free(_ node: MirrorNode) {
        nodes[node.id] = nil
        node.children.forEach(free)
    }

    /// The tree as it is drawn, in the same format as ReferenceMirror.render() in TypeScript.
    func render() -> String {
        var lines: [String] = []
        func visit(_ node: MirrorNode, _ depth: Int) {
            if node.type == Self.host { return node.children.forEach { visit($0, depth) } }
            var parts = [node.type]
            for (k, v) in node.props.sorted(by: { $0.key < $1.key }) { parts.append("\(k)=\(v.json)") }
            if Catalog.holds(node.type) == .text { parts.append(Wire.jsStringLiteral(node.content)) }
            if !node.listeners.isEmpty { parts.append("(\(node.listeners.sorted().joined(separator: ", ")))") }
            lines.append(String(repeating: "  ", count: depth) + parts.joined(separator: " "))
            if Catalog.holds(node.type) == .nodes { node.children.forEach { visit($0, depth + 1) } }
        }
        if let root { visit(root, 0) }
        return lines.joined(separator: "\n")
    }
}

/// Catalog v0 on the native side — see poc/PROTOCOL.md §6.
enum Catalog {
    enum Holds { case nodes, text, none }

    private static let specs: [String: (props: Set<String>, holds: Holds)] = [
        "mk-column": (["spacing", "padding"], .nodes),
        "mk-text": (["variant"], .text),
        "mk-button": (["disabled"], .text),
        "mk-text-field": (["label", "value"], .none),
    ]

    static var types: Set<String> { Set(specs.keys) }

    static func hasProp(_ type: String, _ name: String) -> Bool { specs[type]?.props.contains(name) == true }

    /// Hosts are transparent and hold nodes.
    static func holds(_ type: String) -> Holds { specs[type]?.holds ?? .nodes }
}
