package com.bullebrowser.mobile;

import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.coordinatorlayout.widget.CoordinatorLayout;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "MobileAgent")
public class MobileAgentPlugin extends Plugin {
    private final java.util.concurrent.ExecutorService network = java.util.concurrent.Executors.newFixedThreadPool(2);
    private final java.util.Set<String> cancelled = ConcurrentHashMap.newKeySet();
    private final Map<String, WebView> tabs = new LinkedHashMap<>();
    private final Map<String, PluginCall> pending = new LinkedHashMap<>();
    private final ConcurrentHashMap<String, HttpURLConnection> requests = new ConcurrentHashMap<>();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private String active = "";
    private boolean visible = false;
    private CoordinatorLayout.LayoutParams bounds = new CoordinatorLayout.LayoutParams(0, 0);
    private SharedPreferences prefs;
    @Override public void load() { prefs = getContext().getSharedPreferences("bullebrowser-mobile", 0); }
    private boolean allowed(String capability) { return prefs.getBoolean(capability, false); }
    private SecretKey vaultKey() throws Exception {
        KeyStore vault = KeyStore.getInstance("AndroidKeyStore"); vault.load(null);
        String alias = "bullebrowser.assistant";
        if (!vault.containsAlias(alias)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return (SecretKey) vault.getKey(alias, null);
    }
    private String key(String provider) throws Exception {
        String saved = prefs.getString("key-" + provider, ""); if (saved.isEmpty()) return null;
        String[] parts = saved.split(":");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, vaultKey(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }
    @PluginMethod public void getState(PluginCall call) {
        try {
            JSObject state = new JSObject();
            for (String capability : new String[]{"browsing", "files", "externalApps"}) state.put(capability, allowed(capability));
            state.put("enabledConnectors", new JSArray(prefs.getString("connectors", "[]")));
            state.put("customConnectors", new JSArray(prefs.getString("custom", "[]")));
            state.put("hasKeyAnthropic", key("anthropic") != null); state.put("hasKeyOpenai", key("openai") != null); call.resolve(state);
        } catch (Exception error) { call.reject("Settings could not be loaded. Remove and reconnect the assistant credential if device security changed."); }
    }
    @PluginMethod public void setAccess(PluginCall call) {
        String capability = call.getString("capability", ""); Boolean enabled = call.getBoolean("enabled");
        if (!(capability.equals("browsing") || capability.equals("files") || capability.equals("externalApps")) || enabled == null) { call.reject("Invalid access setting."); return; }
        prefs.edit().putBoolean(capability, enabled).apply();
        getActivity().runOnUiThread(() -> { if (capability.equals("browsing") && !enabled) { visible = false; for (WebView view : tabs.values()) { view.stopLoading(); view.setVisibility(View.GONE); } } call.resolve(); });
    }
    @PluginMethod public void setConnectors(PluginCall call) {
        JSArray enabled = call.getArray("enabled"), custom = call.getArray("custom");
        try {
            if (enabled == null || custom == null || enabled.length() > 150 || custom.length() > 50) throw new Exception();
            for (int i = 0; i < enabled.length(); i++) if (enabled.getString(i).length() > 100) throw new Exception();
            for (int i = 0; i < custom.length(); i++) { JSONObject entry = custom.getJSONObject(i); if (!entry.getString("id").startsWith("custom-") || entry.getString("name").isEmpty() || entry.getString("name").length() > 80 || !webUrl(entry.getString("url"))) throw new Exception(); }
            prefs.edit().putString("connectors", enabled.toString()).putString("custom", custom.toString()).apply(); call.resolve();
        } catch (Exception error) { call.reject("Invalid connector catalog."); }
    }
    @PluginMethod public void setKey(PluginCall call) {
        String provider = call.getString("provider", ""), value = call.getString("key", "");
        if (!(provider.equals("anthropic") || provider.equals("openai")) || value.length() > 512) { call.reject("Invalid assistant credential."); return; }
        try {
            if (value.isEmpty()) prefs.edit().remove("key-" + provider).apply();
            else {
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, vaultKey());
                String encrypted = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
                prefs.edit().putString("key-" + provider, encrypted).apply();
            }
            call.resolve();
        } catch (Exception error) { call.reject("The device could not protect this key."); }
    }
    @PluginMethod public void requestModel(PluginCall call) {
        String provider = call.getString("provider", ""), body = call.getString("body", ""), id = call.getString("requestId", "");
        if (!(provider.equals("anthropic") || provider.equals("openai")) || body.length() > 2_000_000 || id.isEmpty()) { call.reject("Invalid assistant request."); return; }
        network.execute(() -> {
            HttpURLConnection connection = null;
            try {
                new JSONObject(body);
                String secret = key(provider); if (secret == null) throw new Exception();
                String endpoint = provider.equals("anthropic") ? "https://api.anthropic.com/v1/messages" : "https://api.openai.com/v1/chat/completions";
                connection = (HttpURLConnection) new URL(endpoint).openConnection();
                connection.setInstanceFollowRedirects(false); connection.setRequestMethod("POST"); connection.setConnectTimeout(15000); connection.setReadTimeout(90000); connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                if (provider.equals("anthropic")) { connection.setRequestProperty("x-api-key", secret); connection.setRequestProperty("anthropic-version", "2023-06-01"); }
                else connection.setRequestProperty("Authorization", "Bearer " + secret);
                if (cancelled.contains(id)) throw new Exception();
                requests.put(id, connection);
                if (cancelled.contains(id)) throw new Exception();
                try (java.io.OutputStream output = connection.getOutputStream()) { output.write(body.getBytes(StandardCharsets.UTF_8)); }
                int status = connection.getResponseCode();
                InputStream raw = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                if (raw != null) try (InputStream stream = raw) { byte[] buffer = new byte[8192]; int count; while ((count = stream.read(buffer)) != -1) { if (output.size() + count > 4_000_000) throw new Exception(); output.write(buffer, 0, count); } }
                call.resolve(new JSObject().put("status", status).put("body", output.toString("UTF-8")));
            } catch (Exception error) { call.reject("Assistant request failed or was stopped. Check the key and try again."); }
            finally { requests.remove(id); cancelled.remove(id); if (connection != null) connection.disconnect(); }
        });
    }
    @PluginMethod public void cancelModel(PluginCall call) {
        String id = call.getString("requestId", ""); cancelled.add(id);
        HttpURLConnection connection = requests.remove(id);
        if (connection != null) network.execute(connection::disconnect);
        handler.postDelayed(() -> cancelled.remove(id), 110000); call.resolve();
    }
    private boolean restrictedHost(String input) {
        if (input == null) return false;
        String host = java.net.IDN.toASCII(input).toLowerCase(java.util.Locale.ROOT).replaceAll("\\.+$", "");
        while (!host.isEmpty()) {
            long hash = 0xcbf29ce484222325L;
            for (byte value : host.getBytes(java.nio.charset.StandardCharsets.US_ASCII)) hash = (hash ^ (value & 0xff)) * 0x100000001b3L;
            if (hash == 0x2fbb5d9759a7d9c8L || hash == 0x898a63955bf7867bL || hash == 0x835d4b4de592220eL) return true;
            int dot = host.indexOf('.');
            if (dot < 0) break;
            host = host.substring(dot + 1);
        }
        return false;
    }
    private boolean webUrl(String address) {
        try { Uri uri = Uri.parse(address); return address.length() <= 8192 && "https".equals(uri.getScheme()) && uri.getHost() != null && !restrictedHost(uri.getHost()) && uri.getUserInfo() == null; } catch (Exception error) { return false; }
    }
    private JSObject info(String id) {
        WebView view = tabs.get(id);
        return new JSObject().put("id", id).put("title", view == null || view.getTitle() == null ? "Loading…" : view.getTitle()).put("url", view == null || view.getUrl() == null ? "about:blank" : view.getUrl()).put("active", id.equals(active));
    }
    private void select(String id) {
        active = id;
        for (Map.Entry<String, WebView> entry : tabs.entrySet()) { entry.getValue().setLayoutParams(new CoordinatorLayout.LayoutParams(bounds)); entry.getValue().setVisibility(entry.getKey().equals(id) && visible && allowed("browsing") ? View.VISIBLE : View.GONE); }
    }
    private void waitNavigation(String id, PluginCall call) {
        PluginCall previous = pending.put(id, call); if (previous != null) previous.reject("Navigation replaced.");
        handler.postDelayed(() -> { if (pending.get(id) == call) { pending.remove(id); call.reject("Navigation timed out. Inspect the source tab before retrying."); } }, 30000);
    }
    @PluginMethod public void browser(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            String action = call.getString("action", "");
            if (action.equals("list")) { JSArray list = new JSArray(); for (String id : tabs.keySet()) list.put(info(id)); call.resolve(new JSObject().put("tabs", list)); return; }
            if (!allowed("browsing")) { call.reject("Enable browsing in Settings first."); return; }
            String id = call.getString("tabId", active);
            if (action.equals("new")) {
                String address = call.getString("url", "https://www.google.com/");
                if (tabs.size() >= 12 || !webUrl(address)) { call.reject("Use an HTTPS website; at most 12 mobile tabs can be open."); return; }
                id = UUID.randomUUID().toString(); final String tabId = id;
                WebView view = new WebView(getContext());
                view.getSettings().setJavaScriptEnabled(true); view.getSettings().setDomStorageEnabled(true);
                view.getSettings().setAllowFileAccess(false); view.getSettings().setAllowContentAccess(false);
                view.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
                // No addJavascriptInterface and no Capacitor bridge on untrusted pages.
                view.setWebViewClient(new WebViewClient() {
                    @Override public android.webkit.WebResourceResponse shouldInterceptRequest(WebView page, WebResourceRequest request) {
                        try {
                            if (restrictedHost(request.getUrl().getHost())) return new android.webkit.WebResourceResponse("text/plain", "UTF-8", new java.io.ByteArrayInputStream(new byte[0]));
                        } catch (Exception error) { return new android.webkit.WebResourceResponse("text/plain", "UTF-8", new java.io.ByteArrayInputStream(new byte[0])); }
                        return super.shouldInterceptRequest(page, request);
                    }
                    @Override public boolean shouldOverrideUrlLoading(WebView page, WebResourceRequest request) {
                        if (allowed("browsing") && webUrl(request.getUrl().toString())) return false;
                        if (request.isForMainFrame()) {
                            PluginCall waiting = pending.remove(tabId);
                            if (waiting != null) waiting.reject("This navigation is blocked by browser policy or browsing permission.");
                        }
                        return true;
                    }
                    @Override public void onPageFinished(WebView page, String url) { PluginCall waiting = pending.remove(tabId); if (waiting != null) waiting.resolve(new JSObject().put("tab", info(tabId))); }
                    @Override public void onReceivedError(WebView page, WebResourceRequest request, WebResourceError error) { if (request.isForMainFrame()) { PluginCall waiting = pending.remove(tabId); if (waiting != null) waiting.reject("The website could not load. Inspect the source tab."); } }
                });
                tabs.put(id, view); ((ViewGroup) getBridge().getWebView().getParent()).addView(view, bounds); select(id); waitNavigation(id, call); view.loadUrl(address); return;
            }
            final String tabId = id; WebView view = tabs.get(id);
            if (view == null) { call.reject("Tab not found."); return; }
            switch (action) {
                case "switch": select(id); call.resolve(new JSObject().put("tab", info(id))); break;
                case "close":
                    PluginCall waiting = pending.remove(id); if (waiting != null) waiting.reject("Tab closed.");
                    view.stopLoading(); ((ViewGroup) view.getParent()).removeView(view); view.destroy(); tabs.remove(id);
                    if (active.equals(id)) select(tabs.isEmpty() ? "" : tabs.keySet().iterator().next()); call.resolve(); break;
                case "navigate":
                    String address = call.getString("url", ""); if (!webUrl(address)) { call.reject("Only HTTPS websites are supported."); return; }
                    select(id); waitNavigation(id, call); view.loadUrl(address); break;
                case "back": case "forward": case "reload":
                    if (pending.containsKey(id)) { call.reject("Wait for the current navigation."); return; }
                    if ((action.equals("back") && !view.canGoBack()) || (action.equals("forward") && !view.canGoForward())) { call.resolve(new JSObject().put("tab", info(id))); return; }
                    waitNavigation(id, call); if (action.equals("back")) view.goBack(); else if (action.equals("forward")) view.goForward(); else view.reload(); break;
                case "evaluate":
                    String script = call.getString("script", "");
                    if (script.length() > 300000 || !webUrl(view.getUrl() == null ? "" : view.getUrl())) { call.reject("The page is not ready for an action."); return; }
                    String token = "__bb_mobile_" + UUID.randomUUID().toString().replace("-", "");
                    String key = JSONObject.quote(token);
                    view.evaluateJavascript("(async()=>{" + script + "})().then(value=>{window[" + key + "]=JSON.stringify({ok:true,value});},()=>{window[" + key + "]=JSON.stringify({ok:false});});void 0", null);
                    pollResult(view, tabId, token, view.getUrl(), SystemClock.elapsedRealtime(), call); break;
                default: call.reject("Unsupported browser action.");
            }
        });
    }
    private void pollResult(WebView view, String id, String token, String originalUrl, long started, PluginCall call) {
        if (!tabs.containsKey(id) || !allowed("browsing") || SystemClock.elapsedRealtime() - started > 20000) { call.reject("The page action stopped or timed out. Inspect the source tab before retrying."); return; }
        view.evaluateJavascript("window[" + JSONObject.quote(token) + "] || null", raw -> {
            if (raw == null || raw.equals("null")) {
                if (!originalUrl.equals(view.getUrl())) { call.reject("The page navigated. Read the new page before continuing."); return; }
                handler.postDelayed(() -> pollResult(view, id, token, originalUrl, started, call), 50); return;
            }
            view.evaluateJavascript("delete window[" + JSONObject.quote(token) + "]", null);
            try {
                String text = (String) new JSONTokener(raw).nextValue(); if (text.length() > 1000000) throw new Exception();
                JSONObject result = new JSONObject(text); if (!result.optBoolean("ok")) throw new Exception();
                call.resolve(new JSObject().put("value", result.opt("value")));
            } catch (Exception error) { call.reject("The page action could not complete. Inspect the source tab before retrying."); }
        });
    }
    @PluginMethod public void viewport(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            float scale = getContext().getResources().getDisplayMetrics().density;
            int width = Math.max(0, (int)(call.getDouble("width", 0.0) * scale)), height = Math.max(0, (int)(call.getDouble("height", 0.0) * scale));
            WebView bridgeView = getBridge().getWebView(); ViewGroup parent = (ViewGroup) bridgeView.getParent();
            int x = Math.max(0, (int)(call.getDouble("x", 0.0) * scale) + bridgeView.getLeft()), y = Math.max(0, (int)(call.getDouble("y", 0.0) * scale) + bridgeView.getTop());
            bounds = new CoordinatorLayout.LayoutParams(Math.max(0, Math.min(width, parent.getWidth() - x)), Math.max(0, Math.min(height, parent.getHeight() - y))); bounds.leftMargin = x; bounds.topMargin = y;
            visible = call.getBoolean("visible", false) && bounds.width > 0 && bounds.height > 0; select(active); call.resolve();
        });
    }
    @PluginMethod public void clearBrowserData(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            for (PluginCall waiting : pending.values()) waiting.reject("Browser data cleared."); pending.clear();
            for (WebView view : tabs.values()) { view.stopLoading(); view.clearCache(true); ((ViewGroup)view.getParent()).removeView(view); view.destroy(); }
            tabs.clear(); active = ""; WebStorage.getInstance().deleteAllData();
            CookieManager.getInstance().removeAllCookies(done -> { CookieManager.getInstance().flush(); call.resolve(); });
        });
    }
    @PluginMethod public void openExternal(PluginCall call) {
        String address = call.getString("url", "");
        if (!allowed("externalApps") || !webUrl(address)) { call.reject("Enable external links in Settings and choose an HTTPS page."); return; }
        getActivity().runOnUiThread(() -> new AlertDialog.Builder(getActivity()).setTitle("Open in another app?").setMessage(address).setNegativeButton("Cancel", (dialog, which) -> call.reject("Opening cancelled.")).setPositiveButton("Open", (dialog, which) -> {
            if (!allowed("externalApps")) { call.reject("Permission was revoked."); return; }
            try { getActivity().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(address))); call.resolve(); } catch (Exception error) { call.reject("No app can open this link."); }
        }).setOnCancelListener(dialog -> call.reject("Opening cancelled.")).show());
    }
    @Override protected void handleOnDestroy() {
        for (HttpURLConnection connection : requests.values()) connection.disconnect(); requests.clear(); network.shutdownNow();
        for (WebView view : tabs.values()) { view.stopLoading(); ((ViewGroup)view.getParent()).removeView(view); view.destroy(); } tabs.clear();
    }
}
