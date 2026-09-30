import Foundation

/// Mantikora protocol v0 — see poc/PROTOCOL.md.
/// (Named `Wire` because `Protocol` is taken by the Objective-C runtime.)
enum Wire {
    static let version = 0

    static func parseBatch(_ json: String) throws -> Batch {
        guard let obj = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] else {
            throw ProtocolError("batch is not an object")
        }
        let v = try int(obj["v"], "v")
        guard v == version else { throw ProtocolError("unsupported protocol version \(v)") }
        let seq = try int(obj["batch"], "batch")
        guard let raw = obj["ops"] as? [[Any]] else { throw ProtocolError("batch \(seq): ops is not an array of arrays") }
        var ops: [Op] = []
        ops.reserveCapacity(raw.count)
        for (i, op) in raw.enumerated() {
            do {
                ops.append(try parseOp(op))
            } catch {
                throw ProtocolError("batch \(seq) op \(i) \(op): \(error)")
            }
        }
        return Batch(seq: seq, evt: try int(obj["evt"], "evt"), ops: ops)
    }

    static func eventJSON(seq: Int, event: String, node: Int, payload: String?) -> String {
        var obj: [String: Any] = ["v": version, "seq": seq, "event": event, "node": node]
        if let payload { obj["payload"] = payload }
        let data = try! JSONSerialization.data(withJSONObject: obj)
        return String(decoding: data, as: UTF8.self)
    }

    /// Encodes a string as a JS string literal, for `evaluateJavaScript`.
    static func jsStringLiteral(_ s: String) -> String {
        String(decoding: try! JSONEncoder().encode(s), as: UTF8.self)
    }

    private static func parseOp(_ op: [Any]) throws -> Op {
        guard let name = op.first as? String else { throw ProtocolError("op name is missing") }
        switch name {
        case "create": return try .create(id: int(at: op, 1), type: string(at: op, 2), tag: optionalString(at: op, 3))
        case "text": return try .text(id: int(at: op, 1), value: string(at: op, 2))
        case "setText": return try .setText(id: int(at: op, 1), value: string(at: op, 2))
        case "insert": return try .insert(parent: int(at: op, 1), child: int(at: op, 2), index: int(at: op, 3))
        case "remove": return try .remove(id: int(at: op, 1))
        case "destroy": return try .destroy(id: int(at: op, 1))
        case "prop": return try .prop(id: int(at: op, 1), name: string(at: op, 2), value: propValue(op.count > 3 ? op[3] : nil))
        case "listen": return try .listen(id: int(at: op, 1), event: string(at: op, 2))
        case "unlisten": return try .unlisten(id: int(at: op, 1), event: string(at: op, 2))
        case "root": return try .root(id: int(at: op, 1))
        default: throw ProtocolError("unknown op \"\(name)\"")
        }
    }

    private static func propValue(_ value: Any?) throws -> PropValue? {
        guard let value, !(value is NSNull) else { return nil }
        if let s = value as? String { return .string(s) }
        if let n = value as? NSNumber {
            if CFGetTypeID(n) == CFBooleanGetTypeID() { return .bool(n.boolValue) }
            return CFNumberIsFloatType(n as CFNumber) ? .double(n.doubleValue) : .int(n.intValue)
        }
        throw ProtocolError("unsupported prop value \(value)")
    }

    private static func int(at op: [Any], _ i: Int) throws -> Int {
        try int(i < op.count ? op[i] : nil, "argument \(i)")
    }

    private static func optionalString(at op: [Any], _ i: Int) throws -> String? {
        guard i < op.count else { return nil }
        return try string(at: op, i)
    }

    private static func string(at op: [Any], _ i: Int) throws -> String {
        guard i < op.count, let s = op[i] as? String else { throw ProtocolError("argument \(i) is not a string") }
        return s
    }

    private static func int(_ value: Any?, _ what: String) throws -> Int {
        guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), !CFNumberIsFloatType(n as CFNumber) else {
            throw ProtocolError("\(what) is not an integer")
        }
        return n.intValue
    }
}

struct Batch: Equatable {
    let seq: Int
    let evt: Int
    let ops: [Op]
}

enum Op: Equatable {
    case create(id: Int, type: String, tag: String?)
    case text(id: Int, value: String)
    case setText(id: Int, value: String)
    case insert(parent: Int, child: Int, index: Int)
    case remove(id: Int)
    case destroy(id: Int)
    /// `nil` resets the prop to its default.
    case prop(id: Int, name: String, value: PropValue?)
    case listen(id: Int, event: String)
    case unlisten(id: Int, event: String)
    case root(id: Int)
}

enum PropValue: Equatable {
    case int(Int)
    case double(Double)
    case string(String)
    case bool(Bool)

    var number: Double? {
        switch self {
        case .int(let i): Double(i)
        case .double(let d): d
        default: nil
        }
    }

    var string: String? {
        if case .string(let s) = self { s } else { nil }
    }

    /// JSON form, used by NodeStore.render() to match the TypeScript reference mirror.
    var json: String {
        switch self {
        case .int(let i): String(i)
        case .double(let d): String(d)
        case .bool(let b): String(b)
        case .string(let s): Wire.jsStringLiteral(s)
        }
    }
}

struct ProtocolError: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}
