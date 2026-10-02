// The browser's record of the element refs it has handed out, per tab and
// frame: the highest number used (so a number is never reused for another
// control) and each ref's fingerprint (so a ref survives a re-render). A
// full navigation to a new document starts the tab afresh.

import type { WebContents, WebFrameMain } from 'electron';
import { frameKey } from './frames.js';

type Fingerprint = Record<string, unknown>;

interface FrameRefs {
  seq: number;
  fps: Map<string, Fingerprint>;
}

const byTab = new Map<number, Map<number, FrameRefs>>();
const watched = new WeakSet<WebContents>();

function watch(wc: WebContents): void {
  if (watched.has(wc)) return;
  watched.add(wc);
  wc.on('did-navigate', () => byTab.delete(wc.id));
  wc.once('destroyed', () => byTab.delete(wc.id));
}

function refsFor(wc: WebContents, key: number): FrameRefs {
  watch(wc);
  let tab = byTab.get(wc.id);
  if (!tab) byTab.set(wc.id, (tab = new Map()));
  let f = tab.get(key);
  if (!f) tab.set(key, (f = { seq: 0, fps: new Map() }));
  return f;
}

/**
 * Statements that hand a frame's ref state to the page helpers: the numbering
 * high-water mark, and — when the target is a ref — that ref's fingerprint.
 */
export function refPrelude(wc: WebContents, frame: WebFrameMain, target = ''): string {
  const f = refsFor(wc, frameKey(wc, frame));
  const n = /^\s*@(\d+)\s*$/.exec(target)?.[1];
  const fp = n ? f.fps.get(n) : undefined;
  return `__bb.RefSeq = ${f.seq}; __bb.Refs = ${fp ? JSON.stringify({ [n!]: fp }) : '{}'};`;
}

/** Record what find_elements just handed out in a frame. */
export function recordRefs(
  wc: WebContents,
  frame: WebFrameMain,
  found: { seq: number; fps: Record<string, Fingerprint> },
): void {
  const f = refsFor(wc, frameKey(wc, frame));
  f.seq = Math.max(f.seq, found.seq);
  for (const [n, fp] of Object.entries(found.fps)) f.fps.set(n, fp);
}
