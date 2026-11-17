import type { ToolRuntime } from './types.js';
import { assertAllowedDestination, isBlockedDestination } from './destinations.js';
import { fundingSearchQuery, isFundingDiscoveryRequest, isGrantSearchService } from './funding-sources.js';

export type SearchEngineId = 'startpage' | 'bing';

interface SearchEngine {
  name: string;
  host: RegExp;
  url(query: string): URL;
  /** A rendered organic result link: the links listLinks returns on this page. */
  results: string;
  /** How long its results may take to render before the next engine is tried. */
  readyMs: number;
}

// Startpage serves Google's results and answers a browser the agent drives
// with them. Google itself shows its captcha to such a browser, and Bing
// returned news home pages for ordinary grant queries, so Bing is the
// fallback when Startpage cannot answer.
export const SEARCH_ENGINES: Record<SearchEngineId, SearchEngine> = {
  startpage: {
    name: 'Startpage',
    host: /(^|\.)startpage\.com$/,
    url: (query) => { const url = new URL('https://www.startpage.com/do/search'); url.searchParams.set('q', query); return url; },
    results: '.w-gl .result a.result-title[href]',
    // Its results render after the page loads, sometimes six seconds later.
    readyMs: 10000,
  },
  bing: {
    name: 'Bing',
    host: /(^|\.)bing\.com$/,
    url: (query) => { const url = new URL('https://www.bing.com/search'); url.searchParams.set('q', query); return url; },
    results: '#b_results h2 a[href], #b_results [role="heading"] a[href], #b_results a[href]:has(h2)',
    readyMs: 4000,
  },
};
const DEFAULT_ENGINES: SearchEngineId[] = ['startpage', 'bing'];
// A search engine's own pages are never a source.
const SEARCH_HOSTS = /(^|\.)(google\.[a-z.]+|bing\.com|startpage\.com)$/;
const isBing = (url: URL) => SEARCH_ENGINES.bing.host.test(url.hostname);

/** This engine gave no usable results (a challenge, a redirect, an empty page); the next may. */
class EngineUnavailable extends Error {
  constructor(message: string, readonly vendorsOnly = false) { super(message); }
}

// Failures of the engine itself, which another engine may not share: an
// error status (a 403 challenge, a 429 rate limit), a timeout, no network
// route to it. A policy block or a closed tab is never one of these.
const ENGINE_FAILURES = new Set(['HTTP_ERROR', 'NAVIGATION_TIMEOUT', 'NETWORK_ERROR', 'NETWORK_CHANGED']);
const engineFailure = (error: unknown) => ENGINE_FAILURES.has(String((error as { code?: unknown } | null)?.code));

/** Settle with the promise, or reject at once when the run is stopped. */
function untilStopped<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('cancelled'));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error('cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

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
export function browserSearch(options: { runtime: ToolRuntime; activeTabId: () => string; signal: AbortSignal; fundingOnly?: boolean; engines?: SearchEngineId[]; presentAction?: (tabId: string, action: string, signal: AbortSignal) => Promise<void> }) {
  const search = searchWith(options);
  return async (query: string, count: number) => {
    let unavailable: EngineUnavailable | undefined;
    for (const id of options.engines ?? DEFAULT_ENGINES) {
      try {
        return await search(SEARCH_ENGINES[id], query, count);
      } catch (error) {
        if (!(error instanceof EngineUnavailable)) throw error;
        // Say vendors were excluded only when no engine found anything else.
        if (!unavailable?.vendorsOnly || error.vendorsOnly) unavailable = error;
      }
    }
    throw unavailable ?? new Error('No search engine is available.');
  };
}

function searchWith(options: { runtime: ToolRuntime; activeTabId: () => string; signal: AbortSignal; fundingOnly?: boolean; presentAction?: (tabId: string, action: string, signal: AbortSignal) => Promise<void> }) {
  return async (engine: SearchEngine, query: string, count: number) => {
    const check = () => { if (options.signal.aborted) throw new Error('cancelled'); };
    check();
    const tabId = options.activeTabId();
    if (!tabId) throw new Error('Open a browser tab to search.');
    const fundingOnly = options.fundingOnly || isFundingDiscoveryRequest(query);
    // Grant-search services are filtered from the links below, not excluded
    // in the query: the -site: operators derail the engines' results.
    const url = engine.url(fundingSearchQuery(query, fundingOnly, { siteExclusions: false }));
    assertAllowedDestination(url);
    await options.presentAction?.(tabId, 'navigate', options.signal);
    check();
    try {
      await options.runtime.navigate(tabId, url.href);
    } catch (error) {
      check();
      if (engineFailure(error)) throw new EngineUnavailable(`${engine.name} could not answer: ${(error as Error).message}`);
      throw error;
    }
    check();
    await options.presentAction?.(tabId, 'read_page', options.signal);
    check();
    let page = await options.runtime.readPage(tabId);
    check();
    const validatePage = () => {
      assertAllowedDestination(page.url);
      if (!engine.host.test(new URL(page.url).hostname)) throw new EngineUnavailable(`The search redirected away from ${engine.name}. Review the visible page before retrying.`);
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
          && !SEARCH_HOSTS.test(source.hostname)
          && !(fundingOnly && isGrantSearchService(source));
      } catch { return false; }
    });
    // Use elapsed time rather than a retry count: a placeholder heading can
    // satisfy waitFor immediately while its result link renders seconds later.
    const deadline = Date.now() + engine.readyMs;
    let waitedForHeading = false;
    while (!hasSource() && Date.now() < deadline) {
      if (!waitedForHeading) {
        waitedForHeading = true;
        // The page-side wait cannot see Stop, so race it.
        await untilStopped(options.runtime.waitFor(tabId, { selector: engine.results, timeoutMs: Math.max(1, deadline - Date.now()) }), options.signal);
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
        if (!['https:', 'http:'].includes(source.protocol) || source.username || source.password || isBlockedDestination(source) || SEARCH_HOSTS.test(source.hostname)) continue;
        source.hash = '';
        if (seen.has(source.href) || !link.text?.trim()) continue;
        seen.add(source.href);
        results.push({ title: link.text.trim().slice(0, 300), url: source.href, snippet: '' });
        if (results.length >= count) break;
      } catch { /* Discard malformed or prohibited links. */ }
    }
    if (!results.length) throw excludedGrantService
      ? new EngineUnavailable('No usable direct funding sources were found. Grant-search services are excluded. Refine the query toward the funder or official program; no grants were verified.', true)
      : new EngineUnavailable('The search page returned no usable source links. It may require consent or a verification challenge; review the visible page. No sources were verified.');
    return { query, results, mode: 'browser', engine: engine.name, evidence: 'Search links are discovery only. Read source pages before citing claims.' };
  };
}
