// Scripts injected into pages. Plain functions here are stringified with
// toString() and evaluated in the page, so they may only use page globals,
// the closure-local __bb helpers and their own arguments.


export const EXTRACT_READABLE_TEXT = `
  (function () {
    const ct = (document.contentType || '').toLowerCase();
    if (ct && !ct.includes('html') && !ct.includes('xml') && !ct.includes('text/plain')) {
      return { error: 'Page content type is ' + ct + ' (not HTML).' };
    }
    if (!document.body) {
      return { error: 'Document has no body to read.' };
    }
    // Read innerText off the LIVE document, not a clone. innerText is defined in
    // terms of rendered output, so on a detached clone (which is never rendered)
    // it silently degrades to textContent: every word boundary collapses
    // ("Sign inRegisterPricing") and display:none content — mega-menus, cookie
    // banners, unrendered SPA routes — gets pulled in. Reading the live node
    // fixes both, and makes the old script/style/noscript stripping redundant:
    // those aren't rendered, so innerText already skips them. Nothing is
    // mutated, so the user's page is untouched.
    // Prefer the main content, but not when it is a sliver of the page: forms,
    // results and sidebars often live outside <main>, and reading only it hid
    // them from the agent.
    const tidy = (el) => (el.innerText || el.textContent || '').replace(/\\n{3,}/g, '\\n\\n').trim();
    const main = document.querySelector('main, article, [role="main"]');
    let text = main ? tidy(main) : '';
    if (text.length < 600) text = tidy(document.body);
    if (!text) {
      return { error: 'Page is empty or rendered entirely client-side.' };
    }
    // Long pages are cut; the model is told so it can scroll or extract.
    return {
      text: text.length > 30_000 ? text.slice(0, 30_000) + '\\n… [page text continues — scroll and read again, or use extract]' : text,
    };
  })();
`;

// The same, as a bare expression for evalPage (no trailing semicolon).
export const READABLE_TEXT_EXPR = EXTRACT_READABLE_TEXT.trim().replace(/;$/, '');

export const EXTRACT_STRUCTURED = `
  (function () {
    const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
      .slice(0, 50)
      .map((h) => ({ level: h.tagName, text: (h.innerText || '').trim() }));
    const links = Array.from(document.querySelectorAll('a[href]'))
      .slice(0, 200)
      .map((a) => ({ text: (a.innerText || '').trim().slice(0, 120), href: a.href }));
    const tables = Array.from(document.querySelectorAll('table'))
      .slice(0, 10)
      .map((t) => Array.from(t.rows).slice(0, 50).map((r) => Array.from(r.cells).map((c) => (c.innerText || '').trim())));
    return { url: location.href, title: document.title, headings, links, tables };
  })();
`;

export const LIST_LINKS = `
  (function () {
    const out = [];
    const seen = new Set();
    for (const a of Array.from(document.querySelectorAll('a[href]'))) {
      // Skip links the user cannot see and non-navigational hrefs, so the
      // model isn't handed a mega-menu it can't act on.
      const href = a.href;
      if (!href || !/^https?:/i.test(href)) continue;
      if (seen.has(href)) continue;
      const rect = a.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      seen.add(href);
      out.push({ text: (a.innerText || a.textContent || '').trim().slice(0, 120), href });
      if (out.length >= 200) break;
    }
    return out;
  })();
`;

export function QUERY_DOM_FN(selector: string): number {
  try {
    return document.querySelectorAll(selector).length;
  } catch {
    throw new Error(`Invalid CSS selector: ${selector}`);
  }
}

// In-page helpers, injected before every action. One place decides how an
// element is found — by a ref from find_elements ("@12"), a CSS selector, or
// its visible label — so click, type, select_option, find_elements and the
// consent check (inspectTarget) always agree on which element is meant.
//
// Everything walks shadow roots too: document.querySelector does not pierce
// shadow DOM, so on any web-component site (YouTube's ytd-*, Salesforce
// Lightning, most modern design systems) a plain query failed with "No
// element matched" even though the control was right there.
//
// Plain JS in a raw string (no `${}`). It defines a local `__bb` inside each
// evaluated script, never anything on window: helpers kept on the page's
// window could be replaced by the page itself — a hostile page defining its
// own "facts" to dodge the consent check, or a no-op field guard.
export const PAGE_HELPERS = String.raw`
var __bb = (function () {
  var api = {};
  var FIELD_SEL = 'input:not([type=hidden]), textarea, select, [contenteditable=""], [contenteditable="true"], [role=textbox], [role=combobox], [role=searchbox]';
  var ACTION_SEL = 'a[href], button, summary, label, input[type=submit], input[type=button], input[type=reset], input[type=image], input[type=checkbox], input[type=radio], [role=button], [role=link], [role=tab], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=option], [role=checkbox], [role=radio], [role=switch], [onclick]';

  api.DeepAll = function (selector) {
    var out = [];
    var walk = function (node) {
      if (!node) return;
      var found;
      try { found = node.querySelectorAll(selector); } catch (e) { return; }
      for (var i = 0; i < found.length; i++) out.push(found[i]);
      var hosts;
      try { hosts = node.querySelectorAll('*'); } catch (e) { return; }
      for (var j = 0; j < hosts.length; j++) if (hosts[j].shadowRoot) walk(hosts[j].shadowRoot);
    };
    walk(document);
    return out;
  };
  api.DeepQuery = function (selector) {
    var all = api.DeepAll(selector);
    return all.length ? all[0] : null;
  };

  var clean = function (s) { return String(s || '').replace(/\s+/g, ' ').trim(); };
  var visible = api.Visible = function (el) {
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    var cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  var labelOf = api.Label = function (el) {
    var aria = el.getAttribute('aria-label');
    if (aria && clean(aria)) return clean(aria);
    var by = el.getAttribute('aria-labelledby');
    if (by) {
      var t = by.split(/\s+/).map(function (id) {
        var n = document.getElementById(id);
        return n ? n.innerText : '';
      }).join(' ');
      if (clean(t)) return clean(t);
    }
    if (el.labels && el.labels.length && clean(el.labels[0].innerText)) return clean(el.labels[0].innerText);
    var tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      var buttonish = tag === 'INPUT' && /^(submit|button|reset)$/i.test(el.type);
      return clean((buttonish && el.value) || el.placeholder || el.getAttribute('title') || el.name || el.id);
    }
    var img = el.querySelector && el.querySelector('img[alt]');
    return clean(el.innerText || el.textContent || el.getAttribute('title') || el.getAttribute('alt') || (img ? img.alt : ''));
  };

  var refSelector = function (target) {
    var m = /^\s*(?:@|ref\s*[:=#]?\s*)(\d+)\s*$/i.exec(target);
    return m ? '[data-bb-ref="' + m[1] + '"]' : null;
  };
  // A durable identity for an element: what it is (tag, role, accessible
  // name), where it sits (nearest landmark, position among its siblings) and
  // the attributes that rarely change. A ref remembers this fingerprint, so
  // after a re-render — when the original node is gone or a new one took its
  // place — the ref still finds the same control.
  var LANDMARK_SEL = 'main, nav, header, footer, aside, form, dialog, section[aria-label], section[aria-labelledby], [role=main], [role=navigation], [role=banner], [role=contentinfo], [role=complementary], [role=form], [role=dialog], [role=search], [role=region]';
  api.Fingerprint = function (el) {
    var land = el.parentElement && el.parentElement.closest ? el.parentElement.closest(LANDMARK_SEL) : null;
    var parent = el.parentElement;
    var index = parent ? Array.prototype.filter.call(parent.children, function (c) { return c.tagName === el.tagName; }).indexOf(el) : 0;
    return {
      tag: el.tagName,
      role: el.getAttribute('role') || '',
      name: labelOf(el).slice(0, 80).toLowerCase(),
      landmark: land ? (land.getAttribute('role') || land.tagName) + ':' + labelOf(land).slice(0, 30).toLowerCase() : '',
      index: index,
      id: el.id || '',
      attr: el.getAttribute('name') || '',
      type: el.getAttribute('type') || '',
      href: el.getAttribute('href') || '',
      placeholder: el.getAttribute('placeholder') || '',
    };
  };
  // How well an element matches a fingerprint. Tag and role must agree; the
  // accessible name must agree when the original had one.
  var fpScore = function (el, fp) {
    if (el.tagName !== fp.tag || (el.getAttribute('role') || '') !== fp.role) return -1;
    var now = api.Fingerprint(el);
    if (fp.name && now.name !== fp.name) return -1;
    var score = fp.name ? 4 : 0;
    ['id', 'attr', 'type', 'href', 'placeholder'].forEach(function (k) { if (fp[k] && now[k] === fp[k]) score += 3; });
    if (now.landmark === fp.landmark) score += 2;
    if (now.index === fp.index) score += 1;
    return score;
  };
  api.Refs = api.Refs || {};
  var byRef = function (target) {
    var sel = refSelector(target);
    if (!sel) return null;
    var n = sel.match(/"(\d+)"/)[1];
    var fp = api.Refs[n];
    var el = api.DeepQuery(sel);
    // Same node, still the same control: done.
    if (el && (!fp || fpScore(el, fp) >= 0)) return el;
    // Re-rendered (node replaced, or the number now sits on something else):
    // find the control by its fingerprint and move the ref onto it.
    if (fp) {
      if (el) el.removeAttribute('data-bb-ref');
      var best = null, bestScore = 0;
      api.DeepAll(fp.tag.toLowerCase()).forEach(function (c) {
        var sc = fpScore(c, fp) + (visible(c) ? 0.5 : 0);
        if (sc > bestScore) { best = c; bestScore = sc; }
      });
      // A name match alone, or two stable attributes, is enough to be sure.
      if (best && bestScore >= 3) {
        best.setAttribute('data-bb-ref', n);
        return best;
      }
    }
    throw new Error('No element matched ' + target.trim() + ' — it is no longer on the page and nothing like it was found. Call find_elements again.');
  };
  var bySelector = function (target) {
    try { return api.DeepQuery(target); } catch (e) { return null; }
  };
  var byText = function (target, selector, exactOnly) {
    var tl = clean(target).toLowerCase();
    var pool = api.DeepAll(selector);
    var vis = pool.filter(visible);
    if (vis.length) pool = vis;
    var part = null;
    for (var i = 0; i < pool.length; i++) {
      var l = labelOf(pool[i]).toLowerCase();
      if (!l) continue;
      if (l === tl) return pool[i];
      if (!part && l.indexOf(tl) !== -1) part = pool[i];
    }
    return exactOnly ? null : part;
  };
  // Order matters: a ref, then an element whose label IS the target, then a
  // CSS selector, then a label that contains it. Trying the selector first
  // turned "Details" or "Menu" into the <details> / <menu> element instead
  // of the button with that label.
  var resolve = function (target, selector) {
    return byRef(target) || byText(target, selector, true) || bySelector(target) || byText(target, selector, false);
  };
  var nearby = function (selector) {
    var seen = {};
    return api.DeepAll(selector).filter(visible).map(labelOf).filter(function (l) {
      if (!l || seen[l]) return false;
      seen[l] = true;
      return true;
    }).slice(0, 8).map(function (l) { return '"' + l.slice(0, 50) + '"'; }).join(', ');
  };

  api.FindClickable = function (target) {
    var el = resolve(target, ACTION_SEL) || byText(target, FIELD_SEL, false);
    if (!el) {
      var near = nearby(ACTION_SEL);
      throw new Error('No element matched: ' + target + (near ? '. Clickable things on the page include ' + near + '. Call find_elements for exact refs.' : '.'));
    }
    return el;
  };
  // The page's main writing surface: the largest visible editor. Word and
  // PowerPoint Online, Google Docs, email bodies — asked for as "the
  // document", "the editor", "the body", these have no label that says so.
  var EDITOR_SEL = '[contenteditable=""], [contenteditable="true"], [role=textbox], textarea';
  api.MainEditor = function () {
    var best = null, area = 0;
    api.DeepAll(EDITOR_SEL).filter(visible).forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.width * r.height > area) { area = r.width * r.height; best = el; }
    });
    return area > 20000 ? best : null;
  };
  api.FindField = function (target) {
    var el = resolve(target, FIELD_SEL);
    if (!el && /\b(document|doc|editor|body|page|canvas|writing|text area|content)\b/i.test(target)) el = api.MainEditor();
    if (!el) {
      // A <label> naming the field ("Email") stands in for its control.
      var label = byText(target, 'label');
      if (label) el = label.control || label.querySelector(FIELD_SEL);
    }
    if (!el) {
      var near = nearby(FIELD_SEL);
      throw new Error('No input matched: ' + target + (near ? '. Fields on the page include ' + near + '. Call find_elements for exact refs.' : '.'));
    }
    if (el.tagName === 'LABEL') el = el.control || el.querySelector(FIELD_SEL) || el;
    return el;
  };

  // A hard stop, independent of how the model named the field: a ref or a
  // selector carries none of the words the policy's name check looks for.
  api.GuardField = function (el) {
    var type = (el.getAttribute('type') || '').toLowerCase();
    var ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    if (type === 'password' || /cc-(number|csc|exp)|current-password|new-password|one-time-code/.test(ac)) {
      throw new Error('Typing into password, one-time-code or payment-card fields is blocked. Ask the user to fill that field in themselves.');
    }
  };

  api.Select = function (el, option) {
    if (el.tagName !== 'SELECT') {
      throw new Error('That element is not a <select> dropdown. Click it to open the menu, then click the option.');
    }
    var ol = clean(option).toLowerCase();
    var opts = Array.prototype.slice.call(el.options);
    var o = opts.filter(function (x) { return clean(x.text).toLowerCase() === ol; })[0] ||
      opts.filter(function (x) { return String(x.value).toLowerCase() === ol; })[0] ||
      opts.filter(function (x) { return clean(x.text).toLowerCase().indexOf(ol) !== -1; })[0];
    if (!o) {
      throw new Error('No option "' + option + '". The options are: ' + opts.slice(0, 25).map(function (x) { return clean(x.text); }).join(' | '));
    }
    // The prototype setter, so React-style controlled selects see the change.
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, o.value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return clean(o.text);
  };

  // A form "carries the user's data" unless it is only a search box.
  var dataForm = function (form) {
    if (!form || form.getAttribute('role') === 'search') return false;
    var fields = Array.prototype.filter.call(form.elements || [], function (f) {
      return /^(INPUT|TEXTAREA|SELECT)$/.test(f.tagName) && !/^(hidden|submit|button|reset|image)$/i.test(f.type || '');
    });
    for (var i = 0; i < fields.length; i++) {
      if (fields[i].tagName === 'TEXTAREA' || /^(password|email|tel|file)$/i.test(fields[i].type || '')) return true;
    }
    if (fields.length === 1 && /^(search|text)$/i.test(fields[0].type || 'text')) return false;
    return fields.length >= 2;
  };
  // How = 'click', 'Enter' or 'Space'. Enter and Space on a focused button
  // press it exactly like a click; Enter in a text field also submits its
  // form. 'activates' says the gesture presses a control, so the policy can
  // judge that control's label ("Delete account") as it would a click.
  api.Facts = function (el, how) {
    var form = el.form || (el.closest && el.closest('form'));
    var tag = el.tagName;
    var type = (el.getAttribute('type') || '').toLowerCase();
    var role = el.getAttribute('role');
    var isSubmitControl = (tag === 'BUTTON' && (type === '' || type === 'submit')) ||
      (tag === 'INPUT' && (type === 'submit' || type === 'image'));
    var isPressable = tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY' || role === 'button' || role === 'link' ||
      (tag === 'INPUT' && /^(submit|image|button|reset)$/.test(type));
    var submits = false;
    if (form) {
      submits = isSubmitControl;
      if (how === 'Enter' && tag === 'INPUT' && !/^(checkbox|radio|button|reset|file|range|color|submit|image)$/.test(type)) submits = true;
    }
    return {
      label: labelOf(el).slice(0, 120),
      submitsForm: submits && dataForm(form),
      activates: how === 'click' || isPressable,
    };
  };
  api.Focused = function () {
    var el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    return el || document.body;
  };

  var describe = function (el, ref) {
    var tag = el.tagName;
    var role = el.getAttribute('role');
    var type = (el.getAttribute('type') || '').toLowerCase();
    var kind;
    if (tag === 'A') kind = 'link';
    else if (tag === 'BUTTON' || role === 'button' || (tag === 'INPUT' && /^(submit|button|reset|image)$/.test(type))) kind = 'button';
    else if (tag === 'SELECT') kind = 'select';
    else if (tag === 'TEXTAREA') kind = 'textarea';
    else if (tag === 'INPUT') kind = type === 'checkbox' || type === 'radio' ? type : 'input[' + (type || 'text') + ']';
    else if (el.isContentEditable) kind = 'editor';
    else kind = role || tag.toLowerCase();
    var s = '@' + ref + ' ' + kind + ' "' + labelOf(el).slice(0, 80) + '"';
    if (tag === 'SELECT') {
      var sel = el.selectedOptions && el.selectedOptions[0];
      s += ' = "' + clean(sel ? sel.text : '') + '" options: ' +
        Array.prototype.slice.call(el.options, 0, 20).map(function (o) { return clean(o.text); }).join(' | ');
    } else if ((tag === 'INPUT' && !/^(checkbox|radio|submit|button|reset|image|password)$/.test(type)) || tag === 'TEXTAREA') {
      if (el.value) s += ' value="' + clean(el.value).slice(0, 60) + '"';
    }
    if (type === 'checkbox' || type === 'radio' || role === 'checkbox' || role === 'switch' || role === 'radio') {
      s += el.checked || el.getAttribute('aria-checked') === 'true' ? ' [checked]' : ' [unchecked]';
    }
    if (tag === 'A') {
      var h = el.getAttribute('href') || '';
      if (h && h.charAt(0) !== '#' && !/^javascript:/i.test(h)) s += ' -> ' + h.slice(0, 80);
    }
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') s += ' [disabled]';
    if (el.getAttribute('aria-expanded')) s += ' [expanded=' + el.getAttribute('aria-expanded') + ']';
    return s;
  };

  // Tag every visible control with a stable ref and describe it, controls in
  // view first. Refs stick to their element, so a ref stays valid across calls
  // until the page replaces that element.
  api.FindElements = function (query) {
    var all = api.DeepAll(ACTION_SEL + ', ' + FIELD_SEL).filter(visible);
    var seen = new Set();
    var list = [];
    all.forEach(function (el) {
      if (seen.has(el)) return;
      seen.add(el);
      // A label is listed through its control rather than twice.
      if (el.tagName === 'LABEL' && el.control && visible(el.control)) return;
      list.push(el);
    });
    var inView = function (el) {
      var r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < innerHeight ? 0 : 1;
    };
    // Document editors first — on a page like Word Online hundreds of toolbar
    // buttons came before the one control that mattered and cut it off —
    // then whatever is in view.
    var isEditor = function (el) { return el.isContentEditable || el.tagName === 'TEXTAREA' || el.getAttribute('role') === 'textbox' ? 0 : 1; };
    list.sort(function (a, b) { return isEditor(a) - isEditor(b) || inView(a) - inView(b); });
    // Numbering continues from the highest ref this tab has handed out (the
    // browser keeps that count), so a number is never reused for a different
    // control even after the page dropped the old one.
    var seq = api.RefSeq || 0;
    var lines = [];
    var fps = {};
    var refOf = [];
    for (var i = 0; i < list.length && i < 400; i++) {
      var el = list[i];
      var ref = el.getAttribute('data-bb-ref');
      if (!ref || !/^\d+$/.test(ref)) {
        seq += 1;
        ref = String(seq);
        el.setAttribute('data-bb-ref', ref);
      }
      lines.push(describe(el, ref));
      refOf.push(ref);
      fps[ref] = api.Fingerprint(el);
    }
    var pick = function (idxs) {
      var out = { lines: [], fps: {}, seq: seq };
      idxs.forEach(function (i) { out.lines.push(lines[i]); out.fps[refOf[i]] = fps[refOf[i]]; });
      return out;
    };
    // The query is loose words ("contact form fields", "email input"), not a
    // phrase: rank by how many of its words each element mentions. If none
    // mention any, return everything rather than an empty list the model
    // would read as "this page has no controls".
    var words = clean(query).toLowerCase().split(/[^a-z0-9]+/).filter(function (w) { return w.length > 2; });
    if (words.length) {
      var scored = lines.map(function (line, idx) {
        var l = line.toLowerCase();
        var n = words.filter(function (w) { return l.indexOf(w) !== -1; }).length;
        return { line: line, n: n, idx: idx };
      }).filter(function (x) { return x.n > 0; });
      if (scored.length) {
        scored.sort(function (a, b) { return b.n - a.n || a.idx - b.idx; });
        return pick(scored.slice(0, 80).map(function (x) { return x.idx; }));
      }
    }
    var all80 = [];
    for (var k = 0; k < Math.min(80, lines.length); k++) all80.push(k);
    var res = pick(all80);
    if (lines.length > 80) res.lines.push('… ' + (lines.length - 80) + ' more here — call find_elements with a query to narrow');
    return res;
  };
  return api;
})();
`;

// A visible pointer for the agent's actions. The agent clicks and types through
// the DOM, which is invisible — the page just changes and the user has no idea
// what happened or where. This paints a cursor at the element, pulses a ring
// where the click lands, and briefly outlines the element it acted on, so the
// user can follow along on their own screen.
//
// Everything lives in a shadow root under a single host element so it cannot
// inherit or leak page CSS, is skipped by the agent's own readers (it is added
// after read_page runs, and carries aria-hidden), and can be torn down by
// removing one node.
export const AGENT_CURSOR = `
  window.__bbCursor = function (el, opts) {
    opts = opts || {};
    try {
      var HOST_ID = '__bb_agent_cursor__';
      var host = document.getElementById(HOST_ID);
      if (!host) {
        host = document.createElement('div');
        host.id = HOST_ID;
        host.setAttribute('aria-hidden', 'true');
        host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
        (document.body || document.documentElement).appendChild(host);
        var root = host.attachShadow({ mode: 'open' });
        root.innerHTML =
          '<style>' +
          ':host{all:initial}' +
          '.ptr{position:fixed;width:22px;height:22px;margin:-2px 0 0 -2px;' +
            'transition:transform .45s cubic-bezier(.22,1,.36,1);will-change:transform;' +
            'filter:drop-shadow(0 1px 3px rgba(0,0,0,.4))}' +
          '.ring{position:fixed;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;' +
            'border:2px solid #20BAD1;opacity:0;pointer-events:none}' +
          '.ring.go{animation:bb-ring .5s ease-out forwards}' +
          '.halo{position:fixed;border:2px solid rgba(32, 186, 209,.9);border-radius:4px;' +
            'box-shadow:0 0 0 3px rgba(32, 186, 209,.18);opacity:0;transition:opacity .2s}' +
          '.halo.go{opacity:1}' +
          '@keyframes bb-ring{0%{opacity:.9;transform:scale(.4)}100%{opacity:0;transform:scale(3.2)}}' +
          '@media (prefers-reduced-motion:reduce){.ptr{transition:none}.ring.go{animation:none}}' +
          '</style>' +
          '<svg class="ptr" viewBox="0 0 24 24" fill="none">' +
            '<path d="M5 3l14 8.5-6.2 1.4L9.8 19 5 3z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/>' +
          '</svg>' +
          '<div class="ring"></div><div class="halo"></div>';
      }
      var root2 = host.shadowRoot;
      var ptr = root2.querySelector('.ptr');
      var ring = root2.querySelector('.ring');
      var halo = root2.querySelector('.halo');

      var x, y, r;
      if (opts.at) {
        // A bare point — used for gestures with no element, like scrolling.
        x = opts.at.x;
        y = opts.at.y;
      } else {
        r = el.getBoundingClientRect();
        x = r.left + r.width / 2;
        y = r.top + r.height / 2;
      }

      ptr.style.transform = 'translate(' + x + 'px,' + y + 'px)';

      if (r && opts.halo !== false) {
        halo.style.left = r.left + 'px';
        halo.style.top = r.top + 'px';
        halo.style.width = r.width + 'px';
        halo.style.height = r.height + 'px';
        halo.classList.add('go');
      } else {
        halo.classList.remove('go');
      }

      if (opts.click) {
        ring.style.left = x + 'px';
        ring.style.top = y + 'px';
        ring.classList.remove('go');
        void ring.offsetWidth; // restart the animation
        ring.classList.add('go');
      }

      clearTimeout(window.__bbCursorTimer);
      // Only the halo fades. The pointer itself stays put, so the user can see
      // where the agent is between actions instead of it teleporting out of
      // nowhere on the next one.
      window.__bbCursorTimer = setTimeout(function () {
        halo.classList.remove('go');
      }, opts.hold || 1400);
    } catch (e) {
      /* never let the overlay break the action it is illustrating */
    }
  };

  // Move the pointer to a viewport point, no element involved.
  window.__bbCursorTo = function (x, y) {
    window.__bbCursor(null, { at: { x: x, y: y }, halo: false });
  };
`;

// The local the injected PAGE_HELPERS define; CLICK_FN / TYPE_FN are inlined
// into the same script, so they close over it.
declare const __bb: {
  FindClickable(target: string): HTMLElement;
  FindField(target: string): HTMLElement;
  GuardField(el: Element): void;
  Select(el: Element, option: string): string;
  Label(el: Element): string;
  DeepQuery(selector: string): Element | null;
  Focused(): HTMLElement;
};
type PageWindow = Window & {
  __bbCursor(el: Element | null, opts?: Record<string, unknown>): void;
};

export interface ClickSpot {
  matched: string;
  /** Viewport point to press, within the element's own frame. */
  x: number;
  y: number;
  /** Nothing covers the element at that point (a banner, an overlay). */
  onTop: boolean;
  /** A selector for this exact element, so a fallback click hits it. */
  ref: string;
}

export function CLICK_SPOT_FN(target: string): Promise<ClickSpot> {
  const w = window as unknown as PageWindow;
  const first = __bb.FindClickable(target);
  first.scrollIntoView({ block: 'center', inline: 'nearest' });
  w.__bbCursor(first, { click: true });
  // Dwell so the user sees where it's going before the page changes.
  return new Promise<ClickSpot>((resolve, reject) => {
    setTimeout(() => {
      // A page can re-render during the dwell and replace the element; look it
      // up again (a ref resolves by its fingerprint) rather than measuring a
      // node that is no longer on the page.
      let node = first;
      if (!node.isConnected) {
        try {
          node = __bb.FindClickable(target);
        } catch (e) {
          return reject(e);
        }
      }
      const token = String(Date.now());
      node.setAttribute('data-bb-click', token);
      const label = __bb.Label(node).slice(0, 80);
      const tag = node.tagName.toLowerCase();
      const r = node.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2);
      const y = Math.round(r.top + Math.min(r.height / 2, 20));
      let top = document.elementFromPoint(x, y);
      while (top && top.shadowRoot) {
        const inner = top.shadowRoot.elementFromPoint(x, y);
        if (!inner || inner === top) break;
        top = inner;
      }
      const host = top ? (top.getRootNode() as ShadowRoot).host : null;
      const onTop = !!top && (top === node || node.contains(top) || top.contains(node) || (!!host && node.contains(host)));
      resolve({ matched: label ? `${tag} "${label}"` : tag, x, y, onTop, ref: `[data-bb-click="${token}"]` });
    }, 450);
  });
}

export function CLICK_FN(target: string): Promise<string> {
  const w = window as unknown as PageWindow;
  const node = __bb.FindClickable(target);
  node.scrollIntoView({ block: 'center', inline: 'nearest' });
  // Paint the cursor first, then dwell briefly before actually clicking.
  // Without the pause the click fires in the same frame the cursor appears, so
  // the page changes before the user's eye has anywhere to land — the whole
  // point is to show them where it went.
  w.__bbCursor(node, { click: true });
  const label = __bb.Label(node).slice(0, 80);
  const tag = node.tagName.toLowerCase();
  return new Promise<string>((resolve) => {
    setTimeout(() => {
      // The full press a mouse makes, not a bare click(): menus, date pickers
      // and many design-system buttons act on pointerdown/mousedown and
      // ignore a lone click event.
      const r = node.getBoundingClientRect();
      const at = {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
        button: 0,
        view: window,
      };
      const ptr = { ...at, pointerId: 1, pointerType: 'mouse', isPrimary: true };
      try {
        node.dispatchEvent(new PointerEvent('pointerdown', ptr));
        node.dispatchEvent(new MouseEvent('mousedown', at));
        node.focus({ preventScroll: true });
        node.dispatchEvent(new PointerEvent('pointerup', ptr));
        node.dispatchEvent(new MouseEvent('mouseup', at));
      } catch {
        /* the click below still runs */
      }
      node.click();
      resolve(label ? `${tag} "${label}"` : tag);
    }, 450);
  });
}

export function TYPE_FN(target: string, text: string): Promise<{ matched: string; native: boolean }> {
  const w = window as unknown as PageWindow;
  const html = __bb.FindField(target);
  __bb.GuardField(html);
  const label = __bb.Label(html).slice(0, 80);
  const described = label ? `${html.tagName.toLowerCase()} "${label}"` : html.tagName.toLowerCase();

  // A dropdown takes a choice, not keystrokes. Writing .value through the
  // input setter threw "Illegal invocation" on a <select>.
  if (html instanceof HTMLSelectElement) {
    const chose = __bb.Select(html, text);
    return Promise.resolve({ matched: `${described} = "${chose}"`, native: false });
  }

  html.scrollIntoView({ block: 'center' });
  w.__bbCursor(html, { click: true, hold: 4000 });
  html.focus();

  // Rich editors (Word Online, Google Docs, Gmail, Notion) — and any other
  // non-<input> field, like a role=combobox div — keep their own model and
  // ignore text written into the DOM, so the text itself
  // is sent afterwards as native keyboard input (see type() in the runtime).
  // Here: put the cursor in the editor — where it already is if the user or
  // the agent clicked into it, otherwise at the very end. Never select all:
  // in a document that would replace the whole thing with the new text.
  if (!(html instanceof HTMLInputElement) && !(html instanceof HTMLTextAreaElement)) {
    const sel = window.getSelection();
    if (sel && !(sel.rangeCount && html.contains(sel.anchorNode))) {
      const end = document.createRange();
      end.selectNodeContents(html);
      end.collapse(false);
      sel.removeAllRanges();
      sel.addRange(end);
    }
    return Promise.resolve({ matched: described, native: true });
  }

  const input = html as HTMLInputElement | HTMLTextAreaElement;
  const nativeSetter = Object.getOwnPropertyDescriptor(
    input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    'value',
  )?.set;

  // Write the field one character at a time so the user can actually watch it
  // being typed. Setting .value in one shot is instant and invisible — the
  // field just changes, which is precisely the "what did it do?" problem the
  // cursor exists to solve. Each keystroke dispatches its own input event, so
  // controlled inputs (React et al) and live search suggestions behave exactly
  // as they would for a human typist. Pace is capped so a long string doesn't
  // turn into a wait.
  //
  // At most ~60 visible steps (~1.5s) however long the text: typing a long
  // email body a character at a time outran the page-call timeout, and the
  // model's retry then typed into the field a second time. A hidden tab's
  // timers are throttled to ~1s, so there it is written in one go.
  const steps = document.hidden ? 1 : Math.min(text.length, 60);
  const chunk = Math.max(1, Math.ceil(text.length / Math.max(1, steps)));
  const perChar = 24;
  const write = (value: string) => {
    if (nativeSetter) nativeSetter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  write('');
  return new Promise<{ matched: string; native: boolean }>((resolve) => {
    // change fires once at the end, as it would when a person leaves a field.
    const finish = () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      resolve({ matched: described, native: false });
    };
    if (text.length === 0) return finish();
    let i = 0;
    const tick = () => {
      i = Math.min(text.length, i + chunk);
      write(text.slice(0, i));
      if (i < text.length) setTimeout(tick, perChar);
      else finish();
    };
    setTimeout(tick, perChar);
  });
}

export function SCROLL_FN(
  direction: 'up' | 'down' | 'top' | 'bottom',
  amount: number,
): number {
  const doc = document.scrollingElement || document.documentElement;
  // Park the pointer mid-viewport and let it drift the way the page is going,
  // so a scroll reads as the agent doing something rather than the page moving
  // on its own. No halo — there's no element being acted on.
  const to = (window as unknown as { __bbCursorTo?(x: number, y: number): void }).__bbCursorTo;
  if (to) {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const drift = direction === 'up' || direction === 'top' ? -60 : 60;
    to(cx, cy - drift);
    setTimeout(() => to(cx, cy + drift), 60);
  }
  switch (direction) {
    case 'down':
      window.scrollBy({ top: amount, behavior: 'smooth' });
      break;
    case 'up':
      window.scrollBy({ top: -amount, behavior: 'smooth' });
      break;
    case 'top':
      window.scrollTo({ top: 0, behavior: 'smooth' });
      break;
    case 'bottom':
      window.scrollTo({ top: doc.scrollHeight, behavior: 'smooth' });
      break;
  }
  return doc.scrollTop;
}

export function WAIT_FOR_SELECTOR(selector: string, timeoutMs: number): Promise<boolean> {
  // Deep query, like the actions: an element inside a shadow root counts.
  const find = (sel: string) => __bb.DeepQuery(sel);
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (find(selector)) return resolve(true);
      if (Date.now() - start > timeoutMs) return resolve(false);
      setTimeout(tick, 100);
    };
    tick();
  });
}

// What a consequential action would send — shown on the confirmation card
// before it runs, and returned by preview_action as a dry run. `target` null
// means the focused element (for Enter / Space). Values are what the page
// would submit, passwords masked, long values cut.
export function PREVIEW_FN(target: string | null): Record<string, unknown> {
  const el = (target === null ? __bb.Focused() : __bb.FindClickable(target)) as HTMLElement & {
    form?: HTMLFormElement | null;
    formAction?: string;
    formMethod?: string;
  };
  const label = __bb.Label(el).slice(0, 80);
  const form = el.form || (el.closest('form') as HTMLFormElement | null);
  const cut = (v: string, n = 300) => (v.length > n ? `${v.slice(0, n)}…` : v);
  if (!form) {
    const ctx = el.closest('dialog, [role=dialog], [role=alertdialog], section, article, form, main');
    const heading = ctx?.querySelector('h1, h2, h3, h4, [role=heading]');
    return {
      summary: label ? `Press "${label}"` : 'Press this control',
      pageUrl: location.href,
      ...(heading || ctx ? { note: cut(((heading as HTMLElement | null)?.innerText || (ctx as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim(), 200) } : {}),
    };
  }
  const fields: { label: string; value: string }[] = [];
  const files: { name: string; size?: number }[] = [];
  for (const f of Array.from(form.elements) as (HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement)[]) {
    if (!f.name || f.disabled) continue;
    const type = (f.type || '').toLowerCase();
    if (/^(submit|button|reset|image)$/.test(type)) continue;
    if ((type === 'checkbox' || type === 'radio') && !f.checked) continue;
    const name = __bb.Label(f) || f.name;
    if (type === 'file') {
      for (const file of Array.from(f.files || [])) files.push({ name: file.name, size: file.size });
      continue;
    }
    let value: string;
    if (type === 'password') value = '•'.repeat(Math.min(12, Math.max(6, f.value.length)));
    else if (f.tagName === 'SELECT') value = Array.from(f.selectedOptions).map((o) => o.text.trim()).join(', ');
    else if (type === 'checkbox' || type === 'radio') value = f.value === 'on' ? 'checked' : f.value;
    else value = f.value;
    fields.push({ label: type === 'hidden' ? `${f.name} (hidden)` : name.slice(0, 60), value: cut(value) });
  }
  const action = el.formAction && el.formAction !== location.href ? el.formAction : form.action;
  const method = ((el.formMethod || form.method || 'get') as string).toUpperCase();
  return {
    summary: `Submit the form${label ? ` with "${label}"` : ''}`,
    pageUrl: location.href,
    url: action,
    method,
    fields,
    ...(files.length ? { files } : {}),
  };
}
