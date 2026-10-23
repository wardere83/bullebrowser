// A ToolRuntime that operates the page it is running inside, via the DOM.
//
// This is the browser-side half of the embeddable BulleBrowser widget (the kind
// that replaces a CRM's built-in chatbot): the agent is given the same tool
// surface it has in the desktop app, but the "browser" is the host page itself.
// The model loop runs on a backend that holds the API key (a key can never live
// in page JavaScript); each tool call it decides is executed here, against the
// live DOM, and the result sent back.
//
// Only function bodies touch `document`/`window`, so this module is inert when
// merely imported in a non-browser context (e.g. the desktop main process's
// bundle) — nothing runs until a method is called in a page.

import type { TabSummary, ToolRuntime } from './types.js';

// Same shadow-DOM-piercing query the desktop runtime uses, so a click/type
// finds controls inside web components (which most modern CRMs are built from).
function deepQueryAll(selector: string): Element[] {
  const out: Element[] = [];
  const walk = (node: Document | ShadowRoot) => {
    let found: NodeListOf<Element> | undefined;
    try {
      found = node.querySelectorAll(selector);
    } catch {
      return;
    }
    out.push(...Array.from(found));
    for (const el of Array.from(node.querySelectorAll('*'))) {
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(document);
  return out;
}

function deepQuery(selector: string): Element | null {
  return deepQueryAll(selector)[0] ?? null;
}

function readableText(): string {
  const clone = document.querySelector('main, article, [role="main"]') || document.body;
  if (!clone) return '';
  return (clone as HTMLElement).innerText?.replace(/\n{3,}/g, '\n\n').trim().slice(0, 50_000) ?? '';
}

function isVisible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 || r.height > 0;
}

// Resolve a target that is either a CSS selector or human text ("Save",
// "Add contact"), matching on text / aria-label / value, preferring visible
// elements — the way a person would find a control.
function resolveClickable(target: string): Element | null {
  const bySelector = (() => {
    try {
      return deepQuery(target);
    } catch {
      return null;
    }
  })();
  if (bySelector) return bySelector;

  const tl = target.toLowerCase();
  const candidates = deepQueryAll(
    'a, button, [role="button"], input[type="submit"], input[type="button"], summary, [role="link"], [role="menuitem"], [role="tab"]',
  );
  const pool = candidates.filter(isVisible).length ? candidates.filter(isVisible) : candidates;
  const label = (n: Element) =>
    (
      (n as HTMLElement).innerText ||
      n.getAttribute('aria-label') ||
      (n as HTMLInputElement).value ||
      ''
    )
      .trim()
      .toLowerCase();
  return pool.find((n) => label(n) === tl) ?? pool.find((n) => label(n).includes(tl)) ?? null;
}

function resolveField(target: string): HTMLElement | null {
  const bySelector = (() => {
    try {
      return deepQuery(target) as HTMLElement | null;
    } catch {
      return null;
    }
  })();
  if (bySelector) return bySelector;

  const tl = target.toLowerCase();
  // Prefer a label's associated control.
  for (const l of Array.from(document.querySelectorAll('label'))) {
    if ((l.innerText || '').toLowerCase().includes(tl)) {
      const forId = l.getAttribute('for');
      const ctl = forId ? document.getElementById(forId) : l.querySelector('input, textarea');
      if (ctl) return ctl as HTMLElement;
    }
  }
  const inputs = deepQueryAll('input, textarea, [contenteditable=""], [contenteditable="true"]');
  return (
    (inputs.find((i) => {
      const ph = (i as HTMLInputElement).placeholder?.toLowerCase() ?? '';
      const aria = i.getAttribute('aria-label')?.toLowerCase() ?? '';
      const name = (i as HTMLInputElement).name?.toLowerCase() ?? '';
      return ph.includes(tl) || aria.includes(tl) || name.includes(tl);
    }) as HTMLElement | undefined) ?? null
  );
}

const THIS_TAB = 'page';

export interface DomRuntimeOptions {
  // Called before a destructive action (submit/delete/purchase) so the host can
  // ask the user. Defaults to allowing, matching the desktop confirm delegate.
  confirmDestructive?(message: string): Promise<boolean>;
  // Draw the agent cursor at an element before acting. Supplied by the widget
  // so the same visible-cursor experience carries into the embedded context.
  showCursor?(el: Element, opts?: { click?: boolean }): void;
}

// The page presents as a single "tab"; multi-tab operations degrade to acting
// on it, since an embedded widget owns one document, not a tab strip.
export function createDomToolRuntime(options: DomRuntimeOptions = {}): ToolRuntime {
  const cursor = (el: Element, opts?: { click?: boolean }) => {
    try {
      options.showCursor?.(el, opts);
    } catch {
      /* the overlay must never break the action */
    }
  };
  const tab = (): TabSummary => ({
    id: THIS_TAB,
    title: document.title,
    url: location.href,
    active: true,
  });

  return {
    async navigate(_id, url) {
      // A full navigation would unload the widget with the page. Same-origin
      // soft navigation is safe; otherwise the agent should click a link
      // instead, which is the natural motion inside a CRM SPA anyway.
      const dest = new URL(url, location.href);
      if (dest.origin === location.origin) {
        location.assign(dest.href);
      } else {
        throw new Error(
          `Refusing to leave ${location.origin} for ${dest.origin} — that would close the assistant. ` +
            `Click a link or use the app's own navigation to move within the CRM.`,
        );
      }
      return { url: location.href, title: document.title };
    },

    async readPage() {
      const text = readableText();
      if (!text) throw new Error('The page has no readable text yet.');
      return { title: document.title, url: location.href, text };
    },

    async click(_id, target) {
      const el = resolveClickable(target);
      if (!el) throw new Error(`No element matched: ${target}`);
      (el as HTMLElement).scrollIntoView({ block: 'center' });
      cursor(el, { click: true });
      await new Promise((r) => setTimeout(r, 300));
      (el as HTMLElement).click();
      return { matched: (el as HTMLElement).outerHTML.slice(0, 200) };
    },

    async type(_id, target, text) {
      const el = resolveField(target);
      if (!el) throw new Error(`No input matched: ${target}`);
      el.scrollIntoView({ block: 'center' });
      cursor(el);
      (el as HTMLElement).focus();
      const isCE = el.isContentEditable;
      const input = el as HTMLInputElement | HTMLTextAreaElement;
      const setter = isCE
        ? null
        : Object.getOwnPropertyDescriptor(
            input instanceof HTMLTextAreaElement
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype,
            'value',
          )?.set;
      const write = (v: string) => {
        if (isCE) {
          el.textContent = v;
          el.dispatchEvent(new InputEvent('input', { bubbles: true, data: v }));
        } else {
          if (setter) setter.call(input, v);
          else input.value = v;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      };
      // Character by character, so live search and controlled inputs behave and
      // the user can watch it — same as the desktop app.
      for (let i = 1; i <= text.length; i++) {
        write(text.slice(0, i));
        await new Promise((r) => setTimeout(r, Math.max(8, Math.min(28, Math.round(1400 / text.length)))));
      }
      if (!isCE) input.dispatchEvent(new Event('change', { bubbles: true }));
      return { matched: (el as HTMLElement).outerHTML.slice(0, 200) };
    },

    async extract(_id, schema) {
      const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
        .slice(0, 50)
        .map((h) => ({ level: h.tagName, text: (h as HTMLElement).innerText?.trim() }));
      const tables = Array.from(document.querySelectorAll('table'))
        .slice(0, 10)
        .map((t) =>
          Array.from((t as HTMLTableElement).rows)
            .slice(0, 50)
            .map((r) => Array.from(r.cells).map((c) => c.innerText?.trim())),
        );
      return { data: { _schema: schema, headings, tables, _text: readableText() } };
    },

    async screenshot() {
      // A page cannot screenshot itself without a capture API; the backend/host
      // can add one. Report cleanly rather than pretend.
      throw new Error('Screenshots are not available in the embedded widget.');
    },

    async getSelection() {
      return { text: String(window.getSelection?.() ?? '') };
    },

    async listLinks() {
      const seen = new Set<string>();
      const out: { text: string; href: string }[] = [];
      for (const a of deepQueryAll('a[href]')) {
        const href = (a as HTMLAnchorElement).href;
        if (!href || !/^https?:/i.test(href) || seen.has(href) || !isVisible(a)) continue;
        seen.add(href);
        out.push({ text: ((a as HTMLElement).innerText || '').trim().slice(0, 120), href });
        if (out.length >= 200) break;
      }
      return out;
    },

    async queryDom(_id, selector) {
      return { matches: deepQueryAll(selector).length };
    },

    async scroll(_id, opts) {
      const doc = document.scrollingElement || document.documentElement;
      const amount = opts.amount ?? 600;
      if (opts.direction === 'down') window.scrollBy({ top: amount, behavior: 'smooth' });
      else if (opts.direction === 'up') window.scrollBy({ top: -amount, behavior: 'smooth' });
      else if (opts.direction === 'top') window.scrollTo({ top: 0, behavior: 'smooth' });
      else window.scrollTo({ top: doc.scrollHeight, behavior: 'smooth' });
      return { scrolledTo: doc.scrollTop };
    },

    async pressKey(_id, key) {
      const el = (document.activeElement as HTMLElement) ?? document.body;
      for (const type of ['keydown', 'keyup'] as const) {
        el.dispatchEvent(new KeyboardEvent(type, { key: key === 'Space' ? ' ' : key, bubbles: true }));
      }
      return { pressed: key };
    },

    async waitFor(_id, condition) {
      const timeout = Math.min(condition.timeoutMs ?? 10_000, 10_000);
      if (condition.selector) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
          if (deepQuery(condition.selector)) return { matched: true };
          await new Promise((r) => setTimeout(r, 100));
        }
        return { matched: false };
      }
      // No cross-tab network view from inside a page; give the SPA a beat to
      // settle after an action.
      await new Promise((r) => setTimeout(r, Math.min(1200, timeout)));
      return { matched: true };
    },

    // A widget owns one document — present it as the single active tab and make
    // the multi-tab surface degrade sensibly rather than error.
    async newTab() {
      return tab();
    },
    async switchTab() {
      return tab();
    },
    async listTabs() {
      return [tab()];
    },
    async closeTab() {
      return { closed: false };
    },
    async goBack() {
      history.back();
      await new Promise((r) => setTimeout(r, 400));
      return { url: location.href };
    },
    async goForward() {
      history.forward();
      await new Promise((r) => setTimeout(r, 400));
      return { url: location.href };
    },
    async reload() {
      location.reload();
      return { url: location.href };
    },

    async confirmDestructive(message) {
      return options.confirmDestructive ? options.confirmDestructive(message) : true;
    },
  };
}
