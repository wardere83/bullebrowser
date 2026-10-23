import type { ToolRuntime } from './types.js';
import { assertAllowedDestination, isBlockedDestination } from './destinations.js';

/** No hidden HTTP scraping: search is performed in the user's visible tab. */
export function browserSearch(options: { runtime: ToolRuntime; activeTabId: () => string; signal: AbortSignal; presentAction?: (tabId: string, action: string, signal: AbortSignal) => Promise<void> }) {
  return async (query: string, count: number) => {
    const check = () => { if (options.signal.aborted) throw new Error('cancelled'); };
    check();
    const tabId = options.activeTabId();
    if (!tabId) throw new Error('Open a browser tab to search.');
    const url = new URL('https://www.google.com/search');
    url.searchParams.set('q', query);
    assertAllowedDestination(url);
    await options.presentAction?.(tabId, 'navigate', options.signal);
    check();
    await options.runtime.navigate(tabId, url.href);
    check();
    await options.presentAction?.(tabId, 'read_page', options.signal);
    const page = await options.runtime.readPage(tabId);
    check();
    assertAllowedDestination(page.url);
    const host = new URL(page.url).hostname;
    if (!/(^|\.)google\.com$/.test(host)) throw new Error('The search redirected away from the search provider. Review the visible page before retrying.');
    if (!options.runtime.listLinks) throw new Error('This browser cannot retrieve search result links.');
    const links = await options.runtime.listLinks(tabId);
    check();
    const results: Array<{ title: string; url: string; snippet: string }> = [];
    const seen = new Set<string>();
    for (const link of links) {
      try {
        let source = new URL(link.href, page.url);
        if (/(^|\.)google\.com$/.test(source.hostname) && source.pathname === '/url') {
          source = new URL(source.searchParams.get('q') ?? source.searchParams.get('url') ?? '');
        }
        if (!['https:', 'http:'].includes(source.protocol) || source.username || source.password || isBlockedDestination(source) || /(^|\.)(google\.[a-z.]+|bing\.com)$/.test(source.hostname)) continue;
        source.hash = '';
        if (seen.has(source.href) || !link.text?.trim()) continue;
        seen.add(source.href);
        results.push({ title: link.text.trim().slice(0, 300), url: source.href, snippet: '' });
        if (results.length >= count) break;
      } catch { /* Discard malformed or prohibited links. */ }
    }
    if (!results.length) throw new Error('The search page returned no usable source links. It may require consent or a verification challenge; review the visible page. No sources were verified.');
    return { query, results, mode: 'browser', evidence: 'Search links are discovery only. Read source pages before citing claims.' };
  };
}
