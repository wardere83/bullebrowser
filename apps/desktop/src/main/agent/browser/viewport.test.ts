import { afterEach, expect, it, vi } from 'vitest';
import { FIRST_VIEWPORT_FN } from './page-scripts.js';
afterEach(() => vi.unstubAllGlobals());
it('publishes only visible viewport text and excludes scripts, hidden and below-fold text', () => {
  const nodes = [
    { text: 'Visible', top: 10, tag: 'P' }, { text: 'Below fold', top: 900, tag: 'P' },
    { text: 'Script', top: 10, tag: 'SCRIPT' }, { text: 'Hidden', top: 10, tag: 'P', hidden: true },
  ].map((item) => ({ textContent: item.text, parentElement: { tagName: item.tag, hidden: item.hidden, getBoundingClientRect: () => ({ width: 100, height: 20, top: item.top, bottom: item.top + 20 }) } }));
  let index = 0;
  vi.stubGlobal('document', { title: 'Fixture', body: {}, createTreeWalker: () => ({ nextNode: () => nodes[index++] ?? null }) });
  vi.stubGlobal('NodeFilter', { SHOW_TEXT: 4 }); vi.stubGlobal('innerHeight', 600);
  vi.stubGlobal('location', { href: 'https://example.com/' });
  vi.stubGlobal('getComputedStyle', (el: { hidden?: boolean }) => ({ visibility: el.hidden ? 'hidden' : 'visible' }));
  // Execute the same serialized function that Chromium receives.
  const result = new Function('return (' + FIRST_VIEWPORT_FN.toString() + ')()')();
  expect(result).toEqual({ url: 'https://example.com/', title: 'Fixture', text: 'Visible\n' });
});
