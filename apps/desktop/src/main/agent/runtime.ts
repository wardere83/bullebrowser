// ToolRuntime implementation that drives the active WebContentsView. Page
// actions run as scripts injected with executeJavaScript (see the in-page
// helpers at the bottom); keys go through sendInputEvent, and navigation
// through the tab manager.

import type { KeyName, TabSummary, TargetFacts, ToolRuntime } from '@bullebrowser/agent-core';
import type { WebContents, WebFrameMain } from 'electron';
import { tabManager } from '../tabs/manager.js';

export interface ConfirmDelegate {
  request(message: string): Promise<boolean>;
}

// The agent drives a real browser holding the user's live sessions, so only
// web pages may be opened — never file:, data: or javascript: URLs, whatever
// tool or caller the URL arrives through.
function assertWebUrl(url: string): void {
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
}

// Run an injected expression and bring its error back intact. When a page
// script throws, executeJavaScript rejects with a generic "Script failed to
// execute", so the model never saw "No element matched: X" (or the list of
// what *was* on the page) and could not correct itself.
// `prelude` is statements (the helper installers) run first; `expression` is
// what gets returned.
//
// Runs as a user gesture: pages (and browsers, for cross-origin frames) ignore
// focus() and editing commands that don't come from one, which is exactly what
// typing into an embedded editor needs.
// Long enough for a click's 450ms dwell plus a slow page; short enough that a
// dead frame costs a retry, not the run.
const EVAL_TIMEOUT_MS = 15_000;

async function evalPage<T>(
  target: WebContents | WebFrameMain,
  prelude: string,
  expression: string,
): Promise<T> {
  // A frame that is swapped out or torn down mid-call can leave
  // executeJavaScript pending forever, which froze the whole run; cap it.
  const run = target.executeJavaScript(
    `(async () => { try { ${prelude}\n; return { ok: true, value: await (${expression}) }; } ` +
      `catch (e) { return { ok: false, error: String((e && e.message) || e) }; } })()`,
    true,
  ) as Promise<{ ok: true; value: T } | { ok: false; error: string }>;
  let timer: NodeJS.Timeout | undefined;
  const result = await Promise.race([
    run,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('The page did not respond (it may be reloading). Try again.')),
        EVAL_TIMEOUT_MS,
      );
    }),
  ]).finally(() => clearTimeout(timer));
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

// Frames other than the top page, keyed for frame-qualified refs by their
// frameTreeNodeId: unlike a position in the list it survives the frame being
// moved to another process (which cross-site frames like Word Online's are),
// so "@12.3" from find_elements still names the same frame when acted on.
function subFrames(wc: WebContents): { frame: WebFrameMain; index: number }[] {
  const out: { frame: WebFrameMain; index: number }[] = [];
  for (const f of wc.mainFrame.framesInSubtree) {
    try {
      if (f === wc.mainFrame || f.detached || !/^https?:/.test(f.url)) continue;
      out.push({ frame: f, index: f.frameTreeNodeId });
    } catch {
      /* a frame disposed while we were listing: not there any more */
    }
  }
  return out;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// Run a targeted action wherever its element is: in the frame a qualified ref
// names ("@2.7"), else the top page, else the first embedded frame that has a
// match. Only a "nothing matched here" error moves on to the next frame; any
// other failure is the real answer.
async function inFrames<T>(
  wc: WebContents,
  target: string,
  prelude: string,
  expression: (target: string) => string,
): Promise<{ value: T; frame: WebFrameMain }> {
  const qualified = /^\s*@(\d+)\.(\d+)\s*$/.exec(target);
  const frames = subFrames(wc);
  if (qualified) {
    const hit = frames.find((f) => f.index === Number(qualified[1]));
    if (!hit) throw new Error(`Frame ${qualified[1]} is gone (the page changed). Call find_elements again.`);
    return { value: await evalPage<T>(hit.frame, prelude, expression(`@${qualified[2]}`)), frame: hit.frame };
  }
  try {
    return { value: await evalPage<T>(wc.mainFrame, prelude, expression(target)), frame: wc.mainFrame };
  } catch (topError) {
    if (!/^No (element|input) matched/.test((topError as Error).message)) throw topError;
    for (const { frame } of frames) {
      try {
        return { value: await evalPage<T>(frame, prelude, expression(target)), frame };
      } catch (e) {
        if (!/^No (element|input) matched/.test((e as Error).message)) throw e;
      }
    }
    throw topError;
  }
}

// Where a frame's content starts in the tab's viewport: the sum of each
// enclosing <iframe>'s content-box position up to the top page. Each parent
// finds its child frame's element by name, then by address. null when a
// frame's element can't be found — the caller then clicks without the mouse.
async function frameOffset(wc: WebContents, frame: WebFrameMain): Promise<{ x: number; y: number } | null> {
  let x = 0;
  let y = 0;
  let f: WebFrameMain | null = frame;
  while (f && f !== wc.mainFrame) {
    const parent: WebFrameMain | null = f.parent;
    if (!parent) return null;
    let at: { x: number; y: number } | null = null;
    try {
      at = await evalPage<{ x: number; y: number } | null>(
        parent,
        PAGE_HELPERS,
        `(function (name, url) {
          var frames = __bb.DeepAll('iframe, frame');
          var pick = frames.filter(function (el) { return name && el.name === name; })[0];
          if (!pick) pick = frames.filter(function (el) { return el.src && url.indexOf(el.src.split('#')[0]) === 0; })[0];
          if (!pick) {
            var origin = url.split('/').slice(0, 3).join('/');
            var same = frames.filter(function (el) { return el.src && el.src.indexOf(origin) === 0 && __bb.Visible(el); });
            if (same.length === 1) pick = same[0];
          }
          if (!pick) return null;
          var r = pick.getBoundingClientRect(), cs = getComputedStyle(pick);
          return { x: r.left + pick.clientLeft + parseFloat(cs.paddingLeft), y: r.top + pick.clientTop + parseFloat(cs.paddingTop) };
        })(${JSON.stringify(f.name)}, ${JSON.stringify(f.url)})`,
      );
    } catch {
      return null;
    }
    if (!at) return null;
    x += at.x;
    y += at.y;
    f = parent;
  }
  return { x, y };
}

// Wait for whatever an action set off to finish: a full navigation, an
// in-page route change, or nothing. Without this a click on a link returned
// straight away and the next read_page saw the page being left.
async function settleAfter(wc: WebContents, act: () => Promise<unknown>): Promise<void> {
  let started = false;
  let finished = false;
  let inPage = false;
  const onStart = (d: { isMainFrame: boolean; isSameDocument: boolean }) => {
    if (d.isMainFrame && !d.isSameDocument) started = true;
  };
  const onFinish = () => {
    finished = true;
  };
  // Only the page itself counts: an ad or widget iframe failing to load, or
  // routing internally, must not end the wait for the real navigation.
  const onFail = (_e: unknown, _code: number, _desc: string, _url: string, isMainFrame: boolean) => {
    if (isMainFrame) finished = true;
  };
  const onInPage = (_e: unknown, _url: string, isMainFrame: boolean) => {
    if (isMainFrame) inPage = true;
  };
  wc.on('did-start-navigation', onStart);
  wc.on('did-finish-load', onFinish);
  wc.on('did-fail-load', onFail);
  wc.on('did-navigate-in-page', onInPage);
  try {
    // The action's own result (and any error — "No element matched", a
    // timeout) comes first and propagates unchanged: the model must see a
    // failed click as failed, not as a click that "matched" nothing.
    await act();
    // Give whatever it set off a beat to start, then wait for a full
    // navigation to land (capped), or briefly for an in-page route change.
    await waitFor(() => started || inPage || wc.isDestroyed(), 700);
    if (started) await waitFor(() => finished || wc.isDestroyed(), 10_000);
    else if (inPage) await new Promise((r) => setTimeout(r, 400));
  } finally {
    if (!wc.isDestroyed()) {
      wc.off('did-start-navigation', onStart);
      wc.off('did-finish-load', onFinish);
      wc.off('did-fail-load', onFail);
      wc.off('did-navigate-in-page', onInPage);
    }
  }
}

function waitFor(condition: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (condition() || Date.now() - start >= timeoutMs) resolve();
      else setTimeout(tick, 50);
    };
    tick();
  });
}

// Real keyboard input goes through Chrome's own input pipeline (the DevTools
// protocol's Input domain), not webContents.sendInputEvent / insertText:
//  - sendInputEvent delivers to the top-level page only, so keys never reached
//    an editor inside a cross-site frame — Word and PowerPoint Online's
//    document body is exactly that — and the agent could not type there;
//  - insertText into a focused cross-site frame crashes the page's renderer.
// The Input domain routes to whichever frame has focus, like a real keyboard.
async function withInput<T>(wc: WebContents, act: (send: (method: string, params: object) => Promise<unknown>) => Promise<T>): Promise<T> {
  const dbg = wc.debugger;
  const attachedHere = !dbg.isAttached();
  if (attachedHere) {
    try {
      dbg.attach('1.3');
    } catch {
      throw new Error('Keyboard input is unavailable while DevTools is open on this tab. Close DevTools and try again.');
    }
  }
  try {
    return await act((method, params) => dbg.sendCommand(method, params));
  } finally {
    if (attachedHere && dbg.isAttached()) dbg.detach();
  }
}

// Key definitions for the DevTools Input domain. `text` makes the key produce
// a character (Enter submits and breaks lines, Space types a space).
const KEY_DEFS: Record<KeyName, { key: string; code: string; keyCode: number; text?: string }> = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Home: { key: 'Home', code: 'Home', keyCode: 36 },
  End: { key: 'End', code: 'End', keyCode: 35 },
  PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
};

// Text as a typist enters it: line breaks are pressed as Enter.
async function insertLines(send: (method: string, params: object) => Promise<unknown>, text: string): Promise<void> {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) await pressWith(send, KEY_DEFS.Enter);
    if (lines[i]) await send('Input.insertText', { text: lines[i] });
  }
}

async function pressWith(
  send: (method: string, params: object) => Promise<unknown>,
  def: { key: string; code: string; keyCode: number; text?: string },
): Promise<void> {
  const base = { key: def.key, code: def.code, windowsVirtualKeyCode: def.keyCode, nativeVirtualKeyCode: def.keyCode };
  await send('Input.dispatchKeyEvent', def.text ? { type: 'keyDown', ...base, text: def.text, unmodifiedText: def.text } : { type: 'rawKeyDown', ...base });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

// Screenshots go to the model as images; a full-resolution Retina capture can
// pass the API's per-image size limit and fail the whole request.
const SCREENSHOT_MAX_WIDTH = 1280;

export class DesktopToolRuntime implements ToolRuntime {
  constructor(private confirmDelegate: ConfirmDelegate) {}

  private wcFor(tabId: string): WebContents {
    const view = tabManager.getView(tabId);
    if (!view) throw new Error(`Tab not found: ${tabId}`);
    return view.webContents;
  }

  async navigate(tabId: string, url: string) {
    const wc = this.wcFor(tabId);
    // Second line of defence behind the navigate schema's allowlist.
    assertWebUrl(url);
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

  async click(tabId: string, target: string) {
    const wc = this.wcFor(tabId);
    let matched = '';
    await settleAfter(wc, async () => {
      // Find it, bring it into view and show the cursor on it...
      const { value: spot, frame } = await inFrames<ClickSpot>(
        wc,
        target,
        `${PAGE_HELPERS}; ${AGENT_CURSOR}`,
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
        await evalPage<void>(frame, `${PAGE_HELPERS}; ${AGENT_CURSOR}`, `(${CLICK_FN.toString()})(${JSON.stringify(spot.ref)})`);
      }
    });
    return { matched, url: wc.getURL() };
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
      `${PAGE_HELPERS}; ${AGENT_CURSOR}`,
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
    const { value } = await inFrames<string>(wc, target, `${PAGE_HELPERS}; ${AGENT_CURSOR}`, (t) =>
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
    const elements = await evalPage<string[]>(wc, PAGE_HELPERS, `__bb.FindElements(${q})`);
    // Controls inside embedded frames get frame-qualified refs ("@2.7" is ref
    // 7 in frame 2), which click / type / select_option resolve back.
    for (const { frame, index } of subFrames(wc)) {
      try {
        const inner = await evalPage<string[]>(frame, PAGE_HELPERS, `__bb.FindElements(${q})`);
        if (!inner.length) continue;
        elements.push(`— inside embedded frame ${index} (${hostOf(frame.url)}) —`);
        for (const line of inner) elements.push(line.replace(/^@(\d+)/, `@${index}.$1`));
      } catch {
        /* unreadable frame — skip */
      }
    }
    return { elements: elements.slice(0, 200) };
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
      await inFrames<TargetFacts>(wc, target, PAGE_HELPERS, (t) =>
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
    let image = await wc.capturePage();
    if (image.getSize().width > SCREENSHOT_MAX_WIDTH) image = image.resize({ width: SCREENSHOT_MAX_WIDTH });
    return { pngBase64: image.toPNG().toString('base64') };
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
      const now = tabManager.list().find((t) => t.id === tab.id);
      return { id: tab.id, title: now?.title ?? wc.getTitle(), url: wc.getURL(), active: true };
    }
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
    condition: { selector?: string; networkIdle?: boolean; timeoutMs?: number },
  ) {
    const wc = this.wcFor(tabId);
    const timeout = Math.min(condition.timeoutMs ?? 10_000, 10_000);
    if (condition.selector) {
      const matched = await evalPage<boolean>(
        wc,
        PAGE_HELPERS,
        `(${WAIT_FOR_SELECTOR.toString()})(${JSON.stringify(condition.selector)}, ${timeout})`,
      );
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
const READABLE_TEXT_EXPR = EXTRACT_READABLE_TEXT.trim().replace(/;$/, '');

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
const PAGE_HELPERS = String.raw`
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
  var byRef = function (target) {
    var sel = refSelector(target);
    if (!sel) return null;
    var el = api.DeepQuery(sel);
    if (!el) throw new Error('Element ' + target.trim() + ' is no longer on the page (it changed). Call find_elements again for fresh refs.');
    return el;
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
    var seq = api.RefSeq || 0;
    var lines = [];
    for (var i = 0; i < list.length && i < 400; i++) {
      var el = list[i];
      var ref = el.getAttribute('data-bb-ref');
      if (!ref) {
        seq += 1;
        ref = String(seq);
        el.setAttribute('data-bb-ref', ref);
      }
      lines.push(describe(el, ref));
    }
    api.RefSeq = seq;
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
        return scored.slice(0, 80).map(function (x) { return x.line; });
      }
    }
    var shown = lines.slice(0, 80);
    if (lines.length > 80) shown.push('… ' + (lines.length - 80) + ' more here — call find_elements with a query to narrow');
    return shown;
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

// The local the injected PAGE_HELPERS define; CLICK_FN / TYPE_FN are inlined
// into the same script, so they close over it.
declare const __bb: {
  FindClickable(target: string): HTMLElement;
  FindField(target: string): HTMLElement;
  GuardField(el: Element): void;
  Select(el: Element, option: string): string;
  Label(el: Element): string;
  DeepQuery(selector: string): Element | null;
};
type PageWindow = Window & {
  __bbCursor(el: Element | null, opts?: Record<string, unknown>): void;
};

interface ClickSpot {
  matched: string;
  /** Viewport point to press, within the element's own frame. */
  x: number;
  y: number;
  /** Nothing covers the element at that point (a banner, an overlay). */
  onTop: boolean;
  /** A selector for this exact element, so a fallback click hits it. */
  ref: string;
}

function CLICK_SPOT_FN(target: string): Promise<ClickSpot> {
  const w = window as unknown as PageWindow;
  const node = __bb.FindClickable(target);
  node.scrollIntoView({ block: 'center', inline: 'nearest' });
  w.__bbCursor(node, { click: true });
  const token = String(Date.now());
  node.setAttribute('data-bb-click', token);
  const label = __bb.Label(node).slice(0, 80);
  const tag = node.tagName.toLowerCase();
  // Dwell so the user sees where it's going before the page changes.
  return new Promise<ClickSpot>((resolve) => {
    setTimeout(() => {
      const r = node.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2);
      const y = Math.round(r.top + Math.min(r.height / 2, 20));
      let top = document.elementFromPoint(x, y);
      while (top && top.shadowRoot) {
        const inner = top.shadowRoot.elementFromPoint(x, y);
        if (!inner || inner === top) break;
        top = inner;
      }
      const onTop = !!top && (top === node || node.contains(top) || top.contains(node) || !!(top.getRootNode() as ShadowRoot).host && node.contains((top.getRootNode() as ShadowRoot).host));
      resolve({ matched: label ? `${tag} "${label}"` : tag, x, y, onTop, ref: `[data-bb-click="${token}"]` });
    }, 450);
  });
}

function CLICK_FN(target: string): Promise<string> {
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

function TYPE_FN(target: string, text: string): Promise<{ matched: string; native: boolean }> {
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
