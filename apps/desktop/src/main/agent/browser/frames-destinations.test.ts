import type { WebContents, WebFrameMain } from 'electron';
import { expect, it, vi } from 'vitest';
import { assertWebUrl, evalPage, subFrames } from './frames.js';

it('rejects prohibited URLs in the desktop runtime URL guard', () => {
  expect(() => assertWebUrl('https://\u0044UCKDUCKGO.COM./')).toThrow('blocked by BulleBrowser policy');
  expect(() => assertWebUrl('https://agency.gov/')).not.toThrow();
});

it('does not execute a read or action in a prohibited frame or top-level page', async () => {
  const executeJavaScript = vi.fn();
  const frame = { url: 'https://duck.com/', executeJavaScript } as unknown as WebFrameMain;
  const wc = { getURL: () => 'https://\u0064uckduckgo.com/', executeJavaScript } as unknown as WebContents;
  await expect(evalPage(frame, '', 'document.body.innerText')).rejects.toThrow('blocked by BulleBrowser policy');
  await expect(evalPage(wc, '', 'document.body.innerText')).rejects.toThrow('blocked by BulleBrowser policy');
  expect(executeJavaScript).not.toHaveBeenCalled();
});

it('excludes prohibited subframes before page extraction or element discovery', () => {
  const blocked = { url: 'https://links.\u0064uckduckgo.com/', frameTreeNodeId: 2 };
  const allowed = { url: 'https://agency.gov/embedded', frameTreeNodeId: 3 };
  const mainFrame = { framesInSubtree: [blocked, allowed] };
  const wc = { mainFrame } as unknown as WebContents;
  expect(subFrames(wc).map((entry) => entry.index)).toEqual([3]);
});
