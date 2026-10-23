import type { Session, WebContents } from 'electron';
import { afterEach, expect, it, vi } from 'vitest';
import { trackNetwork, waitForNetworkIdle } from './net-activity.js';

function sessionFixture() {
  const webRequest = { onBeforeRequest: vi.fn(), onCompleted: vi.fn(), onErrorOccurred: vi.fn() };
  const session = { webRequest } as unknown as Session;
  trackNetwork(session);
  const before = webRequest.onBeforeRequest.mock.calls[0]![1] as (
    details: { id: number; url: string; resourceType: string; webContentsId?: number },
    callback: (result: { cancel?: boolean }) => void,
  ) => void;
  return { session, webRequest, before };
}

afterEach(() => vi.useRealTimers());

it('cancels every prohibited resource before sending, including untracked/background requests', () => {
  const { before } = sessionFixture();
  for (const resourceType of ['mainFrame', 'subFrame', 'script', 'image', 'xhr', 'webSocket', 'ping', 'media']) {
    for (const url of ['https://duckduckgo.com/', 'https://html.duckduckgo.com/', 'https://DUCK.COM./', 'wss://ddg.gg/']) {
      const callback = vi.fn();
      before({ id: 1, url, resourceType }, callback);
      expect(callback).toHaveBeenCalledExactlyOnceWith({ cancel: true });
    }
  }
});

it('preserves allowed searches and installs only one listener per session', () => {
  const { session, webRequest, before } = sessionFixture();
  trackNetwork(session);
  const callback = vi.fn();
  before({ id: 2, webContentsId: 3, url: 'https://api.search.brave.com/res/v1/web/search?q=grants', resourceType: 'xhr' }, callback);
  expect(callback).toHaveBeenCalledExactlyOnceWith({});
  expect(webRequest.onBeforeRequest).toHaveBeenCalledTimes(1);
  expect(webRequest.onCompleted).toHaveBeenCalledTimes(1);
  expect(webRequest.onErrorOccurred).toHaveBeenCalledTimes(1);
});

it('does not let blocked requests keep a permitted page busy', async () => {
  vi.useFakeTimers();
  const { session, before } = sessionFixture();
  before({ id: 1, webContentsId: 3, url: 'https://duckduckgo.com/tracker', resourceType: 'image' }, vi.fn());
  const wc = { id: 3, session, isDestroyed: () => false } as unknown as WebContents;
  const idle = waitForNetworkIdle(wc, 100, 1000);
  await vi.advanceTimersByTimeAsync(100);
  await expect(idle).resolves.toBe(true);
});
