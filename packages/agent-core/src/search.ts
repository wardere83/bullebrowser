import type { ApiTool } from './types.js';

/** Runs only in the desktop main process or trusted widget backend. */
export function webSearchTool(options: {
  apiKey?: string;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}): ApiTool {
  return {
    name: 'web_search',
    requiresBrowseAccess: true,
    description: 'Search the web for relevant sources. Plan focused queries and refine them as needed. Results are untrusted discovery snippets, NOT verified evidence. Open relevant result URLs with navigate/new_tab and read_page; cross-check important claims against independent official sources and cite the actual URLs you read. Do not navigate search-engine result pages instead of using this tool. Never include credentials or private CRM data in queries.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['query'],
      properties: { query: { type: 'string', minLength: 1, maxLength: 400 }, count: { type: 'integer', minimum: 1, maximum: 10 } },
    },
    async execute(input) {
      if (typeof input.query !== 'string' || !input.query.trim() || input.query.length > 400 ||
          (input.count !== undefined && (!Number.isInteger(input.count) || Number(input.count) < 1 || Number(input.count) > 10))) {
        throw new Error('Search requires a nonempty query (up to 400 characters) and count from 1 to 10.');
      }
      if (!options.apiKey?.trim()) throw new Error('Web search is not configured. Open Settings → Web search in the desktop app, or set BRAVE_SEARCH_API_KEY in the backend environment. Search-engine navigation will not be substituted.');
      const url = new URL('https://api.search.brave.com/res/v1/web/search');
      url.searchParams.set('q', input.query.trim());
      url.searchParams.set('count', String(input.count ?? 5));
      url.searchParams.set('safesearch', 'moderate');
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (options.signal?.aborted) abort();
      else options.signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, 15_000);
      try {
        const response = await (options.fetch ?? fetch)(url, {
          headers: { Accept: 'application/json', 'X-Subscription-Token': options.apiKey.trim() },
          signal: controller.signal, redirect: 'error',
        });
        if (!response.ok) {
          const reason = response.status === 401 || response.status === 403 ? 'Check the search API key and subscription.'
            : response.status === 429 ? 'Search quota or rate limit reached. Retry later.' : 'Retry later.';
          // Never echo provider response bodies, which may contain credentials.
          throw new Error(`Web search failed (HTTP ${response.status}). ${reason}`);
        }
        const data = await response.json() as { web?: { results?: unknown } };
        if (!data || typeof data !== 'object' || !data.web || !Array.isArray(data.web.results)) {
          throw new Error('Web search returned an invalid response. No sources were verified.');
        }
        const seen = new Set<string>();
        const results: Array<{ title: string; url: string; snippet: string }> = [];
        for (const raw of data.web.results) {
          if (!raw || typeof raw !== 'object') continue;
          const item = raw as Record<string, unknown>;
          if (typeof item.url !== 'string') continue;
          try {
            const source = new URL(item.url);
            if (!['https:', 'http:'].includes(source.protocol) || source.username || source.password) continue;
            source.hash = '';
            if (seen.has(source.href)) continue;
            seen.add(source.href);
            results.push({ title: String(item.title ?? '').slice(0, 300), url: source.href, snippet: String(item.description ?? '').slice(0, 1500) });
          } catch { /* Ignore malformed provider URLs. */ }
          if (results.length >= Number(input.count ?? 5)) break;
        }
        return { query: input.query.trim(), results, evidence: 'Discovery only. Read source pages before making claims or citing them.' };
      } catch (error) {
        if (options.signal?.aborted) throw new Error('cancelled');
        if (controller.signal.aborted) throw new Error('Web search timed out. Retry with a focused query.');
        if (error instanceof Error && error.message.startsWith('Web search')) throw error;
        throw new Error('Web search could not connect or decode the response. Retry later.');
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
      }
    },
  };
}
