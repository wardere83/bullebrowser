// Network activity per tab, for "has the page gone quiet?".
//
// One set of webRequest listeners per session, installed once and left in
// place, counting each tab's requests in flight. (The old per-call listeners
// replaced the session's handlers and tore them down again, so two waits at
// once clobbered each other.) Long-lived connections — web sockets, and any
// request open for more than a few seconds (long-polling chat, live feeds) —
// don't count, so pages that never go fully idle still settle.

import type { Session, WebContents } from 'electron';

const IGNORED_TYPES = new Set(['webSocket', 'ping', 'cspReport', 'media']);
const LONG_LIVED_MS = 4_000;

interface Tracker {
  inflight: Map<number, Map<number, number>>; // webContentsId → requestId → startedAt
}

const trackers = new WeakMap<Session, Tracker>();

export function trackNetwork(session: Session): void {
  if (trackers.has(session)) return;
  const t: Tracker = { inflight: new Map() };
  trackers.set(session, t);
  const filter = { urls: ['<all_urls>'] };
  const end = (d: { id: number; webContentsId?: number }) => {
    if (d.webContentsId === undefined) return;
    t.inflight.get(d.webContentsId)?.delete(d.id);
  };
  session.webRequest.onBeforeRequest(filter, (d, cb) => {
    if (d.webContentsId !== undefined && !IGNORED_TYPES.has(d.resourceType)) {
      let m = t.inflight.get(d.webContentsId);
      if (!m) t.inflight.set(d.webContentsId, (m = new Map()));
      m.set(d.id, Date.now());
    }
    cb({});
  });
  session.webRequest.onCompleted(filter, end);
  session.webRequest.onErrorOccurred(filter, end);
}

function busy(wc: WebContents): number {
  const m = trackers.get(wc.session)?.inflight.get(wc.id);
  if (!m) return 0;
  const now = Date.now();
  let n = 0;
  for (const started of m.values()) if (now - started < LONG_LIVED_MS) n += 1;
  return n;
}

// Resolves true once the tab has had no (short-lived) request in flight for
// quietMs, false if that doesn't happen within timeoutMs.
export function waitForNetworkIdle(wc: WebContents, quietMs = 500, timeoutMs = 6_000): Promise<boolean> {
  trackNetwork(wc.session);
  return new Promise((resolve) => {
    const start = Date.now();
    let quietSince = busy(wc) === 0 ? Date.now() : 0;
    const tick = () => {
      if (wc.isDestroyed()) return resolve(false);
      const now = Date.now();
      if (busy(wc) === 0) {
        if (!quietSince) quietSince = now;
        if (now - quietSince >= quietMs) return resolve(true);
      } else quietSince = 0;
      if (now - start >= timeoutMs) return resolve(false);
      setTimeout(tick, 50);
    };
    tick();
  });
}
