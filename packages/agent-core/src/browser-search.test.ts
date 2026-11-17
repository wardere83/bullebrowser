import { afterEach, expect, it, vi } from 'vitest';
import { browserSearch } from './browser-search.js';
import { webSearchTool } from './search.js';
import type { ToolRuntime } from './types.js';

afterEach(() => { vi.useRealTimers(); });

const tracked = (url: string) => `https://www.bing.com/ck/a?u=a1${Buffer.from(url).toString('base64url')}&ntb=1`;

function fixture(url = 'https://www.bing.com/search?q=grants') {
  const navigate = vi.fn(async (_tabId: string, _url: string) => ({ url, title: 'Search' }));
  const readPage = vi.fn(async () => ({ url, title: 'Search', text: 'Results' }));
  const listLinks = vi.fn(async () => [
    { text: 'Blocked', href: 'https://\u0064uckduckgo.com/' },
    { text: 'Blocked redirect', href: tracked('https://duck.com') },
    { text: 'Program', href: tracked('https://agency.gov/program') },
    { text: 'Duplicate', href: 'https://agency.gov/program#top' },
    { text: 'Another', href: 'https://school.edu/funding' },
  ]);
  const waitFor = vi.fn(async () => ({ matched: false }));
  const runtime = { navigate, readPage, listLinks, waitFor } as unknown as ToolRuntime;
  const controller = new AbortController();
  return { navigate, readPage, listLinks, waitFor, controller, search: browserSearch({ runtime, activeTabId: () => 'tab', signal: controller.signal, engines: ['bing'] }) };
}

// The default order: Startpage first, Bing when Startpage cannot answer. The
// page shown is whatever the last navigation asked for, unless `redirect` says
// where an engine sends the browser instead.
function engines(links: (host: string) => { text: string; href: string }[], redirect: (url: string) => string = (url) => url) {
  let current = 'about:blank';
  const navigate = vi.fn(async (_tabId: string, url: string) => { current = redirect(url); return { url: current, title: 'Search' }; });
  const readPage = vi.fn(async () => ({ url: current, title: 'Search', text: 'Results' }));
  const listLinks = vi.fn(async () => links(new URL(current).hostname));
  const waitFor = vi.fn(async () => ({ matched: false }));
  const runtime = { navigate, readPage, listLinks, waitFor } as unknown as ToolRuntime;
  return { navigate, listLinks, search: browserSearch({ runtime, activeTabId: () => 'tab', signal: new AbortController().signal }) };
}
it('searches visibly without a key and filters prohibited or duplicate result URLs', async () => {
  const f = fixture();
  const fetch = vi.fn<typeof globalThis.fetch>();
  const tool = webSearchTool({ browserSearch: f.search, fetch });
  expect(await tool.execute({ query: 'school grants', count: 2 })).toMatchObject({ mode: 'browser', results: [{ url: 'https://agency.gov/program' }, { url: 'https://school.edu/funding' }] });
  const destination = new URL(f.navigate.mock.calls[0]![1]);
  expect(destination.origin).toBe('https://www.bing.com');
  expect(destination.searchParams.get('q')).toBe('school grants official grant program eligibility');
  expect(fetch).not.toHaveBeenCalled();
});
it('rejects a prohibited search redirect before reading links', async () => {
  const f = fixture('https://lite.\u0064uckduckgo.com/');
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
  vi.useFakeTimers();
  const start = Date.now();
  const f = fixture();
  f.listLinks.mockResolvedValue([]);
  const result = expect(f.search('grants', 3)).rejects.toThrow('verification challenge');
  await vi.runAllTimersAsync();
  await result;
  expect(Date.now() - start).toBe(4000);
  expect(vi.getTimerCount()).toBe(0);
  expect(f.waitFor).toHaveBeenCalledWith('tab', { selector: '#b_results h2 a[href], #b_results [role="heading"] a[href], #b_results a[href]:has(h2)', timeoutMs: 4000 });
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
    ...['https://ddg.gg', 'https://html.\u0064uckduckgo.com/', 'javascript:alert(1)', 'https://user:pass@agency.gov'].map((url) => ({ text: 'Unsafe', href: tracked(url) })),
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

it('decodes and excludes grant-search vendors before accepting official funding results', async () => {
  const f = fixture();
  f.listLinks.mockResolvedValue([
    { text: 'Find grants', href: tracked('https://www.instrumentl.com/grants') },
    { text: 'Grant writing', href: tracked('https://app.grantable.co/') },
    { text: 'Official program', href: tracked('https://foundation.org/grants/youth') },
  ]);
  const result = await f.search('youth grants', 3);
  expect(result.results).toEqual([{ title: 'Official program', url: 'https://foundation.org/grants/youth', snippet: '' }]);
});

it('does not relabel a vendor-only search as verified grant opportunities', async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.listLinks.mockResolvedValue([{ text: 'Grants', href: tracked('https://grantable.co/') }]);
  const result = expect(f.search('school grants', 3)).rejects.toThrow('Grant-search services are excluded');
  await vi.runAllTimersAsync();
  await result;
});

it('keeps ordinary software research available', async () => {
  const f = fixture();
  f.listLinks.mockResolvedValue([{ text: 'Instrumentl', href: tracked('https://instrumentl.com/') }]);
  expect((await f.search('Compare grant search software', 3)).results[0]?.url).toBe('https://instrumentl.com/');
});

it('retries when a heading exists but its link is not usable yet', async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.listLinks.mockResolvedValueOnce([]).mockResolvedValueOnce([{ text: '', href: tracked('https://agency.gov/program') }]);
  f.waitFor.mockResolvedValue({ matched: true });
  const result = f.search('grants', 2);
  await vi.runAllTimersAsync();
  expect((await result).results[0]?.url).toBe('https://agency.gov/program');
  expect(f.listLinks).toHaveBeenCalledTimes(3);
});

it('cancels promptly during a delayed-link retry', async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.listLinks.mockResolvedValue([]);
  const pending = f.search('grants', 2);
  setTimeout(() => f.controller.abort(), 25);
  const result = expect(pending).rejects.toThrow('cancelled');
  await vi.advanceTimersByTimeAsync(25);
  await result;
  expect(f.readPage).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it('waits for usable links after an existing heading matches immediately', async () => {
  vi.useFakeTimers();
  const start = Date.now();
  const f = fixture();
  f.waitFor.mockResolvedValue({ matched: true });
  f.listLinks.mockImplementation(async () => Date.now() - start < 2250
    ? [{ text: '', href: tracked('https://agency.gov/program') }]
    : [{ text: 'Official program', href: tracked('https://agency.gov/program') }]);
  const result = f.search('grants', 1);
  await vi.advanceTimersByTimeAsync(2250);
  expect((await result).results).toEqual([{ title: 'Official program', url: 'https://agency.gov/program', snippet: '' }]);
  expect(f.waitFor).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('revalidates a redirect during later readiness polls before extracting links', async () => {
  vi.useFakeTimers();
  const start = Date.now();
  const f = fixture();
  f.waitFor.mockResolvedValue({ matched: true });
  f.listLinks.mockResolvedValue([]);
  f.readPage.mockImplementation(async () => ({
    url: Date.now() - start >= 2000 ? 'https://duck.com/' : 'https://www.bing.com/search?q=grants',
    title: 'Search', text: 'Loading',
  }));
  const result = expect(f.search('grants', 2)).rejects.toThrow('blocked');
  await vi.advanceTimersByTimeAsync(2000);
  await result;
  expect(f.readPage).toHaveBeenCalledTimes(f.listLinks.mock.calls.length + 1);
  expect(vi.getTimerCount()).toBe(0);
});

it('counts the initial heading wait against the readiness deadline', async () => {
  vi.useFakeTimers();
  const start = Date.now();
  const f = fixture();
  f.listLinks.mockResolvedValue([]);
  f.waitFor.mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    return { matched: false };
  });
  const result = expect(f.search('grants', 2)).rejects.toThrow('no usable source links');
  await vi.runAllTimersAsync();
  await result;
  expect(Date.now() - start).toBe(4000);
  expect(f.readPage).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not blame grant-service exclusions when only Bing placeholders are present', async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.waitFor.mockResolvedValue({ matched: true });
  f.listLinks.mockResolvedValue([
    { text: 'Seattle grants', href: 'https://www.bing.com/search?q=grants' },
    { text: 'Loading program', href: tracked('https://www.bing.com/search?q=program') },
  ]);
  const result = expect(f.search('Seattle grants', 2)).rejects.toThrow('The search page returned no usable source links');
  await vi.runAllTimersAsync();
  await result;
});

it('searches Startpage first, which returns its results as direct links', async () => {
  const f = engines((host) => host === 'www.startpage.com'
    ? [{ text: 'Anonymous view', href: 'https://www.startpage.com/av/proxy?u=x' }, { text: 'NJEDA programs', href: 'https://www.njeda.gov/activeprograms/' }]
    : []);
  const result = await f.search('New Jersey small business grants', 3);
  expect(result).toMatchObject({ engine: 'Startpage', results: [{ url: 'https://www.njeda.gov/activeprograms/' }] });
  expect(f.navigate).toHaveBeenCalledOnce();
  const destination = new URL(f.navigate.mock.calls[0]![1]);
  expect(destination.origin + destination.pathname).toBe('https://www.startpage.com/do/search');
  expect(destination.searchParams.get('q')).toBe('New Jersey small business grants official grant program eligibility');
});

it('falls back to Bing when Startpage shows a challenge instead of results', async () => {
  vi.useFakeTimers();
  const f = engines((host) => host === 'www.bing.com' ? [{ text: 'Program', href: tracked('https://agency.gov/program') }] : []);
  const result = f.search('school grants', 3);
  await vi.runAllTimersAsync();
  expect(await result).toMatchObject({ engine: 'Bing', results: [{ url: 'https://agency.gov/program' }] });
  expect(f.navigate.mock.calls.map(([, url]) => new URL(url).hostname)).toEqual(['www.startpage.com', 'www.bing.com']);
});

it('falls back when Startpage redirects to another site, but never past a blocked one', async () => {
  const away = engines((host) => host === 'www.bing.com' ? [{ text: 'Program', href: tracked('https://agency.gov/program') }] : [],
    (url) => (url.includes('startpage') ? 'https://www.startpage.com.example/verify' : url));
  expect(await away.search('school grants', 3)).toMatchObject({ engine: 'Bing' });
  const blocked = engines(() => [], (url) => (url.includes('startpage') ? 'https://lite.\u0064uckduckgo.com/' : url));
  await expect(blocked.search('school grants', 3)).rejects.toThrow('blocked');
  expect(blocked.navigate).toHaveBeenCalledOnce();
});

it('reports excluded grant-search vendors when no engine found anything else', async () => {
  vi.useFakeTimers();
  const f = engines((host) => host === 'www.startpage.com' ? [{ text: 'Grants', href: 'https://grantable.co/' }] : []);
  const result = expect(f.search('school grants', 3)).rejects.toThrow('Grant-search services are excluded');
  await vi.runAllTimersAsync();
  await result;
});

it('falls back to Bing when Startpage answers with an error status or cannot be reached', async () => {
  for (const code of ['HTTP_ERROR', 'NAVIGATION_TIMEOUT', 'NETWORK_ERROR']) {
    const f = engines((host) => host === 'www.bing.com' ? [{ text: 'Program', href: tracked('https://agency.gov/program') }] : []);
    const navigate = f.navigate.getMockImplementation()!;
    f.navigate.mockImplementation(async (tabId, url) => {
      if (url.includes('startpage')) throw Object.assign(new Error('https://www.startpage.com/do/search answered HTTP 429.'), { code });
      return navigate(tabId, url);
    });
    expect(await f.search('school grants', 3)).toMatchObject({ engine: 'Bing' });
  }
});

it('does not fall back past a policy block or a closed tab', async () => {
  for (const code of ['BLOCKED_BY_POLICY', 'TARGET_CLOSED']) {
    const f = engines(() => []);
    f.navigate.mockRejectedValue(Object.assign(new Error(code), { code }));
    await expect(f.search('school grants', 3)).rejects.toThrow(code);
    expect(f.navigate).toHaveBeenCalledOnce();
  }
});

it('stops at once when Stop is pressed while waiting for results to render', async () => {
  const controller = new AbortController();
  const waitFor = vi.fn(() => new Promise<never>(() => {}));
  const runtime = {
    navigate: vi.fn(async (_tabId: string, url: string) => ({ url, title: 'Search' })),
    readPage: vi.fn(async () => ({ url: 'https://www.startpage.com/do/search?q=x', title: 'Search', text: '' })),
    listLinks: vi.fn(async () => []),
    waitFor,
  } as unknown as ToolRuntime;
  const search = browserSearch({ runtime, activeTabId: () => 'tab', signal: controller.signal });
  const result = expect(search('school grants', 3)).rejects.toThrow('cancelled');
  await vi.waitFor(() => expect(waitFor).toHaveBeenCalled());
  controller.abort();
  await result;
});

// A runtime that can type: the page is the engine's home until Enter is
// pressed in its box, then its results.
function typing({ typeFails = false } = {}) {
  let current = 'about:blank';
  const navigate = vi.fn(async (_tabId: string, url: string) => { current = url; return { url, title: 'Search' }; });
  const type = vi.fn(async () => { if (typeFails) throw Object.assign(new Error('No field matches #q'), { code: 'ELEMENT_NOT_FOUND' }); return { matched: 'input' }; });
  const pressKey = vi.fn(async () => { current = 'https://www.startpage.com/sp/search'; return { pressed: 'Enter' }; });
  const readPage = vi.fn(async () => ({ url: current, title: 'Search', text: 'Results' }));
  const listLinks = vi.fn(async () => (/\/(sp|do)\/search/.test(current) ? [{ text: 'NJEDA programs', href: 'https://www.njeda.gov/activeprograms/' }] : []));
  const waitFor = vi.fn(async () => ({ matched: true }));
  const controller = new AbortController();
  const runtime = { navigate, type, pressKey, readPage, listLinks, waitFor } as unknown as ToolRuntime;
  return { navigate, type, pressKey, controller, search: browserSearch({ runtime, activeTabId: () => 'tab', signal: controller.signal }) };
}

it('opens the engine and types the query into its box, like a person', async () => {
  const f = typing();
  expect(await f.search('New Jersey small business grants', 3)).toMatchObject({ engine: 'Startpage', results: [{ url: 'https://www.njeda.gov/activeprograms/' }] });
  expect(f.navigate.mock.calls.map(([, url]) => url)).toEqual(['https://www.startpage.com/']);
  expect(f.type).toHaveBeenCalledWith('tab', '#q', 'New Jersey small business grants official grant program eligibility');
  expect(f.pressKey).toHaveBeenCalledWith('tab', 'Enter');
});

it('loads the results page directly when the search box cannot be used', async () => {
  const f = typing({ typeFails: true });
  expect(await f.search('school grants', 3)).toMatchObject({ engine: 'Startpage' });
  expect(f.navigate.mock.calls.map(([, url]) => new URL(url).pathname)).toEqual(['/', '/do/search']);
  expect(f.pressKey).not.toHaveBeenCalled();
});

it('does not fall back to another page when Stop is pressed while typing', async () => {
  const f = typing();
  f.type.mockImplementation(async () => { f.controller.abort(); throw new Error('cancelled'); });
  await expect(f.search('school grants', 3)).rejects.toThrow('cancelled');
  expect(f.navigate).toHaveBeenCalledOnce();
});
