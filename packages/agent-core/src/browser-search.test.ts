import { expect, it, vi } from 'vitest';
import { browserSearch } from './browser-search.js';
import { webSearchTool } from './search.js';
import type { ToolRuntime } from './types.js';

const tracked = (url: string) => `https://www.bing.com/ck/a?u=a1${Buffer.from(url).toString('base64url')}&ntb=1`;

function fixture(url = 'https://www.bing.com/search?q=grants') {
  const navigate = vi.fn(async () => ({ url, title: 'Search' }));
  const readPage = vi.fn(async () => ({ url, title: 'Search', text: 'Results' }));
  const listLinks = vi.fn(async () => [
    { text: 'Blocked', href: 'https://duckduckgo.com/' },
    { text: 'Blocked redirect', href: tracked('https://duck.com') },
    { text: 'Program', href: tracked('https://agency.gov/program') },
    { text: 'Duplicate', href: 'https://agency.gov/program#top' },
    { text: 'Another', href: 'https://school.edu/funding' },
  ]);
  const waitFor = vi.fn(async () => ({ matched: false }));
  const runtime = { navigate, readPage, listLinks, waitFor } as unknown as ToolRuntime;
  const controller = new AbortController();
  return { navigate, readPage, listLinks, waitFor, controller, search: browserSearch({ runtime, activeTabId: () => 'tab', signal: controller.signal }) };
}
it('searches visibly without a key and filters prohibited or duplicate result URLs', async () => {
  const f = fixture();
  const fetch = vi.fn<typeof globalThis.fetch>();
  const tool = webSearchTool({ browserSearch: f.search, fetch });
  expect(await tool.execute({ query: 'school grants', count: 2 })).toMatchObject({ mode: 'browser', results: [{ url: 'https://agency.gov/program' }, { url: 'https://school.edu/funding' }] });
  expect(f.navigate).toHaveBeenCalledWith('tab', 'https://www.bing.com/search?q=school+grants');
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
  expect(f.waitFor).toHaveBeenCalledWith('tab', { selector: '#b_results .b_algo h2 a', timeoutMs: 4000 });
});

it('waits once for delayed results and reads the updated page', async () => {
  const f = fixture();
  f.listLinks.mockResolvedValueOnce([]);
  expect(await f.search('grants', 2)).toMatchObject({ results: [{ url: 'https://agency.gov/program' }, { url: 'https://school.edu/funding' }] });
  expect(f.waitFor).toHaveBeenCalledTimes(1);
  expect(f.readPage).toHaveBeenCalledTimes(2);
});

it('rejects malformed, unsafe and prohibited encoded destinations', async () => {
  const f = fixture();
  f.listLinks.mockResolvedValue([
    ...['https://ddg.gg', 'https://html.duckduckgo.com/', 'javascript:alert(1)', 'https://user:pass@agency.gov'].map((url) => ({ text: 'Unsafe', href: tracked(url) })),
    { text: 'Malformed', href: 'https://www.bing.com/ck/a?u=a1!!!!' },
    { text: 'Navigation', href: 'https://www.bing.com/search?q=other' },
    { text: 'Valid', href: tracked('https://school.edu/funding') },
  ]);
  expect(await f.search('grants', 5)).toMatchObject({ results: [{ url: 'https://school.edu/funding' }] });
});

it('honors Stop while waiting without reading more pages', async () => {
  const f = fixture();
  f.listLinks.mockResolvedValue([]);
  f.waitFor.mockImplementation(async () => { f.controller.abort(); return { matched: false }; });
  await expect(f.search('grants', 3)).rejects.toThrow('cancelled');
  expect(f.readPage).toHaveBeenCalledTimes(1);
});

it('rejects redirects to another provider instead of misidentifying its links', async () => {
  const f = fixture('https://www.google.com/search?q=grants');
  await expect(f.search('grants', 3)).rejects.toThrow('redirected away from Bing');
  expect(f.listLinks).not.toHaveBeenCalled();
});

it('rechecks the destination after waiting for results', async () => {
  const f = fixture();
  f.listLinks.mockResolvedValue([]);
  f.readPage.mockResolvedValueOnce({ url: 'https://www.bing.com/search?q=grants', title: 'Search', text: 'Loading' })
    .mockResolvedValueOnce({ url: 'https://duck.com/', title: 'Redirect', text: 'Redirect' });
  await expect(f.search('grants', 3)).rejects.toThrow('blocked');
  expect(f.listLinks).toHaveBeenCalledTimes(1);
});
