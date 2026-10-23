// ToolRuntime implementation that drives the active WebContentsView via
// the Chrome DevTools Protocol (CDP). All of agent-core's tools are
// implemented here in terms of CDP commands and renderer evaluations.

import type { TabSummary, ToolRuntime } from '@bullebrowser/agent-core';
import type { WebContents } from 'electron';
import { tabManager } from '../tabs/manager.js';

export interface ConfirmDelegate {
  request(message: string): Promise<boolean>;
}

export class DesktopToolRuntime implements ToolRuntime {
  private touched = new Set<WebContents>();
  private readonly actionId = `${Date.now()}-${Math.random()}`;

  constructor(private confirmDelegate: ConfirmDelegate, private signal?: AbortSignal) {
    signal?.addEventListener('abort', () => {
      for (const wc of this.touched) {
        if (wc.isDestroyed()) continue;
        // Queue this in the same renderer before any pending action timer.
        void wc.executeJavaScript(`window.__bbCancelledRun = ${JSON.stringify(this.actionId)}`).catch(() => {});
        wc.stop();
      }
      this.touched.clear();
    }, { once: true });
  }

  private wcFor(tabId: string): WebContents {
    if (this.signal?.aborted) throw new Error('cancelled');
    const view = tabManager.getView(tabId);
    if (!view) throw new Error(`Tab not found: ${tabId}`);
    this.touched.add(view.webContents);
    return view.webContents;
  }

  async navigate(tabId: string, url: string) {
    const wc = this.wcFor(tabId);
    // Second line of defence behind the navigate schema's allowlist: the agent
    // drives a real browser holding the user's live sessions, so a file: or
    // data: URL reaching this point (from a future caller, or a tool that skips
    // validation) must still not open.
    let scheme: string;
    try {
      scheme = new URL(url).protocol;
    } catch {
      throw new Error(`Not a valid URL: ${url}`);
    }
    if (scheme !== 'http:' && scheme !== 'https:') {
      throw new Error(
        `Refusing to open a ${scheme} URL. The agent may only open http:// and https:// pages.`,
      );
    }
    // loadURL rejects with ERR_ABORTED (-3) on perfectly ordinary events: a
    // redirect, a client-side navigation, or a URL that turns into a download.
    // The rest of the codebase already ignores -3 (see tabs/manager.ts); this
    // path used to propagate it, so the tool reported failure while the page
    // sat loaded in the tab. Report what actually ended up on screen instead.
    await wc.loadURL(url).catch(() => {});
    // A page load wipes the overlay with the old document, so the agent would
    // be invisible on a fresh page until its first click. Put the pointer back
    // straight away, parked where a person's would be, so the user can see the
    // agent is on the page and follow it from the first move rather than having
    // a cursor appear from nowhere mid-action.
    await wc
      .executeJavaScript(
        `${AGENT_CURSOR}; window.__bbCursorTo(Math.round(window.innerWidth * 0.28), Math.round(window.innerHeight * 0.3));`,
      )
      .catch(() => {
        // about:blank, an error page, a PDF viewer — nothing to draw on, and
        // the navigation itself still succeeded.
      });
    return { url: wc.getURL(), title: wc.getTitle() };
  }

  async readPage(tabId: string) {
    const wc = this.wcFor(tabId);
    const result = (await wc.executeJavaScript(EXTRACT_READABLE_TEXT)) as
      | { text: string }
      | { error: string };
    if ('error' in result) {
      throw new Error(
        `${result.error} The read_page tool only supports HTML pages. ` +
          `For PDFs or other documents, ask the user to convert to HTML or paste the text directly.`,
      );
    }
    return { title: wc.getTitle(), url: wc.getURL(), text: result.text };
  }

  async click(tabId: string, target: string) {
    const wc = this.wcFor(tabId);
    const matched = (await wc.executeJavaScript(
      `${DEEP_QUERY}; ${AGENT_CURSOR}; (${CLICK_FN.toString()})(${JSON.stringify(target)}, ${JSON.stringify(this.actionId)})`,
    )) as string;
    return { matched };
  }

  async type(tabId: string, target: string, text: string) {
    const wc = this.wcFor(tabId);
    const matched = (await wc.executeJavaScript(
      `${DEEP_QUERY}; ${AGENT_CURSOR}; (${TYPE_FN.toString()})(${JSON.stringify(target)}, ${JSON.stringify(text)}, ${JSON.stringify(this.actionId)})`,
    )) as string;
    return { matched };
  }

  async extract(tabId: string, schema: Record<string, unknown>) {
    // Render-side best-effort extractor: returns the requested schema echo
    // plus a structured dump of the visible page (headings, links, tables,
    // and readable body text) so the agent can re-shape it without a
    // second navigation round-trip.
    const wc = this.wcFor(tabId);
    const structured = (await wc.executeJavaScript(EXTRACT_STRUCTURED)) as unknown;
    const readable = (await wc.executeJavaScript(EXTRACT_READABLE_TEXT)) as
      | { text: string }
      | { error: string };
    const text = 'text' in readable ? readable.text : '';
    return { data: { _schema: schema, _document: structured, _text: text } };
  }

  // These three are optional on ToolRuntime, but the tools are offered to the
  // model regardless, and their fallbacks fail *quietly* — getSelection returned
  // '' (model: "nothing is selected") and listLinks regexed URLs out of body
  // text, where hrefs never appear (model: "this page has no links"). Implement
  // them for real; the page already exposes everything they need.
  async getSelection(tabId: string): Promise<{ text: string }> {
    const wc = this.wcFor(tabId);
    const text = (await wc.executeJavaScript(
      `String(window.getSelection ? window.getSelection().toString() : '')`,
    )) as string;
    return { text };
  }

  async listLinks(tabId: string): Promise<{ text: string; href: string }[]> {
    const wc = this.wcFor(tabId);
    return (await wc.executeJavaScript(LIST_LINKS)) as { text: string; href: string }[];
  }

  async queryDom(tabId: string, selector: string): Promise<{ matches: number }> {
    const wc = this.wcFor(tabId);
    const matches = (await wc.executeJavaScript(
      `(${QUERY_DOM_FN.toString()})(${JSON.stringify(selector)})`,
    )) as number;
    return { matches };
  }

  async screenshot(tabId: string) {
    const wc = this.wcFor(tabId);
    const image = await wc.capturePage();
    return { pngBase64: image.toPNG().toString('base64') };
  }

  async newTab(url?: string): Promise<TabSummary> {
    const tab = await tabManager.create(url);
    return { id: tab.id, title: tab.title, url: tab.url, active: tab.active };
  }

  async switchTab(tabId: string): Promise<TabSummary> {
    tabManager.activate(tabId);
    const list = tabManager.list();
    const tab = list.find((t) => t.id === tabId);
    if (!tab) throw new Error(`Tab not found: ${tabId}`);
    return { id: tab.id, title: tab.title, url: tab.url, active: tab.active };
  }

  async listTabs(): Promise<TabSummary[]> {
    return tabManager.list().map((t) => ({
      id: t.id,
      title: t.title,
      url: t.url,
      active: t.active,
    }));
  }

  async closeTab(tabId: string): Promise<{ closed: boolean }> {
    if (!tabManager.getView(tabId)) return { closed: false };
    await tabManager.close(tabId);
    return { closed: true };
  }

  // goBack/goForward/reload are fire-and-forget in Electron: the history call
  // returns immediately and the navigation lands later. Reading getURL() right
  // after therefore returned the URL we just left, so the model saw an
  // unchanged URL, decided the step hadn't worked, and went back a second time.
  // Wait for the navigation to actually commit.
  private async afterNavigation(wc: WebContents, act: () => Promise<void>): Promise<{ url: string }> {
    const settled = new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        wc.off('did-navigate', done);
        wc.off('did-navigate-in-page', done);
        wc.off('did-fail-load', done);
        resolve();
      };
      // Cap the wait: a history entry that resolves from cache with no network
      // round-trip can complete before we attach, and nothing should hang.
      const timer = setTimeout(done, 5_000);
      wc.once('did-navigate', done);
      wc.once('did-navigate-in-page', done);
      wc.once('did-fail-load', done);
    });
    await act();
    await settled;
    return { url: wc.getURL() };
  }

  async goBack(tabId: string): Promise<{ url: string }> {
    const wc = this.wcFor(tabId);
    return this.afterNavigation(wc, () => tabManager.back(tabId));
  }

  async goForward(tabId: string): Promise<{ url: string }> {
    const wc = this.wcFor(tabId);
    return this.afterNavigation(wc, () => tabManager.forward(tabId));
  }

  async reload(tabId: string): Promise<{ url: string }> {
    const wc = this.wcFor(tabId);
    return this.afterNavigation(wc, () => tabManager.reload(tabId));
  }

  async scroll(
    tabId: string,
    options: { direction: 'up' | 'down' | 'top' | 'bottom'; amount?: number },
  ): Promise<{ scrolledTo: number }> {
    const wc = this.wcFor(tabId);
    const amount = options.amount ?? 600;
    const y = (await wc.executeJavaScript(
      `${AGENT_CURSOR}; (${SCROLL_FN.toString()})(${JSON.stringify(options.direction)}, ${amount})`,
    )) as number;
    return { scrolledTo: y };
  }

  async pressKey(
    tabId: string,
    key:
      | 'Enter'
      | 'Tab'
      | 'Escape'
      | 'ArrowDown'
      | 'ArrowUp'
      | 'PageDown'
      | 'PageUp',
  ): Promise<{ pressed: string }> {
    const wc = this.wcFor(tabId);
    // sendInputEvent with both keyDown and keyUp; "char" event covers Enter
    // submitting forms in inputs that listen for keypress.
    wc.focus();
    wc.sendInputEvent({ type: 'keyDown', keyCode: key });
    if (key === 'Enter') wc.sendInputEvent({ type: 'char', keyCode: '\r' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: key });
    return { pressed: key };
  }

  async waitFor(
    tabId: string,
    condition: { selector?: string; networkIdle?: boolean; timeoutMs?: number },
  ) {
    const wc = this.wcFor(tabId);
    const timeout = Math.min(condition.timeoutMs ?? 10_000, 10_000);
    if (condition.selector) {
      const matched = (await wc.executeJavaScript(
        `(${WAIT_FOR_SELECTOR.toString()})(${JSON.stringify(condition.selector)}, ${timeout})`,
      )) as boolean;
      return { matched };
    }
    if (condition.networkIdle) {
      const reachedIdle = await new Promise<boolean>((resolve) => {
        let settled = false;
        let inFlight = 0;
        let idleTimer: NodeJS.Timeout | null = null;
        const wr = wc.session.webRequest;
        // webRequest is session-wide, so without this every other tab's traffic
        // counts too. One background tab long-polling (mail, chat, any SPA
        // heartbeat) meant inFlight never hit zero and this always timed out.
        const ours = (d: { webContentsId?: number }) => d.webContentsId === wc.id;

        const finish = (idle: boolean) => {
          if (settled) return;
          settled = true;
          if (idleTimer) clearTimeout(idleTimer);
          clearTimeout(timeoutTimer);
          // Pass null to detach the handlers; otherwise they leak on the
          // session and intercept every subsequent request forever.
          wr.onBeforeRequest(null);
          wr.onCompleted(null);
          wr.onErrorOccurred(null);
          resolve(idle);
        };
        const armIdle = () => {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => finish(true), 500);
        };
        const onStart = () => {
          inFlight += 1;
          if (idleTimer) clearTimeout(idleTimer);
        };
        const onEnd = () => {
          inFlight = Math.max(0, inFlight - 1);
          if (inFlight === 0) armIdle();
        };

        // Hard cap so we always clean up even if the page never goes idle.
        // Timing out is NOT idle — saying otherwise sent the model off to read
        // a half-rendered page believing it had settled.
        const timeoutTimer = setTimeout(() => finish(false), timeout);
        wr.onBeforeRequest({ urls: ['<all_urls>'] }, (d, cb) => {
          if (ours(d)) onStart();
          cb({});
        });
        wr.onCompleted({ urls: ['<all_urls>'] }, (d) => {
          if (ours(d)) onEnd();
        });
        wr.onErrorOccurred({ urls: ['<all_urls>'] }, (d) => {
          if (ours(d)) onEnd();
        });
        // Give the page a beat to actually start requesting before declaring
        // idle. Arming immediately meant a navigate whose subresources hadn't
        // begun within 500ms reported idle straight away.
        setTimeout(() => {
          if (inFlight === 0) armIdle();
        }, 750);
      });
      return { matched: reachedIdle };
    }
    return { matched: false };
  }

  async confirmDestructive(message: string): Promise<boolean> {
    return this.confirmDelegate.request(message);
  }
}

// --- in-page helpers (stringified and injected) ---

const EXTRACT_READABLE_TEXT = `
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
    const main = document.querySelector('main, article, [role="main"]') || document.body;
    const text = (main.innerText || main.textContent || '').replace(/\\n{3,}/g, '\\n\\n').trim();
    if (!text) {
      return { error: 'Page is empty or rendered entirely client-side.' };
    }
    return { text: text.slice(0, 50_000) };
  })();
`;

const EXTRACT_STRUCTURED = `
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

const LIST_LINKS = `
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

function QUERY_DOM_FN(selector: string): number {
  try {
    return document.querySelectorAll(selector).length;
  } catch {
    throw new Error(`Invalid CSS selector: ${selector}`);
  }
}

// Walk the whole element tree including shadow roots. document.querySelector
// does not pierce shadow DOM, so on any web-component site (YouTube's ytd-*,
// Salesforce Lightning, most modern design systems) every click and type used
// to fail with "No element matched" even though the control was right there.
// Injected alongside CLICK_FN/TYPE_FN, which call it.
// Assigned onto window so the injected CLICK_FN/TYPE_FN bodies can reach them
// regardless of how the evaluated string is scoped.
const DEEP_QUERY = `
  window.__bbDeepAll = function (selector) {
    const out = [];
    const walk = (node) => {
      if (!node) return;
      let found;
      try { found = node.querySelectorAll(selector); } catch (e) { return; }
      for (const el of found) out.push(el);
      // Recurse into every shadow root on this level.
      let hosts;
      try { hosts = node.querySelectorAll('*'); } catch (e) { return; }
      for (const el of hosts) if (el.shadowRoot) walk(el.shadowRoot);
    };
    walk(document);
    return out;
  };
  window.__bbDeepQuery = function (selector) {
    const all = window.__bbDeepAll(selector);
    return all.length ? all[0] : null;
  };
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
const AGENT_CURSOR = `
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

export function CLICK_FN(target: string, actionId?: string): Promise<string> {
  if (actionId && (window as unknown as { __bbCancelledRun?: string }).__bbCancelledRun === actionId) throw new Error('cancelled');
  let el: Element | null = null;
  try {
    el = (window as unknown as { __bbDeepQuery(s: string): Element | null }).__bbDeepQuery(target);
  } catch {
    /* not a selector */
  }
  if (!el) {
    const tl = target.toLowerCase();
    const deepAll = (window as unknown as { __bbDeepAll(s: string): Element[] }).__bbDeepAll;
    const candidates = deepAll(
      'a, button, [role="button"], input[type="submit"], input[type="button"], summary',
    );
    const visible = candidates.filter((n) => {
      const r = n.getBoundingClientRect();
      return r.width > 0 || r.height > 0;
    });
    const pool = visible.length ? visible : candidates;
    const label = (n: Element) =>
      ((n as HTMLElement).innerText || n.getAttribute('aria-label') || (n as HTMLInputElement).value || '')
        .trim()
        .toLowerCase();
    el =
      pool.find((n) => label(n) === tl) ??
      pool.find((n) => label(n).includes(tl)) ??
      null;
  }
  if (!el) throw new Error(`No element matched: ${target}`);
  const node = el as HTMLElement;
  node.scrollIntoView({ block: 'center' });
  // Paint the cursor first, then dwell briefly before actually clicking.
  // Without the pause the click fires in the same frame the cursor appears, so
  // the page changes before the user's eye has anywhere to land — the whole
  // point is to show them where it went.
  const cursor = (window as unknown as {
    __bbCursor(e: Element, o?: { click?: boolean }): void;
  }).__bbCursor;
  cursor(node, { click: true });
  return new Promise<string>((resolve, reject) => {
    setTimeout(() => {
      if (actionId && (window as unknown as { __bbCancelledRun?: string }).__bbCancelledRun === actionId) {
        reject(new Error('cancelled'));
        return;
      }
      node.click();
      resolve(node.outerHTML.slice(0, 200));
    }, 500);
  });
}

export function TYPE_FN(target: string, text: string, actionId?: string): Promise<string> {
  if (actionId && (window as unknown as { __bbCancelledRun?: string }).__bbCancelledRun === actionId) throw new Error('cancelled');
  let el: Element | null = null;
  try {
    el = (window as unknown as { __bbDeepQuery(s: string): Element | null }).__bbDeepQuery(target);
  } catch {
    /* not a selector */
  }
  if (!el) {
    const tl = target.toLowerCase();
    const labels = Array.from(document.querySelectorAll('label'));
    const labelMatch = labels.find((l) =>
      (l.innerText || '').toLowerCase().includes(tl),
    );
    if (labelMatch) {
      const forId = labelMatch.getAttribute('for');
      el = forId ? document.getElementById(forId) : labelMatch.querySelector('input, textarea');
    }
    if (!el) {
      const inputs = (window as unknown as { __bbDeepAll(s: string): Element[] }).__bbDeepAll(
        'input, textarea, [contenteditable=""], [contenteditable="true"]',
      );
      el =
        inputs.find((i) => {
          const ph = (i as HTMLInputElement).placeholder?.toLowerCase() ?? '';
          const aria = i.getAttribute('aria-label')?.toLowerCase() ?? '';
          const labelledBy = i.getAttribute('aria-labelledby');
          let labelledText = '';
          if (labelledBy) {
            labelledText = labelledBy
              .split(/\s+/)
              .map((id) => document.getElementById(id)?.innerText?.toLowerCase() ?? '')
              .join(' ');
          }
          const name = (i as HTMLInputElement).name?.toLowerCase() ?? '';
          return (
            ph.includes(tl) ||
            aria.includes(tl) ||
            labelledText.includes(tl) ||
            name.includes(tl)
          );
        }) ?? null;
    }
  }
  if (!el) throw new Error(`No input matched: ${target}`);
  const html = el as HTMLElement;
  html.scrollIntoView({ block: 'center' });
  (
    window as unknown as { __bbCursor(e: Element | null, o?: Record<string, unknown>): void }
  ).__bbCursor(html, { click: true, hold: 4000 });
  html.focus();

  const isCE = html.isContentEditable;
  const input = el as HTMLInputElement | HTMLTextAreaElement;
  const nativeSetter = isCE
    ? null
    : Object.getOwnPropertyDescriptor(
        input instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype,
        'value',
      )?.set;

  // Write the field one character at a time so the user can actually watch it
  // being typed. Setting .value in one shot is instant and invisible — the
  // field just changes, which is precisely the "what did it do?" problem the
  // cursor exists to solve. Each keystroke dispatches its own input event, so
  // controlled inputs (React et al) and live search suggestions behave exactly
  // as they would for a human typist. Pace is capped so a long string doesn't
  // turn into a wait.
  const perChar = Math.max(8, Math.min(28, Math.round(1400 / Math.max(1, text.length))));

  const write = (value: string) => {
    if (isCE) {
      html.textContent = value;
      html.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
      return;
    }
    if (nativeSetter) nativeSetter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  write('');
  return new Promise<string>((resolve, reject) => {
    let i = 0;
    const tick = () => {
      if (actionId && (window as unknown as { __bbCancelledRun?: string }).__bbCancelledRun === actionId) {
        reject(new Error('cancelled'));
        return;
      }
      i += 1;
      write(text.slice(0, i));
      if (i < text.length) {
        setTimeout(tick, perChar);
        return;
      }
      // change fires once at the end, as it would when a person leaves a field.
      if (!isCE) input.dispatchEvent(new Event('change', { bubbles: true }));
      resolve(html.outerHTML.slice(0, 200));
    };
    if (text.length === 0) {
      if (!isCE) input.dispatchEvent(new Event('change', { bubbles: true }));
      resolve(html.outerHTML.slice(0, 200));
      return;
    }
    setTimeout(tick, perChar);
  });
}

function SCROLL_FN(
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

function WAIT_FOR_SELECTOR(selector: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      try {
        if (document.querySelector(selector)) return resolve(true);
      } catch {
        return resolve(false);
      }
      if (Date.now() - start > timeoutMs) return resolve(false);
      setTimeout(tick, 100);
    };
    tick();
  });
}
