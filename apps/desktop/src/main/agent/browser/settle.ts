// Waiting for what an action set off to finish before the agent looks again.
//
// "Loaded" used to mean the load event, so read_page often ran while a
// client-rendered page was still fetching and drawing, and the agent answered
// from a loading state. Settling now means: any navigation the action started
// has committed and loaded, the network has gone quiet, and the DOM has
// stopped changing for a moment. Pages that never go idle (chat apps, live
// dashboards) are capped, and callers can opt out with wait: 'load' | 'none'.

import type { WebContents } from 'electron';
import { waitForNetworkIdle } from './net-activity.js';

export type WaitMode = 'idle' | 'load' | 'none';

const DOM_QUIET_MS = 300;
const DOM_QUIET_CAP_MS = 2_500;
const NAV_CAP_MS = 15_000;

// Resolves once the page's DOM has had no mutations for quietMs (or the cap).
const DOM_QUIET = (quietMs: number, capMs: number) => `
  new Promise(function (resolve) {
    if (!document.documentElement) return resolve(false);
    var last = Date.now(), start = Date.now();
    var mo = new MutationObserver(function () { last = Date.now(); });
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    (function tick() {
      var now = Date.now();
      if (now - last >= ${quietMs} || now - start >= ${capMs}) { mo.disconnect(); return resolve(now - last >= ${quietMs}); }
      setTimeout(tick, 50);
    })();
  })`;

// Network quiet, then DOM quiet. Best effort: never throws.
export async function pageQuiet(wc: WebContents, networkCapMs = 6_000): Promise<void> {
  if (wc.isDestroyed()) return;
  await waitForNetworkIdle(wc, 500, networkCapMs);
  if (wc.isDestroyed()) return;
  await wc.executeJavaScript(DOM_QUIET(DOM_QUIET_MS, DOM_QUIET_CAP_MS)).catch(() => {});
}

// Run an action, then wait for what it set off: a full navigation (to load),
// an in-page route change, or nothing — and then, in 'idle' mode, for the page
// to go quiet. The action's own errors propagate unchanged.
export async function settleAfter(
  wc: WebContents,
  act: () => Promise<unknown>,
  mode: WaitMode = 'idle',
): Promise<void> {
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
    await act();
    if (mode === 'none') return;
    // Give whatever it set off a beat to start, then wait for a full
    // navigation to land (capped), or briefly for an in-page route change.
    await waitFor(() => started || inPage || wc.isDestroyed(), 700);
    if (started) await waitFor(() => finished || wc.isDestroyed(), NAV_CAP_MS);
    else if (inPage) await new Promise((r) => setTimeout(r, 300));
    if (mode === 'idle') await pageQuiet(wc, started ? 6_000 : 3_000);
  } finally {
    if (!wc.isDestroyed()) {
      wc.off('did-start-navigation', onStart);
      wc.off('did-finish-load', onFinish);
      wc.off('did-fail-load', onFail);
      wc.off('did-navigate-in-page', onInPage);
    }
  }
}

export function waitFor(condition: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (condition() || Date.now() - start >= timeoutMs) resolve();
      else setTimeout(tick, 50);
    };
    tick();
  });
}
