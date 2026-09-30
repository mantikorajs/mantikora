package dev.mantikora.poc.host

import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.ApplicationInfo
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject

/**
 * Runs the Angular bundle in a WebView and carries protocol messages both ways.
 * JS → native: `MantikoraAndroid.post(json)`. Native → JS: `__mantikora.receive(json)`.
 *
 * The bundle is served from assets/web through WebViewAssetLoader, because ES module
 * scripts do not load from file:// URLs.
 */
class WebViewHost(context: Context, private val onBatch: (Batch) -> Unit) {
    private val debuggable = context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
    private val main = Handler(Looper.getMainLooper())
    private var expectedBatch = 1
    private var eventSeq = 0

    private val assets = WebViewAssetLoader.Builder()
        .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
        .build()

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    val webView: WebView = WebView(context).apply {
        settings.javaScriptEnabled = true
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assets.shouldInterceptRequest(request.url)

            // The bundle never navigates; block anything that tries.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
        }
        webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                Log.d(TAG_JS, "${message.message()} (${message.sourceId()}:${message.lineNumber()})")
                return true
            }
        }
        addJavascriptInterface(JsBridge(), "MantikoraAndroid")
    }

    init {
        WebView.setWebContentsDebuggingEnabled(debuggable)
    }

    fun load() {
        webView.loadUrl("https://appassets.androidplatform.net/assets/web/index.html")
    }

    /** Sends a native event to JS. Main thread only. */
    fun sendEvent(event: String, node: Int, payload: String? = null) {
        check(Looper.myLooper() == Looper.getMainLooper()) { "sendEvent must run on the main thread" }
        val json = Protocol.eventJson(++eventSeq, event, node, payload)
        webView.evaluateJavascript("__mantikora.receive(${JSONObject.quote(json)})", null)
    }

    fun destroy() {
        webView.destroy()
    }

    private fun deliver(batch: Batch) {
        if (batch.seq != expectedBatch) {
            fail("batch ${batch.seq} arrived, expected $expectedBatch")
            return
        }
        expectedBatch++
        onBatch(batch)
    }

    /** Debug builds crash on protocol errors; release builds log and drop the batch. */
    private fun fail(message: String, cause: Throwable? = null) {
        if (debuggable) throw ProtocolException(message, cause)
        Log.e(TAG, message, cause)
    }

    private inner class JsBridge {
        /** Called by JS on the WebView's JavaBridge thread: parse here, apply on main. */
        @JavascriptInterface
        fun post(json: String) {
            val batch = try {
                Protocol.parseBatch(json)
            } catch (e: Exception) {
                main.post { fail("cannot parse batch: ${e.message}", e) }
                return
            }
            main.post { deliver(batch) }
        }
    }

    private companion object {
        const val TAG = "Mantikora"
        const val TAG_JS = "MantikoraJS"
    }
}
