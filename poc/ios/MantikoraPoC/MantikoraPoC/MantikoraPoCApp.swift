import SwiftUI

@main
@MainActor
struct MantikoraPoCApp: App {
    // Created in init, not as a default value: in Swift 5.10 property defaults run nonisolated.
    @State private var model: AppModel

    init() {
        _model = State(initialValue: AppModel())
    }

    var body: some Scene {
        WindowGroup {
            ContentView(model: model)
        }
    }
}
