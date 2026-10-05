// ToolRuntime implementation that drives the active WebContentsView. Page
// actions run as scripts injected with executeJavaScript (see the in-page
// helpers at the bottom); keys go through sendInputEvent, and navigation
// through the tab manager.

import { ToolError, type KeyName, type TabSummary, type TargetFacts, type ToolRuntime } from '@bullebrowser/agent-core';
import type { WebContents, WebFrameMain } from 'electron';
import { tabManager } from '../tabs/manager.js';
import { assertWebUrl, evalPage, frameOffset, hostOf, inFrames, subFrames } from './browser/frames.js';
import { pageQuiet, settleAfter, type WaitMode } from './browser/settle.js';
import { waitForNetworkIdle } from './browser/net-activity.js';
import { dismissConsent, describeConsent } from './browser/consent.js';
import { recordRefs, refPrelude } from './browser/refs.js';
import { KEY_DEFS, insertLines, pressWith, withInput } from './browser/input.js';
import {
  AGENT_CURSOR,
  CLICK_FN,
  CLICK_SPOT_FN,
  EXTRACT_READABLE_TEXT,
  EXTRACT_STRUCTURED,
  LIST_LINKS,
  PAGE_HELPERS,
  QUERY_DOM_FN,
  READABLE_TEXT_EXPR,
  SCROLL_FN,
  TYPE_FN,
  WAIT_FOR_SELECTOR,
  type ClickSpot,
} from './browser/page-scripts.js';

export interface ConfirmDelegate {
  request(message: string): Promise<boolean>;
}

// Screenshots go to the model as images; a full-resolution Retina capture can
// pass the API's per-image size limit and fail the whole request.
const SCREENSHOT_MAX_WIDTH = 1280;

export class DesktopToolRuntime implements ToolRuntime {
  constructor(
    private confirmDelegate: ConfirmDelegate,
    private onPageActivity?: (tabId: string) => void,
  ) {}

  private wcFor(tabId: string): WebContents {
    const view = tabManager.getView(tabId);
    if (!view || view.webContents.isDestroyed()) throw new ToolError('TARGET_CLOSED', `Tab not found: ${tabId}`);
    this.onPageActivity?.(tabId);
    return view.webContents;
  }

  // What every targeted page call starts with: the helpers, this frame's ref
  // state (numbering, and the fingerprint of a targeted ref) and the cursor.
  private prelude(wc: WebContents, withCursor = true) {
    return (frame: WebFrameMain, target: string) =>
      `${PAGE_HELPERS}; ${refPrelude(wc, frame, target)}${withCursor ? `; ${AGENT_CURSOR}` : ''}`;
  }

  // After a page loads: clear any cookie banner, and say so.
  private async afterLoad(wc: WebContents, mode: WaitMode): Promise<{ consent?: string }> {
    if (mode === 'none') return {};
    const hit = await dismissConsent(wc);
    return hit ? { consent: describeConsent(hit) } : {};
  }

  async navigate(tabId: string, url: string, opts: { wait?: WaitMode } = {}) {
    const wc = this.wcFor(tabId);
    // Second line of defence behind the navigate schema's allowlist.
    assertWebUrl(url);
    const mode = opts.wait ?? 'idle';
    let status: number | undefined;
    const onNavigate = (_e: unknown, _url: string, code: number) => {
      status = code;
    };
    wc.on('did-navigate', onNavigate);
    try {
      await settleAfter(
        wc,
        async () => {
          let timer: NodeJS.Timeout | undefined;
          try {
            await Promise.race([
              wc.loadURL(url),
              new Promise((_, reject) => {
                timer = setTimeout(
                  () => reject(new ToolError('NAVIGATION_TIMEOUT', `${url} did not finish loading within 30 seconds.`)),
                  30_000,
                );
              }),
            ]);
          } catch (e) {
            if (e instanceof ToolError) throw e;
            // loadURL rejects with ERR_ABORTED on perfectly ordinary events: a
            // redirect, a client-side navigation, a URL that turns into a
            // download. What ended up on screen is what counts.
            const code = (e as { code?: string }).code ?? '';
            if (code === 'ERR_ABORTED') return;
            if (code === 'ERR_NETWORK_CHANGED') throw new ToolError('NETWORK_CHANGED', `net::${code} while loading ${url}`);
            throw new ToolError('NETWORK_ERROR', `Could not load ${url} (net::${code || 'error'}).`);
          } finally {
            clearTimeout(timer);
          }
        },
        mode,
      );
    } finally {
      if (!wc.isDestroyed()) wc.off('did-navigate', onNavigate);
    }
    const extra = await this.afterLoad(wc, mode);
    // A page load wipes the overlay with the old document; put the pointer
    // back where a person's would be, so the user can follow the agent.
    await wc
      .executeJavaScript(
        `${AGENT_CURSOR}; window.__bbCursorTo(Math.round(window.innerWidth * 0.28), Math.round(window.innerHeight * 0.3));`,
      )
      .catch(() => {});
    if (status !== undefined && status >= 400) {
      throw new ToolError(
        'HTTP_ERROR',
        `${wc.getURL()} answered HTTP ${status}${wc.getTitle() ? ` ("${wc.getTitle()}")` : ''}. The page is loaded; read_page shows what it says.`,
      );
    }
    return { url: wc.getURL(), title: wc.getTitle(), ...(status ? { status } : {}), ...extra };
  }

  async readPage(tabId: string) {
    const wc = this.wcFor(tabId);
    const result = (await wc.executeJavaScript(EXTRACT_READABLE_TEXT)) as
      | { text: string }
      | { error: string };
    // Embedded frames are read too: the body of Word/PowerPoint Online, Google
    // Docs' editor, embedded forms and payment widgets all live in iframes the
    // top page's text never includes.
    const framed: string[] = [];
    for (const { frame, index } of subFrames(wc).slice(0, 6)) {
      try {
        const r = await evalPage<{ text?: string }>(frame, '', READABLE_TEXT_EXPR);
        if (r.text) framed.push(`\n\n--- Embedded frame ${index} (${hostOf(frame.url)}) ---\n${r.text}`);
      } catch {
        /* a frame mid-navigation or without a document — skip it */
      }
    }
    if ('error' in result && framed.length === 0) {
      throw new Error(
        `${result.error} The read_page tool only supports HTML pages. ` +
          `For PDFs or other documents, ask the user to convert to HTML or paste the text directly.`,
      );
    }
    const text = (('text' in result ? result.text : '') + framed.join('')).slice(0, 40_000);
    return { title: wc.getTitle(), url: wc.getURL(), text };
  }

  async click(tabId: string, target: string, opts: { wait?: WaitMode } = {}) {
    const wc = this.wcFor(tabId);
    const mode = opts.wait ?? 'idle';
    const before = wc.getURL();
    let matched = '';
    await settleAfter(wc, async () => {
      // Find it, bring it into view and show the cursor on it...
      const { value: spot, frame } = await inFrames<ClickSpot>(
        wc,
        target,
        this.prelude(wc),
        (t) => `(${CLICK_SPOT_FN.toString()})(${JSON.stringify(t)})`,
      );
      matched = spot.matched;
      // ...then press it with the real mouse, like a person: editors such as
      // Word Online place their cursor only on a real click, and many menus
      // ignore synthetic events. That needs the element's place on screen,
      // including the offset of any frame it sits in; if that can't be worked
      // out, or something covers the element, click it directly instead.
      const offset = spot.onTop ? await frameOffset(wc, frame) : null;
      if (offset) {
        const x = offset.x + spot.x;
        const y = offset.y + spot.y;
        await withInput(wc, async (send) => {
          await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
          await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
          await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
        });
      } else {
        try {
          // The element as marked a moment ago, or — if the page re-rendered
          // since — the same target looked up afresh.
          await evalPage<void>(
            frame,
            this.prelude(wc)(frame, target),
            `(function (t) {
              try { return (${CLICK_FN.toString()})(${JSON.stringify(spot.ref)}); }
              catch (e) { return (${CLICK_FN.toString()})(t); }
            })(${JSON.stringify(target.replace(/^\s*@\d+\.(\d+)\s*$/, '@$1'))})`,
          );
        } catch (e) {
          // The click itself can tear down the document it ran in (it
          // navigated). That is the click working, not failing — and it must
          // not be retried.
          if (!/context was destroyed|frame was disposed|Render frame was disposed/i.test((e as Error).message)) throw e;
        }
      }
    }, mode);
    const extra = wc.getURL() !== before ? await this.afterLoad(wc, mode) : {};
    return { matched, url: wc.getURL(), ...extra };
  }

  async type(tabId: string, target: string, text: string) {
    const wc = this.wcFor(tabId);
    // Focus the tab first, so the element focused below becomes the page's
    // focused element and native text input lands in it.
    wc.focus();
    // "focused": type where the cursor already is — typically right after
    // clicking into a document — in whatever frame holds it.
    if (/^\s*(focused|cursor|caret)\s*$/i.test(target)) {
      if (text) await withInput(wc, (send) => insertLines(send, text));
      return { matched: 'the focused element' };
    }
    const { value } = await inFrames<{ matched: string; native: boolean }>(
      wc,
      target,
      this.prelude(wc),
      (t) => `(${TYPE_FN.toString()})(${JSON.stringify(t)}, ${JSON.stringify(text)})`,
    );
    // Rich editors (Word and PowerPoint Online, Google Docs, Gmail, Notion)
    // keep their own document model and ignore text written into the DOM.
    // This is real text input to the focused element, in whatever frame it
    // lives — it goes through the editor's own input handling, at the cursor
    // TYPE_FN placed. Line breaks are pressed as Enter, as a typist would.
    if (value.native && text) await withInput(wc, (send) => insertLines(send, text));
    return { matched: value.matched };
  }

  async selectOption(tabId: string, target: string, option: string) {
    const wc = this.wcFor(tabId);
    const { value } = await inFrames<string>(wc, target, this.prelude(wc), (t) =>
      `(function (t, o) {
        var el = __bb.FindField(t);
        el.scrollIntoView({ block: 'center' });
        window.__bbCursor(el, { click: true });
        return __bb.Select(el, o);
      })(${JSON.stringify(t)}, ${JSON.stringify(option)})`,
    );
    return { matched: value };
  }

  async findElements(tabId: string, query?: string) {
    const wc = this.wcFor(tabId);
    const q = JSON.stringify(query ?? '');
    type Found = { lines: string[]; fps: Record<string, Record<string, unknown>>; seq: number };
    const list = async (frame: WebFrameMain): Promise<string[]> => {
      const found = await evalPage<Found>(frame, this.prelude(wc, false)(frame, ''), `__bb.FindElements(${q})`);
      recordRefs(wc, frame, found);
      return found.lines;
    };
    const elements = await list(wc.mainFrame);
    // Controls inside embedded frames get frame-qualified refs ("@12.7" is ref
    // 7 in frame 12), and each frame is labelled with what it is for.
    for (const { frame, index, purpose } of subFrames(wc)) {
      if (purpose === 'ad') continue;
      try {
        const inner = await list(frame);
        if (!inner.length) continue;
        const alias = purpose === 'content' ? '' : ` — target it as "${purpose}:<name>"${purpose === 'editor' ? ', or type into "editor"' : ''}`;
        elements.push(`— embedded frame ${index} [${purpose}] (${hostOf(frame.url)})${alias} —`);
        for (const line of inner) elements.push(line.replace(/^@(\d+)/, `@${index}.$1`));
      } catch {
        /* unreadable frame — skip */
      }
    }
    return { elements: elements.slice(0, 220) };
  }

  async inspectTarget(
    tabId: string,
    target: string | null,
    key: 'Enter' | 'Space' = 'Enter',
  ): Promise<TargetFacts> {
    const wc = this.wcFor(tabId);
    if (target === null) {
      // A key goes to whichever frame holds focus. Embedded frames are asked
      // first, and a document whose focused element is itself a frame is
      // skipped: the top page "has focus" whenever a child frame does, so
      // asking it first reported the <iframe>, not the sign-up form inside.
      const frames = [...subFrames(wc).map((f) => f.frame).reverse(), wc.mainFrame];
      let unreadable = false;
      for (const frame of frames) {
        try {
          const facts = await evalPage<TargetFacts | null>(
            frame,
            PAGE_HELPERS,
            `(function () {
              if (!document.hasFocus()) return null;
              var el = __bb.Focused();
              if (/^(IFRAME|FRAME)$/.test(el.tagName)) return null;
              return __bb.Facts(el, ${JSON.stringify(key)});
            })()`,
          );
          if (facts) return facts;
        } catch {
          unreadable = true;
        }
      }
      // Could not tell where the key would land: ask rather than guess.
      if (unreadable) throw new Error('Could not inspect the focused element.');
      return { label: '', submitsForm: false, activates: false };
    }
    return (
      await inFrames<TargetFacts>(wc, target, this.prelude(wc, false), (t) =>
        `__bb.Facts(__bb.FindClickable(${JSON.stringify(t)}), 'click')`,
      )
    ).value;
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
    // Decorative activity must not obscure page evidence sent to the model.
    return tabManager.withoutBrowsingCloud(tabId, async () => {
      let image = await wc.capturePage();
      if (image.getSize().width > SCREENSHOT_MAX_WIDTH) image = image.resize({ width: SCREENSHOT_MAX_WIDTH });
      return { pngBase64: image.toPNG().toString('base64') };
    });
  }

  async newTab(url?: string): Promise<TabSummary> {
    if (url) assertWebUrl(url);
    // Opened from the tab the agent is on, so closing it returns the user there.
    const tab = await tabManager.create(url, tabManager.getActiveId() ?? undefined);
    // create() starts the load without waiting for it; the agent's next step
    // is almost always read_page, which then read a blank or half-built page.
    if (url) {
      const wc = this.wcFor(tab.id);
      if (wc.isLoading()) {
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(cap);
            wc.off('did-finish-load', done);
            wc.off('did-fail-load', onFail);
            resolve();
          };
          // A failing ad or widget iframe is not the page failing.
          const onFail = (_e: unknown, _c: number, _d: string, _u: string, isMainFrame: boolean) => {
            if (isMainFrame) done();
          };
          const cap = setTimeout(done, 15_000);
          wc.on('did-finish-load', done);
          wc.on('did-fail-load', onFail);
        });
      }
      await pageQuiet(wc);
      const extra = await this.afterLoad(wc, 'idle');
      const now = tabManager.list().find((t) => t.id === tab.id);
      return { id: tab.id, title: now?.title ?? wc.getTitle(), url: wc.getURL(), active: true, ...extra };
    }
    return { id: tab.id, title: tab.title, url: tab.url, active: tab.active };
  }

  async switchTab(tabId: string): Promise<TabSummary> {
    tabManager.activate(tabId);
    const list = tabManager.list();
    const tab = list.find((t) => t.id === tabId);
    if (!tab) throw new Error(`Tab not found: ${tabId}`);
    this.onPageActivity?.(tabId);
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

  async pressKey(tabId: string, key: KeyName): Promise<{ pressed: string }> {
    const wc = this.wcFor(tabId);
    // Enter can submit a form and load a new page, so wait for that like a click.
    await settleAfter(wc, async () => {
      wc.focus();
      await withInput(wc, (send) => pressWith(send, KEY_DEFS[key]));
    });
    return { pressed: key };
  }

  async waitFor(
    tabId: string,
    condition: { selector?: string; text?: string; networkIdle?: boolean; timeoutMs?: number },
  ) {
    const wc = this.wcFor(tabId);
    const timeout = Math.min(condition.timeoutMs ?? 10_000, 15_000);
    if (condition.selector) {
      const matched = await evalPage<boolean>(
        wc,
        PAGE_HELPERS,
        `(${WAIT_FOR_SELECTOR.toString()})(${JSON.stringify(condition.selector)}, ${timeout})`,
      );
      return { matched };
    }
    if (condition.text) {
      // Text can appear anywhere: the page or any of its frames.
      const needle = JSON.stringify(condition.text.toLowerCase());
      const probe = `!!(document.body && (document.body.innerText || '').toLowerCase().indexOf(${needle}) !== -1)`;
      const start = Date.now();
      while (Date.now() - start < timeout) {
        for (const frame of [wc.mainFrame, ...subFrames(wc).map((f) => f.frame)]) {
          if (await evalPage<boolean>(frame, '', probe).catch(() => false)) return { matched: true };
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      return { matched: false };
    }
    if (condition.networkIdle) {
      // Timing out is NOT idle — saying otherwise sent the model off to read a
      // half-rendered page believing it had settled.
      return { matched: await waitForNetworkIdle(wc, 500, timeout) };
    }
    return { matched: false };
  }


  async confirmDestructive(message: string): Promise<boolean> {
    return this.confirmDelegate.request(message);
  }
}
