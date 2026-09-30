import WebKit
import os

/// Runs the Angular bundle in a WKWebView and carries protocol messages both ways.
/// JS → native: `webkit.messageHandlers.mantikora.postMessage(json)`.
/// Native → JS: `__mantikora.receive(json)`.
///
/// The bundle is served from the app bundle through the `mantikora://app/` scheme,
/// because ES module scripts do not load from file:// URLs.
@MainActor
final class WebViewHost {
    let webView: WKWebView
    private let onBatch: (Batch) -> Void
    private var expectedBatch = 1
    private var eventSeq = 0
    private let log = Logger(subsystem: "dev.mantikora.poc", category: "host")

    init(onBatch: @escaping (Batch) -> Void) {
        self.onBatch = onBatch
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: "mantikora")
        webView = WKWebView(frame: .zero, configuration: config)
        // WKUserContentController retains its handlers, so the handler holds the host weakly.
        config.userContentController.add(MessageHandler(host: self), name: "mantikora")
        #if DEBUG
        webView.isInspectable = true
        #endif
    }

    func load() {
        webView.load(URLRequest(url: URL(string: "mantikora://app/index.html")!))
    }

    /// Sends a native event to JS and returns its seq.
    @discardableResult
    func sendEvent(_ event: String, node: Int, payload: String? = nil) -> Int {
        eventSeq += 1
        let json = Wire.eventJSON(seq: eventSeq, event: event, node: node, payload: payload)
        webView.evaluateJavaScript("__mantikora.receive(\(Wire.jsStringLiteral(json)))", completionHandler: nil)
        return eventSeq
    }

    fileprivate func receive(_ body: Any) {
        guard let json = body as? String else { return fail("message body is not a string") }
        let batch: Batch
        do {
            batch = try Wire.parseBatch(json)
        } catch {
            return fail("cannot parse batch: \(error)")
        }
        guard batch.seq == expectedBatch else {
            return fail("batch \(batch.seq) arrived, expected \(expectedBatch)")
        }
        expectedBatch += 1
        onBatch(batch)
    }

    /// Debug builds crash on protocol errors; release builds log and drop the batch.
    private func fail(_ message: String) {
        #if DEBUG
        fatalError("Mantikora: \(message)")
        #else
        log.error("\(message, privacy: .public)")
        #endif
    }
}

@MainActor
private final class MessageHandler: NSObject, WKScriptMessageHandler {
    weak var host: WebViewHost?

    init(host: WebViewHost) {
        self.host = host
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        host?.receive(message.body)
    }
}

/// Serves the Angular bundle from the app bundle: `mantikora://app/<path>`.
@MainActor
private final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
        guard let url = task.request.url else { return task.didFailWithError(URLError(.badURL)) }
        let path = url.path.count > 1 ? String(url.path.dropFirst()) : "index.html"
        guard let file = Self.resource(path), let data = try? Data(contentsOf: file) else {
            return task.didFailWithError(URLError(.fileDoesNotExist))
        }
        let headers = ["Content-Type": Self.mimeType(path), "Content-Length": String(data.count)]
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {}

    /// Looks in `web/` first; Xcode may also copy the folder's files flat into the bundle root.
    private static func resource(_ path: String) -> URL? {
        Bundle.main.url(forResource: path, withExtension: nil, subdirectory: "web")
            ?? Bundle.main.url(forResource: (path as NSString).lastPathComponent, withExtension: nil)
    }

    private static func mimeType(_ path: String) -> String {
        switch (path as NSString).pathExtension {
        case "html": "text/html; charset=utf-8"
        case "js", "mjs": "text/javascript; charset=utf-8"
        case "css": "text/css; charset=utf-8"
        case "ico": "image/x-icon"
        default: "application/octet-stream"
        }
    }
}
