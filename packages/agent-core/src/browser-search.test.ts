import { expect, it, vi } from 'vitest';
import { browserSearch } from './browser-search.js';
import { webSearchTool } from './search.js';
import type { ToolRuntime } from './types.js';

function fixture(url = 'https://www.google.com/search?q=grants') {
  const navigate = vi.fn(async () => ({ url, title: 'Search' }));
  const readPage = vi.fn(async () => ({ url, title: 'Search', text: 'Results' }));
  const listLinks = vi.fn(async () => [
    { text: 'Blocked', href: 'https://duckduckgo.com/' },
    { text: 'Blocked redirect', href: 'https://www.google.com/url?q=https%3A%2F%2Fduck.com' },
    { text: 'Program', href: 'https://www.google.com/url?q=https%3A%2F%2Fagency.gov%2Fprogram' },
    { text: 'Duplicate', href: 'https://agency.gov/program#top' },
    { text: 'Another', href: 'https://school.edu/funding' },
  ]);
  const runtime = { navigate, readPage, listLinks } as unknown as ToolRuntime;
  const controller = new AbortController();
  return { navigate, readPage, listLinks, controller, search: browserSearch({ runtime, activeTabId: () => 'tab', signal: controller.signal }) };
}
it('searches visibly without a key and filters prohibited or duplicate result URLs', async () => {
  const f = fixture();
  const fetch = vi.fn<typeof globalThis.fetch>();
  const tool = webSearchTool({ browserSearch: f.search, fetch });
  expect(await tool.execute({ query: 'school grants', count: 2 })).toMatchObject({ mode: 'browser', results: [{ url: 'https://agency.gov/program' }, { url: 'https://school.edu/funding' }] });
  expect(f.navigate).toHaveBeenCalledWith('tab', 'https://www.google.com/search?q=school+grants');
  expect(fetch).not.toHaveBeenCalled();
});
it('rejects a prohibited search redirect before reading links', async () => {
  const f = fixture('https://lite.duckduckgo.com/');
  await expect(f.search('grants', 3)).rejects.toThrow('blocked');
  expect(f.listLinks).not.toHaveBeenCalled();
});
it('does not start navigation after Stop', async () => {
  const f = fixture();
  f.controller.abort();
  await expect(f.search('grants', 3)).rejects.toThrow('cancelled');
  expect(f.navigate).not.toHaveBeenCalled();
});
it('reports challenge/empty results rather than inventing sources', async () => {
  const f = fixture();
  f.listLinks.mockResolvedValue([]);
  await expect(f.search('grants', 3)).rejects.toThrow('verification challenge');
});
