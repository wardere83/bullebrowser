import Foundation
import UIKit
import WebKit
import Security
import Capacitor

@objc(MobileAgentPlugin)
public class MobileAgentPlugin: CAPPlugin, CAPBridgedPlugin, WKNavigationDelegate {
    public let identifier = "MobileAgentPlugin"
    public let jsName = "MobileAgent"
    public let pluginMethods: [CAPPluginMethod] = ["getState", "setAccess", "setConnectors", "setKey", "requestModel", "cancelModel", "browser", "viewport", "clearBrowserData", "openExternal"].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }
    private let prefs = UserDefaults.standard
    private let prefix = "bullebrowser.mobile."
    private var tabs: [String: WKWebView] = [:]
    private var order: [String] = []
    private var active = ""
    private var frame = CGRect.zero
    private var visible = false
    private var pending: [String: CAPPluginCall] = [:]
    private var requests: [String: URLSessionDataTask] = [:]
    private let redirectGuard = NoModelRedirect()
    private lazy var modelSession: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil; config.urlCache = nil
        config.timeoutIntervalForRequest = 90; config.timeoutIntervalForResource = 100
        return URLSession(configuration: config, delegate: redirectGuard, delegateQueue: nil)
    }()
    private func allowed(_ capability: String) -> Bool { prefs.bool(forKey: prefix + capability) }
    private func credentials(_ provider: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.bullebrowser.mobile.assistant", kSecAttrAccount as String: provider]
    }
    private func key(_ provider: String) -> String? {
        var query = credentials(provider); query[kSecReturnData as String] = true
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    @objc func getState(_ call: CAPPluginCall) {
        let custom = prefs.array(forKey: prefix + "custom") ?? []
        call.resolve(["browsing": allowed("browsing"), "files": allowed("files"), "externalApps": allowed("externalApps"), "enabledConnectors": prefs.stringArray(forKey: prefix + "connectors") ?? [], "customConnectors": custom, "hasKeyAnthropic": key("anthropic") != nil, "hasKeyOpenai": key("openai") != nil])
    }
    @objc func setAccess(_ call: CAPPluginCall) {
        guard let capability = call.getString("capability"), ["browsing", "files", "externalApps"].contains(capability), let enabled = call.getBool("enabled") else { call.reject("Invalid access setting."); return }
        prefs.set(enabled, forKey: prefix + capability)
        DispatchQueue.main.async {
            if capability == "browsing" && !enabled { self.visible = false; self.tabs.values.forEach { $0.stopLoading(); $0.isHidden = true } }
            call.resolve()
        }
    }
    @objc func setConnectors(_ call: CAPPluginCall) {
        guard let enabled = call.getArray("enabled", String.self), enabled.count <= 150, enabled.allSatisfy({ $0.count <= 100 }), let custom = call.getArray("custom", JSObject.self), custom.count <= 50 else { call.reject("Invalid connector catalog."); return }
        for item in custom {
            guard let address = item["url"] as? String, webURL(address) != nil, let id = item["id"] as? String, id.hasPrefix("custom-"), let name = item["name"] as? String, !name.isEmpty, name.count <= 80 else { call.reject("Invalid custom connector."); return }
        }
        prefs.set(enabled, forKey: prefix + "connectors"); prefs.set(custom, forKey: prefix + "custom"); call.resolve()
    }
    @objc func setKey(_ call: CAPPluginCall) {
        guard let provider = call.getString("provider"), ["anthropic", "openai"].contains(provider), let value = call.getString("key"), value.count <= 512 else { call.reject("Invalid assistant credential."); return }
        let query = credentials(provider)
        if value.isEmpty { SecItemDelete(query as CFDictionary); call.resolve(); return }
        let update: [String: Any] = [kSecValueData as String: Data(value.utf8)]
        var status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var entry = query; entry[kSecValueData as String] = Data(value.utf8)
            entry[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            status = SecItemAdd(entry as CFDictionary, nil)
        }
        if status == errSecSuccess { call.resolve() } else { call.reject("The device could not protect this key.") }
    }
    @objc func requestModel(_ call: CAPPluginCall) {
        guard let provider = call.getString("provider"), ["anthropic", "openai"].contains(provider), let body = call.getString("body"), body.utf8.count <= 2_000_000, let id = call.getString("requestId"), let secret = key(provider), let data = body.data(using: .utf8), (try? JSONSerialization.jsonObject(with: data)) is [String: Any] else { call.reject("Connect an assistant key and send a valid request."); return }
        DispatchQueue.main.async {
            guard self.requests.isEmpty else { call.reject("An assistant request is already running."); return }
            let endpoint = provider == "anthropic" ? "https://api.anthropic.com/v1/messages" : "https://api.openai.com/v1/chat/completions"
            var request = URLRequest(url: URL(string: endpoint)!); request.httpMethod = "POST"; request.httpBody = data
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            if provider == "anthropic" { request.setValue(secret, forHTTPHeaderField: "x-api-key"); request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version") }
            else { request.setValue("Bearer " + secret, forHTTPHeaderField: "Authorization") }
            let task = self.modelSession.dataTask(with: request) { data, response, error in
                DispatchQueue.main.async {
                    self.requests.removeValue(forKey: id)
                    guard error == nil, let response = response as? HTTPURLResponse, let data = data, data.count <= 4_000_000, let text = String(data: data, encoding: .utf8) else { call.reject("Assistant request failed or was stopped. Please try again."); return }
                    call.resolve(["status": response.statusCode, "body": text])
                }
            }
            self.requests[id] = task; task.resume()
        }
    }
    @objc func cancelModel(_ call: CAPPluginCall) {
        DispatchQueue.main.async { if let id = call.getString("requestId") { self.requests[id]?.cancel() }; call.resolve() }
    }
    private func restrictedHost(_ input: String) -> Bool {
        let normalized = input.folding(options: [.caseInsensitive, .widthInsensitive], locale: Locale(identifier: "en_US_POSIX")).replacingOccurrences(of: "\u{3002}", with: ".").replacingOccurrences(of: "\u{ff61}", with: ".")
        let labels = normalized.trimmingCharacters(in: CharacterSet(charactersIn: ".")).split(separator: ".")
        let blocked: Set<UInt64> = [0x2fbb5d9759a7d9c8, 0x898a63955bf7867b, 0x835d4b4de592220e]
        for index in labels.indices {
            let host = labels[index...].joined(separator: ".")
            var hash: UInt64 = 14695981039346656037
            for byte in host.utf8 { hash = (hash ^ UInt64(byte)) &* 1099511628211 }
            if blocked.contains(hash) { return true }
        }
        return false
    }
    private func webURL(_ address: String) -> URL? {
        guard address.count <= 8192, let components = URLComponents(string: address), components.scheme == "https", components.user == nil, components.password == nil, let host = components.host, !host.isEmpty, !restrictedHost(host) else { return nil }
        return components.url
    }
    private func info(_ id: String) -> JSObject {
        let view = tabs[id]
        return ["id": id, "title": view?.title ?? "Loading…", "url": view?.url?.absoluteString ?? "about:blank", "active": id == active]
    }
    private func select(_ id: String) {
        active = id
        for (key, view) in tabs { view.frame = frame; view.isHidden = key != id || !visible || !allowed("browsing") }
    }
    private func load(_ view: WKWebView, id: String, url: URL, call: CAPPluginCall) {
        if let previous = pending.removeValue(forKey: id) { previous.reject("Navigation replaced.") }
        pending[id] = call; view.load(URLRequest(url: url))
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) {
            if self.pending[id] === call { self.pending.removeValue(forKey: id); call.reject("Navigation timed out. Inspect the source tab before retrying.") }
        }
    }
    @objc func browser(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let action = call.getString("action") ?? ""
            if action == "list" { call.resolve(["tabs": self.order.map { self.info($0) }]); return }
            guard self.allowed("browsing") else { call.reject("Enable browsing in Settings first."); return }
            var id = call.getString("tabId") ?? self.active
            if action == "new" {
                guard self.tabs.count < 12, let url = self.webURL(call.getString("url") ?? "https://www.google.com/") else { call.reject("Use an HTTPS website; at most 12 mobile tabs can be open."); return }
                id = UUID().uuidString
                let config = WKWebViewConfiguration(); config.websiteDataStore = .default()
                // This web view has NO Capacitor bridge or native message handlers.
                let view = WKWebView(frame: self.frame, configuration: config)
                view.navigationDelegate = self; view.isOpaque = true; view.backgroundColor = .white
                self.tabs[id] = view; self.order.append(id); self.bridge?.viewController?.view.addSubview(view)
                self.select(id); self.load(view, id: id, url: url, call: call); return
            }
            guard let view = self.tabs[id] else { call.reject("Tab not found."); return }
            switch action {
            case "switch": self.select(id); call.resolve(["tab": self.info(id)])
            case "close":
                self.pending.removeValue(forKey: id)?.reject("Tab closed.")
                view.stopLoading(); view.removeFromSuperview(); self.tabs.removeValue(forKey: id); self.order.removeAll { $0 == id }
                if self.active == id { self.select(self.order.last ?? "") }; call.resolve()
            case "navigate":
                guard let url = self.webURL(call.getString("url") ?? "") else { call.reject("Only HTTPS websites are supported."); return }
                self.select(id); self.load(view, id: id, url: url, call: call)
            case "back", "forward", "reload":
                if self.pending[id] != nil { call.reject("Wait for the current navigation."); return }
                self.pending[id] = call
                let navigation = action == "back" ? view.goBack() : action == "forward" ? view.goForward() : view.reload()
                if navigation == nil { self.pending.removeValue(forKey: id); call.resolve(["tab": self.info(id)]) }
                else { DispatchQueue.main.asyncAfter(deadline: .now() + 30) { if self.pending[id] === call { self.pending.removeValue(forKey: id); call.reject("Navigation timed out.") } } }
            case "evaluate":
                guard let script = call.getString("script"), script.utf8.count <= 300_000, view.url?.scheme == "https" else { call.reject("The page is not ready for an action."); return }
                view.callAsyncJavaScript("return JSON.stringify(await (async () => {\(script)})());", arguments: [:], in: nil, in: .page) { result in
                    switch result {
                    case .success(let raw):
                        guard let text = raw as? String, text.utf8.count <= 1_000_000, let data = text.data(using: .utf8), let value = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) else { call.reject("The page returned an unsupported result."); return }
                        call.resolve(["value": value])
                    case .failure: call.reject("The page action could not complete. Inspect the source tab before retrying.")
                    }
                }
            default: call.reject("Unsupported browser action.")
            }
        }
    }
    @objc func viewport(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let parent = self.bridge?.viewController?.view, let webView = self.bridge?.webView else { call.reject("Browser view unavailable."); return }
            let rect = CGRect(x: call.getDouble("x") ?? 0, y: call.getDouble("y") ?? 0, width: max(0, call.getDouble("width") ?? 0), height: max(0, call.getDouble("height") ?? 0))
            self.frame = webView.convert(rect, to: parent).intersection(parent.bounds)
            self.visible = call.getBool("visible") == true && !self.frame.isEmpty
            self.select(self.active); call.resolve()
        }
    }
    @objc func clearBrowserData(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.pending.values.forEach { $0.reject("Browser data cleared.") }; self.pending.removeAll()
            self.tabs.values.forEach { $0.stopLoading(); $0.removeFromSuperview() }; self.tabs.removeAll(); self.order.removeAll(); self.active = ""
            WKWebsiteDataStore.default().removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) { call.resolve() }
        }
    }
    @objc func openExternal(_ call: CAPPluginCall) {
        guard allowed("externalApps"), let url = webURL(call.getString("url") ?? "") else { call.reject("Enable external links in Settings and choose an HTTPS page."); return }
        DispatchQueue.main.async {
            let alert = UIAlertController(title: "Open in another app?", message: url.absoluteString, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in call.reject("Opening cancelled.") })
            alert.addAction(UIAlertAction(title: "Open", style: .default) { _ in
                guard self.allowed("externalApps") else { call.reject("Permission was revoked."); return }
                UIApplication.shared.open(url, options: [:]) { success in if success { call.resolve() } else { call.reject("No app can open this link.") } }
            })
            self.bridge?.viewController?.present(alert, animated: true)
        }
    }
    public func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(allowed("browsing") && navigationAction.request.url.flatMap({ webURL($0.absoluteString) }) != nil ? .allow : .cancel)
    }
    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if let id = order.first(where: { tabs[$0] === webView }) { pending.removeValue(forKey: id)?.resolve(["tab": info(id)]) }
    }
    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail(webView) }
    public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail(webView) }
    private func fail(_ view: WKWebView) {
        if let id = order.first(where: { tabs[$0] === view }) { pending.removeValue(forKey: id)?.reject("The website could not load. Inspect the source tab before retrying.") }
    }
}
private class NoModelRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
