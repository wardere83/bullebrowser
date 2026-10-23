package com.bullebrowser.mobile;

import static org.junit.Assert.*;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import android.webkit.WebView;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Real Android bridge/WebView/Keystore test. No mocked native plugin or model key. */
@RunWith(AndroidJUnit4.class)
public class MobileAgentInstrumentedTest {
    private String evaluate(WebView view, String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>(); CountDownLatch ready = new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> view.evaluateJavascript(script, value -> { result.set(value); ready.countDown(); }));
        assertTrue("WebView evaluation timed out", ready.await(5, TimeUnit.SECONDS)); return result.get();
    }
    private JSONObject invoke(WebView view, String expression) throws Exception {
        String token = "__qa_" + UUID.randomUUID().toString().replace("-", ""), quoted = JSONObject.quote(token);
        evaluate(view, "(async()=>{try{window["+quoted+"]=JSON.stringify({value:await ("+expression+")});}catch(e){window["+quoted+"]=JSON.stringify({error:String(e.message||e)});}})();void 0");
        long deadline = System.currentTimeMillis()+45000;
        while (System.currentTimeMillis()<deadline) {
            String raw = evaluate(view, "window["+quoted+"]||null");
            if (raw != null && !raw.equals("null")) {
                evaluate(view, "delete window["+quoted+"]");
                return new JSONObject((String)new JSONTokener(raw).nextValue());
            }
            Thread.sleep(100);
        }
        throw new AssertionError("Native operation timed out");
    }
    private JSONObject success(WebView view, String expression) throws Exception {
        JSONObject result=invoke(view,expression); assertFalse("Native action failed: "+result.optString("error"),result.has("error")); return result.optJSONObject("value");
    }
    @Test public void nativeAccessBrowserIsolationAndCredentialLifecycle() throws Exception {
        assertEquals("com.bullebrowser.mobile", InstrumentationRegistry.getInstrumentation().getTargetContext().getPackageName());
        try (ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebView> holder=new AtomicReference<>(); scenario.onActivity(activity->holder.set(activity.getBridge().getWebView()));
            WebView view=holder.get(); long deadline=System.currentTimeMillis()+30000;
            while (!"true".equals(evaluate(view,"!!window.Capacitor?.Plugins?.MobileAgent"))) { assertTrue("Mobile UI did not initialize",System.currentTimeMillis()<deadline); Thread.sleep(100); }
            String api="window.Capacitor.Plugins.MobileAgent";
            JSONObject state=success(view,api+".getState()");
            assertFalse(state.getBoolean("browsing")); assertFalse(state.getBoolean("files")); assertFalse(state.getBoolean("externalApps"));
            assertTrue(invoke(view,api+".browser({action:'new',url:'https://example.com/'})").has("error"));
            success(view,api+".setAccess({capability:'browsing',enabled:true})");
            success(view,api+".viewport({x:0,y:160,width:320,height:240,visible:true})");
            JSONObject opened=success(view,api+".browser({action:'new',url:'https://example.com/'})");
            String tab=JSONObject.quote(opened.getJSONObject("tab").getString("id"));
            String script=JSONObject.quote("return {title:document.title,hasBridge:!!window.Capacitor||!!window.androidBridge};");
            JSONObject page=success(view,api+".browser({action:'evaluate',tabId:"+tab+",script:"+script+"})").getJSONObject("value");
            assertEquals("Example Domain",page.getString("title")); assertFalse(page.getBoolean("hasBridge"));
            success(view,api+".setKey({provider:'anthropic',key:'qa-placeholder-not-a-real-provider-key'})");
            assertTrue(success(view,api+".getState()").getBoolean("hasKeyAnthropic"));
            success(view,api+".setKey({provider:'anthropic',key:''})");
            assertFalse(success(view,api+".getState()").getBoolean("hasKeyAnthropic"));
            success(view,api+".setAccess({capability:'browsing',enabled:false})");
            assertTrue(invoke(view,api+".browser({action:'evaluate',tabId:"+tab+",script:'return document.title;'})").has("error"));
            success(view,api+".clearBrowserData()");
            assertEquals(0,success(view,api+".browser({action:'list'})").getJSONArray("tabs").length());
        }
    }
}
