import type { Session, WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { trackNetwork, waitForNetworkIdle } from './net-activity.js';

describe('session request restrictions', () => {
  it('cancels all restricted request types before transfer without replacing the network tracker', async () => {
    const onBeforeRequest = vi.fn();
    const session = { webRequest: { onBeforeRequest, onCompleted: vi.fn(), onErrorOccurred: vi.fn() } } as unknown as Session;
    trackNetwork(session);
    trackNetwork(session);
    expect(onBeforeRequest).toHaveBeenCalledTimes(1);
    const before = onBeforeRequest.mock.calls[0]![1];
    for (const resourceType of ['mainFrame', 'subFrame', 'xhr', 'image', 'ping', 'webSocket']) {
      const callback = vi.fn();
      before({ url: 'https://html.duckduckgo.com/?q=private', id: 1, webContentsId: 12, resourceType }, callback);
      expect(callback).toHaveBeenCalledWith({ cancel: true });
    }
    const wc = { session, id: 12, isDestroyed: () => false } as unknown as WebContents;
    expect(await waitForNetworkIdle(wc, 0, 100)).toBe(true);
    const allowed = vi.fn();
    before({ url: 'https://agency.gov/', id: 2, webContentsId: 12, resourceType: 'mainFrame' }, allowed);
    expect(allowed).toHaveBeenCalledWith({});
    expect(await waitForNetworkIdle(wc, 0, 1)).toBe(false);
    const end = (session.webRequest.onCompleted as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    end({ id: 2, webContentsId: 12 });
    expect(await waitForNetworkIdle(wc, 0, 100)).toBe(true);
  });
});
