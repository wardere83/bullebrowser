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
  constructor(private confirmDelegate: ConfirmDelegate) {}

  private wcFor(tabId: string): WebContents {
    const view = tabManager.getView(tabId);
    if (!view) throw new Error(`Tab not found: ${tabId}`);
    return view.webContents;
  }

  async navigate(tabId: string, url: string) {
    const wc = this.wcFor(tabId);
    await wc.loadURL(url);
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
      `(${CLICK_FN.toString()})(${JSON.stringify(target)})`,
    )) as string;
    return { matched };
  }

  async type(tabId: string, target: string, text: string) {
    const wc = this.wcFor(tabId);
    const matched = (await wc.executeJavaScript(
      `(${TYPE_FN.toString()})(${JSON.stringify(target)}, ${JSON.stringify(text)})`,
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
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, timeout);
        const onIdle = () => {
          clearTimeout(t);
          resolve();
        };
        // Approximate "network idle": no in-flight requests for 500ms.
        let inFlight = 0;
        let idleTimer: NodeJS.Timeout | null = null;
        const armIdle = () => {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(onIdle, 500);
        };
        const onStart = () => {
          inFlight += 1;
          if (idleTimer) clearTimeout(idleTimer);
        };
        const onEnd = () => {
          inFlight = Math.max(0, inFlight - 1);
          if (inFlight === 0) armIdle();
        };
        wc.session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (_d, cb) => {
          onStart();
          cb({});
        });
        wc.session.webRequest.onCompleted({ urls: ['<all_urls>'] }, () => onEnd());
        wc.session.webRequest.onErrorOccurred({ urls: ['<all_urls>'] }, () => onEnd());
        armIdle();
      });
      return { matched: true };
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
    const clone = document.cloneNode(true);
    clone.querySelectorAll('script, style, noscript, iframe, svg').forEach((n) => n.remove());
    const main = clone.querySelector('main, article, [role="main"]') || clone.body;
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

function CLICK_FN(target: string): string {
  let el: Element | null = null;
  try {
    el = document.querySelector(target);
  } catch {
    /* not a selector */
  }
  if (!el) {
    const tl = target.toLowerCase();
    const candidates = Array.from(
      document.querySelectorAll('a, button, [role="button"], input[type="submit"]'),
    );
    el =
      candidates.find((n) => (n as HTMLElement).innerText?.trim().toLowerCase() === tl) ??
      candidates.find((n) => (n as HTMLElement).innerText?.toLowerCase().includes(tl)) ??
      null;
  }
  if (!el) throw new Error(`No element matched: ${target}`);
  (el as HTMLElement).scrollIntoView({ block: 'center' });
  (el as HTMLElement).click();
  return (el as HTMLElement).outerHTML.slice(0, 200);
}

function TYPE_FN(target: string, text: string): string {
  let el: Element | null = null;
  try {
    el = document.querySelector(target);
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
      const inputs = Array.from(
        document.querySelectorAll('input, textarea, [contenteditable=""], [contenteditable="true"]'),
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
  html.focus();
  const isCE = html.isContentEditable;
  if (isCE) {
    html.textContent = text;
    html.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
  } else {
    const input = el as HTMLInputElement | HTMLTextAreaElement;
    const nativeSetter = Object.getOwnPropertyDescriptor(
      input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value',
    )?.set;
    if (nativeSetter) nativeSetter.call(input, text);
    else input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return html.outerHTML.slice(0, 200);
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
