// Frames: running scripts in a tab's frames and finding which frame holds a
// target. Word Online's document, embedded forms and payment widgets live in
// cross-site iframes, so every targeted action goes through here.

import type { WebContents, WebFrameMain } from 'electron';
import { PAGE_HELPERS } from './page-scripts.js';

// The agent drives a real browser holding the user's live sessions, so only
// web pages may be opened — never file:, data: or javascript: URLs, whatever
// tool or caller the URL arrives through.
export function assertWebUrl(url: string): void {
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
export const EVAL_TIMEOUT_MS = 15_000;

export async function evalPage<T>(
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
export type FramePurpose = 'editor' | 'chat' | 'ad' | 'auth' | 'nav' | 'content';

export interface SubFrame {
  frame: WebFrameMain;
  /** frameTreeNodeId: survives the frame moving process, used in refs. */
  index: number;
  purpose: FramePurpose;
}

// What a frame is for, from where it comes from. The agent no longer has to
// work out which of a page's frames is the document editor, which is a chat
// widget, which is an ad or a sign-in box. find_elements shows the label, and
// targets can name it ("editor:Bold", or just "editor" for typing).
const PURPOSE_RULES: [FramePurpose, RegExp][] = [
  ['editor', /(word|excel|powerpoint|onenote)-edit\.officeapps\.live\.com|officeapps\.live\.com\/(we|xe|pe|ne)\/|docs\.google\.com\/(document|spreadsheets|presentation)|\.notion\.so|quip\.com|editor/i],
  ['auth', /login\.(microsoftonline|live|windows)\.|accounts\.google\.|appleid\.apple\.com|auth0\.com|okta\.com|\/oauth|\/(signin|sign-in|login)\b|recaptcha|hcaptcha|challenges\.cloudflare\.com|turnstile/i],
  ['chat', /copilot|bing\.com\/(chat|turing)|intercom|drift\.com|zendesk|livechat|tawk\.to|crisp\.chat|hubspot.*(conversations|messages)|chatwidget|webchat|\/chat\b/i],
  ['ad', /doubleclick|googlesyndication|googleadservices|adservice|amazon-adsystem|taboola|outbrain|adnxs|criteo|pubmatic|rubiconproject|\/ads?\//i],
  ['nav', /\/(nav|navigation|menu|header|sidebar)\b/i],
];

export function framePurpose(url: string, name = ''): FramePurpose {
  const s = `${url} ${name}`;
  for (const [purpose, re] of PURPOSE_RULES) if (re.test(s)) return purpose;
  return 'content';
}

export function subFrames(wc: WebContents): SubFrame[] {
  const out: SubFrame[] = [];
  for (const f of wc.mainFrame.framesInSubtree) {
    try {
      if (f === wc.mainFrame || f.detached || !/^https?:/.test(f.url)) continue;
      out.push({ frame: f, index: f.frameTreeNodeId, purpose: framePurpose(f.url, f.name) });
    } catch {
      /* a frame disposed while we were listing: not there any more */
    }
  }
  return out;
}

/** The key refs are filed under: 0 for the top page, else frameTreeNodeId. */
export function frameKey(wc: WebContents, frame: WebFrameMain): number {
  return frame === wc.mainFrame ? 0 : frame.frameTreeNodeId;
}

export function hostOf(url: string): string {
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
export type Prelude = string | ((frame: WebFrameMain, target: string) => string);

const ALIAS = /^\s*(editor|chat|auth|ad|nav|main)\s*(?::\s*(.+))?$/i;

export async function inFrames<T>(
  wc: WebContents,
  target: string,
  prelude: Prelude,
  expression: (target: string) => string,
): Promise<{ value: T; frame: WebFrameMain }> {
  const pre = (frame: WebFrameMain, t: string) => (typeof prelude === 'string' ? prelude : prelude(frame, t));
  const run = (frame: WebFrameMain, t: string) => evalPage<T>(frame, pre(frame, t), expression(t));
  const notFound = (e: unknown) => /^No (element|input) matched/.test((e as Error).message);
  const qualified = /^\s*@(\d+)\.(\d+)\s*$/.exec(target);
  const frames = subFrames(wc);
  if (qualified) {
    const hit = frames.find((f) => f.index === Number(qualified[1]));
    if (!hit) throw new Error(`Frame ${qualified[1]} is gone (the page changed). Call find_elements again.`);
    return { value: await run(hit.frame, `@${qualified[2]}`), frame: hit.frame };
  }
  // A ref without a frame number belongs to the top page only.
  if (/^\s*@\d+\s*$/.test(target)) return { value: await run(wc.mainFrame, target), frame: wc.mainFrame };

  // "editor:Bold" searches the editor frame(s) first; a bare "editor" means
  // that frame's main writing surface.
  const alias = ALIAS.exec(target);
  let order: WebFrameMain[] = [wc.mainFrame, ...frames.map((f) => f.frame)];
  let t = target;
  if (alias) {
    const purpose = alias[1]!.toLowerCase();
    t = alias[2] ?? (purpose === 'editor' ? 'document' : target);
    if (purpose === 'main') order = [wc.mainFrame];
    else {
      const matching = frames.filter((f) => f.purpose === purpose).map((f) => f.frame);
      if (alias[2] !== undefined && matching.length === 0) {
        throw new Error(`No input matched ${target}: there is no ${purpose} frame on this page.`);
      }
      order = [...matching, ...order.filter((f) => !matching.includes(f))];
    }
  }
  let firstError: unknown;
  for (const frame of order) {
    try {
      return { value: await run(frame, t), frame };
    } catch (e) {
      if (!notFound(e)) throw e;
      firstError ??= e;
    }
  }
  throw firstError;
}

// Where a frame's content starts in the tab's viewport: the sum of each
// enclosing <iframe>'s content-box position up to the top page. Each parent
// finds its child frame's element by name, then by address. null when a
// frame's element can't be found — the caller then clicks without the mouse.
export async function frameOffset(wc: WebContents, frame: WebFrameMain): Promise<{ x: number; y: number } | null> {
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

