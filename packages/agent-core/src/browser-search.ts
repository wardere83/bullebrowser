import type { ToolRuntime } from './types.js';
import { assertAllowedDestination, isBlockedDestination } from './destinations.js';
import { fundingSearchQuery, isFundingDiscoveryRequest, isGrantSearchService } from './funding-sources.js';

const isBing = (url: URL) => /(^|\.)bing\.com$/.test(url.hostname);

/** Bing wraps organic links in /ck/a?u=a1<base64url>. Never cite the tracker. */
function sourceUrl(href: string, base: string): URL {
  const link = new URL(href, base);
  if (!isBing(link) || link.pathname !== '/ck/a') return link;
  const target = link.searchParams.get('u') ?? '';
  if (!target.startsWith('a1')) return new URL(target);
  const encoded = target.slice(2).replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  return new URL(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

/** No hidden HTTP scraping: search is performed in the user's visible tab. */
export function browserSearch(options: { runtime: ToolRuntime; activeTabId: () => string; signal: AbortSignal; fundingOnly?: boolean; presentAction?: (tabId: string, action: string, signal: AbortSignal) => Promise<void> }) {
  return async (query: string, count: number) => {
    const check = () => { if (options.signal.aborted) throw new Error('cancelled'); };
    check();
    const tabId = options.activeTabId();
    if (!tabId) throw new Error('Open a browser tab to search.');
    const url = new URL('https://www.bing.com/search');
    const fundingOnly = options.fundingOnly || isFundingDiscoveryRequest(query);
    url.searchParams.set('q', fundingSearchQuery(query, fundingOnly));
    assertAllowedDestination(url);
    await options.presentAction?.(tabId, 'navigate', options.signal);
    check();
    await options.runtime.navigate(tabId, url.href);
    check();
    await options.presentAction?.(tabId, 'read_page', options.signal);
    check();
    let page = await options.runtime.readPage(tabId);
    check();
    const validatePage = () => {
      assertAllowedDestination(page.url);
      if (!isBing(new URL(page.url))) throw new Error('The search redirected away from Bing. Review the visible page before retrying.');
    };
    validatePage();
    if (!options.runtime.listLinks) throw new Error('This browser cannot retrieve search result links.');
    let links = await options.runtime.listLinks(tabId);
    check();
    // A result heading can exist before its link is usable. Check the same
    // acceptance criteria as extraction, then retry the rendered page boundedly.
    const hasSource = () => links.some((link) => {
      try {
        const source = sourceUrl(link.href, page.url);
        return Boolean(link.text?.trim()) && ['https:', 'http:'].includes(source.protocol)
          && !source.username && !source.password && !isBlockedDestination(source)
          && !/(^|\.)(google\.[a-z.]+|bing\.com)$/.test(source.hostname)
          && !(fundingOnly && isGrantSearchService(source));
      } catch { return false; }
    });
    // Use elapsed time rather than a retry count: a placeholder heading can
    // satisfy waitFor immediately while its result link renders seconds later.
    const deadline = Date.now() + 4000;
    let waitedForHeading = false;
    while (!hasSource() && Date.now() < deadline) {
      if (!waitedForHeading) {
        waitedForHeading = true;
        await options.runtime.waitFor(tabId, { selector: '#b_results h2 a[href], #b_results [role="heading"] a[href], #b_results a[href]:has(h2)', timeoutMs: Math.max(1, deadline - Date.now()) });
      } else {
        await new Promise<void>((resolve, reject) => {
          const abort = () => {
            clearTimeout(timer);
            options.signal.removeEventListener('abort', abort);
            reject(new Error('cancelled'));
          };
          const timer = setTimeout(() => {
            options.signal.removeEventListener('abort', abort);
            resolve();
          }, Math.min(250, Math.max(0, deadline - Date.now())));
          options.signal.addEventListener('abort', abort, { once: true });
          if (options.signal.aborted) abort();
        });
      }
      check();
      page = await options.runtime.readPage(tabId);
      check();
      validatePage();
      links = await options.runtime.listLinks(tabId);
      check();
    }
    check();
    const results: Array<{ title: string; url: string; snippet: string }> = [];
    let excludedGrantService = false;
    const seen = new Set<string>();
    for (const link of links) {
      try {
        const source = sourceUrl(link.href, page.url);
        if (fundingOnly && isGrantSearchService(source)) {
          excludedGrantService = true;
          continue;
        }
        if (!['https:', 'http:'].includes(source.protocol) || source.username || source.password || isBlockedDestination(source) || /(^|\.)(google\.[a-z.]+|bing\.com)$/.test(source.hostname)) continue;
        source.hash = '';
        if (seen.has(source.href) || !link.text?.trim()) continue;
        seen.add(source.href);
        results.push({ title: link.text.trim().slice(0, 300), url: source.href, snippet: '' });
        if (results.length >= count) break;
      } catch { /* Discard malformed or prohibited links. */ }
    }
    if (!results.length) throw new Error(excludedGrantService
      ? 'No usable direct funding sources were found. Grant-search services are excluded. Refine the query toward the funder or official program; no grants were verified.'
      : 'The search page returned no usable source links. It may require consent or a verification challenge; review the visible page. No sources were verified.');
    return { query, results, mode: 'browser', evidence: 'Search links are discovery only. Read source pages before citing claims.' };
  };
}
