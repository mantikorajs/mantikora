import XCTest
@testable import MantikoraPoC

final class NodeStoreTests: XCTestCase {
    /// The first batch of the counter app, exactly as app.spec.ts expects it.
    private let counter = Batch(seq: 1, evt: 0, ops: [
        .create(id: 1, type: "#host", tag: "app-root"), .root(id: 1),
        .create(id: 2, type: "mk-column", tag: nil), .prop(id: 2, name: "spacing", value: .int(12)),
        .prop(id: 2, name: "padding", value: .int(16)), .insert(parent: 1, child: 2, index: 0),
        .create(id: 3, type: "mk-text", tag: nil), .prop(id: 3, name: "variant", value: .string("title")),
        .insert(parent: 2, child: 3, index: 0),
        .text(id: 4, value: ""), .insert(parent: 3, child: 4, index: 0),
        .create(id: 5, type: "mk-button", tag: nil), .insert(parent: 2, child: 5, index: 1), .listen(id: 5, event: "tap"),
        .text(id: 6, value: "Increment"), .insert(parent: 5, child: 6, index: 0),
        .create(id: 7, type: "mk-text-field", tag: nil), .prop(id: 7, name: "label", value: .string("Name")),
        .insert(parent: 2, child: 7, index: 2), .listen(id: 7, event: "change"),
        .create(id: 8, type: "mk-text", tag: nil), .insert(parent: 2, child: 8, index: 3),
        .text(id: 9, value: ""), .insert(parent: 8, child: 9, index: 0),
        .setText(id: 4, value: "Clicked 0 times"), .prop(id: 7, name: "value", value: .string("")),
        .setText(id: 9, value: "Hello "),
    ])

    @MainActor
    private func started() throws -> NodeStore {
        let store = NodeStore()
        try store.apply(counter)
        return store
    }

    @MainActor
    func testCounterRendersTheSameTreeAsTheReferenceMirror() throws {
        let store = try started()
        XCTAssertEqual(store.render(), """
            mk-column padding=16 spacing=12
              mk-text variant="title" "Clicked 0 times"
              mk-button "Increment" (tap)
              mk-text-field label="Name" value="" (change)
              mk-text "Hello "
            """)
    }

    @MainActor
    func testSetTextChangesOnlyTheText() throws {
        let store = try started()
        try store.apply(Batch(seq: 2, evt: 1, ops: [.setText(id: 4, value: "Clicked 1 times")]))
        XCTAssertEqual(try store.node(3).content, "Clicked 1 times")
        XCTAssertEqual(store.acknowledgedEvent, 1)
    }

    @MainActor
    func testInsertOfAnAttachedNodeMovesIt() throws {
        let store = try started()
        try store.apply(Batch(seq: 2, evt: 0, ops: [.insert(parent: 2, child: 8, index: 0)]))
        XCTAssertEqual(try store.node(2).children.map(\.id), [8, 3, 5, 7])
    }

    @MainActor
    func testDestroyFreesTheWholeSubtree() throws {
        let store = try started()
        let before = store.size
        try store.apply(Batch(seq: 2, evt: 0, ops: [.destroy(id: 5)]))
        XCTAssertEqual(store.size, before - 2)
        XCTAssertEqual(try store.node(2).children.map(\.id), [3, 7, 8])
    }

    @MainActor
    func testNilPropResetsToDefault() throws {
        let store = try started()
        try store.apply(Batch(seq: 2, evt: 0, ops: [.prop(id: 2, name: "spacing", value: nil)]))
        XCTAssertEqual(Set(try store.node(2).props.keys), ["padding"])
    }

    @MainActor
    func testProtocolErrorsNameTheBatchAndOp() throws {
        let store = try started()
        let cases: [(Op, String)] = [
            (.create(id: 99, type: "mk-card", tag: nil), "unknown type mk-card"),
            (.setText(id: 99, value: "x"), "unknown id 99"),
            (.create(id: 2, type: "mk-text", tag: nil), "id 2 already exists"),
            (.insert(parent: 2, child: 4, index: 9), "index 9 out of range"),
            (.prop(id: 3, name: "size", value: .int(12)), "mk-text has no prop size"),
            (.setText(id: 3, value: "x"), "#3 is not text"),
        ]
        for (op, message) in cases {
            XCTAssertThrowsError(try store.apply(Batch(seq: 2, evt: 0, ops: [op]))) { error in
                XCTAssertEqual((error as? ProtocolError)?.description, "batch 2 op 0 \(op): \(message)")
            }
        }
    }
}

final class WireTests: XCTestCase {
    @MainActor
    func testParsesBatchJSONWithTypedProps() throws {
        let json = ##"{"v":0,"batch":1,"evt":0,"ops":[["create",1,"#host","app-root"],["root",1],["create",2,"mk-column"],["prop",2,"spacing",12],["prop",5,"disabled",true],["prop",7,"value",null]]}"##
        let batch = try Wire.parseBatch(json)
        XCTAssertEqual(batch.seq, 1)
        XCTAssertEqual(batch.ops, [
            .create(id: 1, type: "#host", tag: "app-root"), .root(id: 1),
            .create(id: 2, type: "mk-column", tag: nil),
            .prop(id: 2, name: "spacing", value: .int(12)),
            .prop(id: 5, name: "disabled", value: .bool(true)),
            .prop(id: 7, name: "value", value: nil),
        ])
    }

    @MainActor
    func testRejectsOtherVersionsAndUnknownOps() {
        XCTAssertThrowsError(try Wire.parseBatch(#"{"v":1,"batch":1,"evt":0,"ops":[]}"#))
        XCTAssertThrowsError(try Wire.parseBatch(#"{"v":0,"batch":1,"evt":0,"ops":[["explode",1]]}"#))
    }

    @MainActor
    func testEventJSONEscapesThePayload() {
        let json = Wire.eventJSON(seq: 3, event: "change", node: 7, payload: "a\"b\nc")
        XCTAssertTrue(json.contains(#""payload":"a\"b\nc""#))
        let literal = Wire.jsStringLiteral(json)
        XCTAssertTrue(literal.hasPrefix("\"") && literal.hasSuffix("\""))
    }
}
