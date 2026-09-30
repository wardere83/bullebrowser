/*
 * BulleBrowser embed widget — a LiveChat-style launcher bubble + chat panel you
 * drop into a page (for example a CRM or client portal) to replace a chatbot.
 * The BulleBrowser agent then operates the CRM in the user's own logged-in
 * session, right on the page the widget lives in.
 *
 * Embed (replaces the LiveChat snippet):
 *   <script src="https://bullebrowser.com/widget.js"></script>
 *   <script>
 *     BulleBrowser.init({
 *       endpoint: 'https://YOUR-BACKEND',  // required — see the contract below
 *       title: 'BulleBrowser',             // optional
 *       accent: '#2563EB',                 // optional
 *       greeting: 'Ask me to do anything in the CRM.'  // optional
 *     });
 *   </script>
 *
 * Why a backend is required: an API key must never live in page JavaScript, so
 * the model loop runs on a small backend you host. The widget executes the
 * agent's tool calls against THIS page (that's the whole point — it drives the
 * CRM), and streams results back. The transport is SSE + POST, no WebSocket, so
 * it works through corporate proxies.
 *
 * Backend contract (host these three; the agent loop uses @bullebrowser/agent-core):
 *   POST {endpoint}/start        body: { sessionId, prompt, url, title }
 *                                 -> 200; begins a run for this session
 *   GET  {endpoint}/stream?sessionId=…   Server-Sent Events, each `data:` a JSON:
 *          { type:'activity', text }             a human step label
 *          { type:'tool_call', id, name, input } run this tool on the page
 *          { type:'text', text }                 assistant prose (may stream)
 *          { type:'done' } | { type:'error', message }
 *   POST {endpoint}/tool-result  body: { sessionId, id, result }  (or { error })
 *                                 -> the run continues with this result
 *
 * The widget is self-contained: no framework, everything inside a shadow root
 * so the host page's CSS can't touch it and its CSS can't leak out.
 */
(function () {
  'use strict';
  if (window.BulleBrowser && window.BulleBrowser.__mounted) return;

  // The script tag that loaded us — captured now, while it's the running
  // script, so a single self-configuring tag can install the widget with no
  // inline JS (the way a chat-widget snippet usually works):
  //   <script src="https://bullebrowser.com/widget.js"
  //           data-endpoint="https://your-backend" data-title="BulleBrowser"></script>
  var TAG =
    document.currentScript ||
    (function () {
      var all = document.getElementsByTagName('script');
      for (var i = all.length - 1; i >= 0; i--) if (/widget\.js/.test(all[i].src)) return all[i];
      return null;
    })();

  var CFG = { endpoint: '', token: '', title: 'BulleBrowser', accent: '#2563EB', greeting: 'Ask me to do anything on this page — I\'ll browse it for you.' };

  // ---- tiny helpers ---------------------------------------------------------
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function uid() {
    return 's-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36);
  }
  var reduceMotion =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- the agent cursor drawn on the host page ------------------------------
  // Same idea as the desktop app: a visible pointer so the user can see the
  // agent move, click and type on the page. Lives in its own shadow host.
  function cursor(x, y, opts) {
    opts = opts || {};
    try {
      var id = '__bb_widget_cursor__';
      var host = document.getElementById(id);
      if (!host) {
        host = el('div');
        host.id = id;
        host.setAttribute('aria-hidden', 'true');
        host.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483646;pointer-events:none;';
        document.body.appendChild(host);
        var r = host.attachShadow({ mode: 'open' });
        r.innerHTML =
          '<style>:host{all:initial}' +
          '.p{position:fixed;width:22px;height:22px;margin:-2px 0 0 -2px;' +
          'transition:transform ' + (reduceMotion ? '0s' : '.45s cubic-bezier(.22,1,.36,1)') +
          ';filter:drop-shadow(0 1px 3px rgba(0,0,0,.4))}' +
          '.r{position:fixed;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:2px solid ' +
          CFG.accent + ';opacity:0}.r.go{animation:bbp .5s ease-out}' +
          '@keyframes bbp{0%{opacity:.9;transform:scale(.4)}100%{opacity:0;transform:scale(3)}}</style>' +
          '<svg class="p" viewBox="0 0 24 24" fill="none"><path d="M5 3l14 8.5-6.2 1.4L9.8 19 5 3z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>' +
          '<div class="r"></div>';
      }
      var root = host.shadowRoot;
      var p = root.querySelector('.p');
      var ring = root.querySelector('.r');
      p.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      if (opts.click) {
        ring.style.left = x + 'px';
        ring.style.top = y + 'px';
        ring.classList.remove('go');
        void ring.offsetWidth;
        ring.classList.add('go');
      }
    } catch (e) {
      /* an overlay must never break the action it illustrates */
    }
  }
  function cursorAt(el2, opts) {
    var r = el2.getBoundingClientRect();
    cursor(r.left + r.width / 2, r.top + r.height / 2, opts);
  }

  // ---- inline DOM tool runtime (drives the host page) -----------------------
  function deepAll(sel) {
    var out = [];
    (function walk(node) {
      var f;
      try { f = node.querySelectorAll(sel); } catch (e) { return; }
      for (var i = 0; i < f.length; i++) out.push(f[i]);
      var all = node.querySelectorAll('*');
      for (var j = 0; j < all.length; j++) if (all[j].shadowRoot) walk(all[j].shadowRoot);
    })(document);
    return out;
  }
  function deepOne(sel) { return deepAll(sel)[0] || null; }
  function visible(e) { var r = e.getBoundingClientRect(); return r.width > 0 || r.height > 0; }
  function readable() {
    var m = document.querySelector('main, article, [role="main"]') || document.body;
    return m ? (m.innerText || '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 50000) : '';
  }
  function label(n) {
    return ((n.innerText || n.getAttribute('aria-label') || n.value || '') + '').trim().toLowerCase();
  }
  function findClickable(t) {
    try { var s = deepOne(t); if (s) return s; } catch (e) {}
    var tl = t.toLowerCase();
    var c = deepAll('a,button,[role="button"],input[type="submit"],input[type="button"],summary,[role="link"],[role="menuitem"],[role="tab"]');
    var vis = c.filter(visible); var pool = vis.length ? vis : c;
    return pool.filter(function (n) { return label(n) === tl; })[0] ||
           pool.filter(function (n) { return label(n).indexOf(tl) >= 0; })[0] || null;
  }
  function findField(t) {
    try { var s = deepOne(t); if (s) return s; } catch (e) {}
    var tl = t.toLowerCase();
    var labels = document.querySelectorAll('label');
    for (var i = 0; i < labels.length; i++) {
      if ((labels[i].innerText || '').toLowerCase().indexOf(tl) >= 0) {
        var fid = labels[i].getAttribute('for');
        var ctl = fid ? document.getElementById(fid) : labels[i].querySelector('input,textarea');
        if (ctl) return ctl;
      }
    }
    var inputs = deepAll('input,textarea,[contenteditable=""],[contenteditable="true"]');
    return inputs.filter(function (n) {
      var ph = (n.placeholder || '').toLowerCase(), ar = (n.getAttribute('aria-label') || '').toLowerCase(),
          nm = (n.name || '').toLowerCase();
      return ph.indexOf(tl) >= 0 || ar.indexOf(tl) >= 0 || nm.indexOf(tl) >= 0;
    })[0] || null;
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // Execute one tool call from the backend. Returns a JSON-safe result or throws.
  function runTool(name, input) {
    input = input || {};
    switch (name) {
      case 'read_page':
      case 'getPageMetadata': {
        var txt = readable();
        if (name === 'getPageMetadata') return { title: document.title, url: location.href };
        if (!txt) throw new Error('The page has no readable text yet.');
        return { title: document.title, url: location.href, text: txt };
      }
      case 'navigate': {
        var dest = new URL(input.url, location.href);
        if (dest.origin !== location.origin)
          throw new Error('Refusing to leave ' + location.origin + ' — click a link to move within the app instead.');
        location.assign(dest.href);
        return { url: location.href, title: document.title };
      }
      case 'click': {
        var e = findClickable(input.target);
        if (!e) throw new Error('No element matched: ' + input.target);
        e.scrollIntoView({ block: 'center' });
        cursorAt(e, { click: true });
        return sleep(320).then(function () { e.click(); return { matched: (e.outerHTML || '').slice(0, 200) }; });
      }
      case 'type': {
        var f = findField(input.target);
        if (!f) throw new Error('No input matched: ' + input.target);
        f.scrollIntoView({ block: 'center' });
        cursorAt(f);
        f.focus();
        var text = input.text || '', isCE = f.isContentEditable;
        var setter = isCE ? null : Object.getOwnPropertyDescriptor(
          f instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set;
        var write = function (v) {
          if (isCE) { f.textContent = v; f.dispatchEvent(new InputEvent('input', { bubbles: true, data: v })); }
          else { setter ? setter.call(f, v) : (f.value = v); f.dispatchEvent(new Event('input', { bubbles: true })); }
        };
        var per = Math.max(8, Math.min(28, Math.round(1400 / Math.max(1, text.length))));
        return (async function () {
          for (var i = 1; i <= text.length; i++) { write(text.slice(0, i)); await sleep(per); }
          if (!isCE) f.dispatchEvent(new Event('change', { bubbles: true }));
          return { matched: (f.outerHTML || '').slice(0, 200) };
        })();
      }
      case 'scroll': {
        var doc = document.scrollingElement || document.documentElement, amt = input.amount || 600;
        var d = input.direction;
        if (d === 'up') window.scrollBy({ top: -amt, behavior: 'smooth' });
        else if (d === 'top') window.scrollTo({ top: 0, behavior: 'smooth' });
        else if (d === 'bottom') window.scrollTo({ top: doc.scrollHeight, behavior: 'smooth' });
        else window.scrollBy({ top: amt, behavior: 'smooth' });
        return { scrolledTo: doc.scrollTop };
      }
      case 'wait_for': {
        var timeout = Math.min(input.timeoutMs || 10000, 10000);
        if (input.selector) {
          var start = Date.now();
          return (async function () {
            while (Date.now() - start < timeout) { if (deepOne(input.selector)) return { matched: true }; await sleep(100); }
            return { matched: false };
          })();
        }
        return sleep(Math.min(1200, timeout)).then(function () { return { matched: true }; });
      }
      case 'listLinks': {
        var seen = {}, out = [], a = deepAll('a[href]');
        for (var i = 0; i < a.length; i++) {
          var h = a[i].href;
          if (!h || !/^https?:/i.test(h) || seen[h] || !visible(a[i])) continue;
          seen[h] = 1; out.push({ text: (a[i].innerText || '').trim().slice(0, 120), href: h });
          if (out.length >= 200) break;
        }
        return { links: out };
      }
      case 'getSelection': return { text: String(window.getSelection ? window.getSelection() : '') };
      case 'queryDom': return { matches: deepAll(input.selector).length };
      case 'go_back': history.back(); return sleep(400).then(function () { return { url: location.href }; });
      case 'go_forward': history.forward(); return sleep(400).then(function () { return { url: location.href }; });
      case 'reload': location.reload(); return { url: location.href };
      case 'extract': {
        var heads = [].slice.call(document.querySelectorAll('h1,h2,h3')).slice(0, 50)
          .map(function (h) { return { level: h.tagName, text: (h.innerText || '').trim() }; });
        return { data: { headings: heads, _text: readable() } };
      }
      case 'press_key': {
        var t2 = document.activeElement || document.body;
        ['keydown', 'keyup'].forEach(function (ty) { t2.dispatchEvent(new KeyboardEvent(ty, { key: input.key, bubbles: true })); });
        return { pressed: input.key };
      }
      default:
        throw new Error('This tool is not available in the embedded widget: ' + name);
    }
  }

  // ---- transport: run a task against the backend ----------------------------
  function runTask(sessionId, prompt, ui) {
    if (!CFG.endpoint) {
      ui.answer('The assistant is not connected yet (no backend endpoint configured).');
      ui.done();
      return;
    }
    var base = CFG.endpoint.replace(/\/$/, '');
    fetch(base + '/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ sessionId: sessionId, prompt: prompt, url: location.href, title: document.title, token: CFG.token }),
    }).catch(function () {});

    var es = new EventSource(base + '/stream?sessionId=' + encodeURIComponent(sessionId) + '&token=' + encodeURIComponent(CFG.token), { withCredentials: true });
    ui.onStop(function () { try { es.close(); } catch (e) {} });

    es.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'activity') ui.activity(msg.text);
      else if (msg.type === 'text') ui.answer(msg.text);
      else if (msg.type === 'done') { es.close(); ui.done(); }
      else if (msg.type === 'error') { es.close(); ui.error(msg.message); }
      else if (msg.type === 'tool_call') {
        Promise.resolve()
          .then(function () { return runTool(msg.name, msg.input); })
          .then(function (result) { post(base, sessionId, msg.id, { result: result }); })
          .catch(function (err) { post(base, sessionId, msg.id, { error: String(err && err.message || err) }); });
      }
    };
    es.onerror = function () { es.close(); ui.error('Lost connection to the assistant.'); };
  }
  function post(base, sessionId, id, payload) {
    fetch(base + '/tool-result', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(Object.assign({ sessionId: sessionId, id: id, token: CFG.token }, payload)),
    }).catch(function () {});
  }

  // ---- the widget UI (launcher + panel) -------------------------------------
  function mount() {
    var host = el('div');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
    var root = host.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<style>' +
      ':host{all:initial}' +
      '*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}' +
      '.launch{position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;' +
      'background:' + CFG.accent + ';color:#fff;border:0;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.25);' +
      'display:grid;place-items:center;z-index:2147483647;transition:transform .15s}' +
      '.launch:hover{transform:scale(1.05)}' +
      '.panel{position:fixed;right:20px;bottom:88px;width:380px;max-width:calc(100vw - 40px);height:560px;' +
      'max-height:calc(100vh - 120px);background:#fff;border-radius:16px;box-shadow:0 16px 48px rgba(0,0,0,.28);' +
      'display:none;flex-direction:column;overflow:hidden;z-index:2147483647;border:1px solid #E5E7EB}' +
      '.panel.open{display:flex;animation:' + (reduceMotion ? 'none' : 'rise .18s ease-out') + '}' +
      '@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}' +
      '.hd{background:' + CFG.accent + ';color:#fff;padding:14px 16px;display:flex;align-items:center;justify-content:space-between}' +
      '.hd b{font-size:14px}.hd button{background:transparent;border:0;color:#fff;cursor:pointer;font-size:18px;opacity:.9}' +
      '.msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;background:#fff}' +
      '.u{align-self:flex-end;max-width:85%;background:' + CFG.accent + ';color:#fff;padding:8px 12px;border-radius:14px 14px 4px 14px;font-size:13px;line-height:1.45}' +
      '.a{align-self:flex-start;max-width:92%;color:#0F172A;font-size:13px;line-height:1.5;white-space:pre-wrap}' +
      '.act{align-self:flex-start;display:flex;align-items:center;gap:6px;font-size:12px;color:#475569;background:#F3F4F6;padding:6px 10px;border-radius:8px}' +
      '.dot{width:6px;height:6px;border-radius:50%;background:' + CFG.accent + ';animation:' + (reduceMotion ? 'none' : 'pulse 1.4s infinite') + '}' +
      '@keyframes pulse{0%,100%{opacity:.3}50%{opacity:1}}' +
      '.greet{color:#64748B;font-size:13px;line-height:1.5}' +
      '.cmp{border-top:1px solid #E5E7EB;padding:10px;display:flex;gap:8px;align-items:flex-end}' +
      '.cmp textarea{flex:1;border:1px solid #E5E7EB;border-radius:10px;padding:8px 10px;font-size:13px;resize:none;outline:none;max-height:96px}' +
      '.cmp textarea:focus{border-color:' + CFG.accent + '}' +
      '.cmp button{height:36px;padding:0 14px;border:0;border-radius:10px;background:' + CFG.accent + ';color:#fff;font-weight:600;font-size:13px;cursor:pointer}' +
      '.cmp button.stop{background:#fff;color:#DC2626;border:1px solid #DC2626}' +
      '</style>' +
      '<button class="launch" aria-label="Open assistant">' +
      '<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M4 5h16v11H8l-4 4V5z" fill="#fff"/></svg></button>' +
      '<section class="panel" role="dialog" aria-label="' + CFG.title + '">' +
      '<div class="hd"><b>' + CFG.title + '</b><button class="x" aria-label="Close">×</button></div>' +
      '<div class="msgs"><div class="greet">' + CFG.greeting + '</div></div>' +
      '<div class="cmp"><textarea rows="1" placeholder="Ask ' + CFG.title + '…"></textarea>' +
      '<button class="send">Send</button></div>' +
      '</section>';

    var launch = root.querySelector('.launch');
    var panel = root.querySelector('.panel');
    var msgs = root.querySelector('.msgs');
    var ta = root.querySelector('textarea');
    var sendBtn = root.querySelector('.send');
    var running = false, stopFns = [], queue = [];

    function toggle(open) {
      var show = open == null ? !panel.classList.contains('open') : open;
      panel.classList.toggle('open', show);
      if (show) ta.focus();
    }
    launch.addEventListener('click', function () { toggle(); });
    root.querySelector('.x').addEventListener('click', function () { toggle(false); });

    function addUser(t) { var n = el('div', 'u'); n.textContent = t; msgs.appendChild(n); scroll(); }
    function scroll() { msgs.scrollTop = msgs.scrollHeight; }

    // A single run's UI handle.
    function makeRun() {
      var actEl = null, ansEl = null;
      return {
        activity: function (t) {
          if (!actEl) { actEl = el('div', 'act', '<span class="dot"></span><span></span>'); msgs.appendChild(actEl); }
          actEl.querySelector('span:last-child').textContent = t;
          scroll();
        },
        answer: function (t) {
          if (actEl) { actEl.remove(); actEl = null; }
          if (!ansEl) { ansEl = el('div', 'a'); msgs.appendChild(ansEl); }
          ansEl.textContent = (ansEl.textContent || '') + t;
          scroll();
        },
        error: function (m) { if (actEl) actEl.remove(); var n = el('div', 'a'); n.style.color = '#DC2626'; n.textContent = m; msgs.appendChild(n); scroll(); finish(); },
        done: function () { if (actEl) actEl.remove(); finish(); },
        onStop: function (fn) { stopFns.push(fn); },
      };
    }
    function finish() {
      running = false;
      stopFns = [];
      setButton();
      if (queue.length) { var next = queue.shift(); start(next); }
    }
    function setButton() {
      if (running) { sendBtn.textContent = 'Stop'; sendBtn.classList.add('stop'); }
      else { sendBtn.textContent = 'Send'; sendBtn.classList.remove('stop'); }
    }

    function start(prompt) {
      running = true; setButton();
      addUser(prompt);
      runTask(uid(), prompt, makeRun());
    }
    function submit() {
      var t = (ta.value || '').trim();
      if (!t) { if (running) stopRun(); return; }
      ta.value = '';
      if (running) { queue.push(t); addUser(t + '  → queued'); return; }
      start(t);
    }
    function stopRun() { stopFns.forEach(function (fn) { try { fn(); } catch (e) {} }); finish(); }

    sendBtn.addEventListener('click', function () { if (running && !ta.value.trim()) stopRun(); else submit(); });
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    });

    return { open: function () { toggle(true); } };
  }

  // ---- public API -----------------------------------------------------------
  window.BulleBrowser = {
    __mounted: false,
    init: function (opts) {
      if (window.BulleBrowser.__mounted) return;
      opts = opts || {};
      // Only override defaults with values that were actually given, so an
      // omitted (undefined) option doesn't wipe out its default.
      for (var k in opts) if (opts[k] != null && opts[k] !== '') CFG[k] = opts[k];
      window.BulleBrowser.__mounted = true;
      var boot = function () {
        var api = mount();
        window.BulleBrowser.open = api.open;
      };
      if (document.body) boot();
      else window.addEventListener('DOMContentLoaded', boot);
    },
  };

  // Self-install from the script tag's data-* attributes, so the whole embed
  // can be one line with no inline script to be stripped or blocked.
  if (TAG && TAG.getAttribute('data-endpoint')) {
    var d = function (k) {
      return TAG.getAttribute('data-' + k) || undefined;
    };
    window.BulleBrowser.init({
      endpoint: d('endpoint'),
      token: d('token'),
      title: d('title'),
      accent: d('accent'),
      greeting: d('greeting'),
    });
  }
})();
