import { expect, it, vi } from 'vitest';
import { webSearchTool } from './search.js';

it('filters vendor results for funding and requests enough candidates to replace them', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ web: { results: [
    { title: 'Search tool', url: 'https://instrumentl.com/grants' },
    { title: 'Grant writing service', url: 'https://grantable.co/' },
    { title: 'Government program', url: 'https://agency.gov/grants' },
    { title: 'Foundation program', url: 'https://foundation.org/youth' },
  ] } })));
  const result = await webSearchTool({ apiKey: 'private', fundingOnly: true, fetch: request }).execute({ query: 'California youth', count: 2 });
  expect(result).toMatchObject({ results: [{ url: 'https://agency.gov/grants' }, { url: 'https://foundation.org/youth' }] });
  const sent = new URL(String(request.mock.calls[0]![0]));
  expect(sent.searchParams.get('q')).toContain('-site:instrumentl.com');
  expect(sent.searchParams.get('count')).toBe('10');
});

it('uses header authentication, filters unsafe and duplicate results, and labels snippets', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ web: { results: [
    { title: 'Official', url: 'https://example.com/#a', description: 'Text' },
    { url: 'https://example.com/' }, { url: 'file:///secret' },
  ] } })));
  const tool = webSearchTool({ apiKey: 'private', fetch: request });
  expect(tool.requiresBrowseAccess).toBe(true);
  expect(await tool.execute({ query: 'official grants' })).toMatchObject({ results: [{ title: 'Official', url: 'https://example.com/' }], evidence: expect.stringContaining('Discovery only') });
  const [url, init] = request.mock.calls[0]!;
  expect(String(url)).not.toContain('private');
  expect(init?.headers).toMatchObject({ 'X-Subscription-Token': 'private' });
});
it('fails explicitly without a key or valid arguments without making requests', async () => {
  const request = vi.fn<typeof fetch>();
  const tool = webSearchTool({ fetch: request });
  await expect(tool.execute({ query: 'grants' })).rejects.toMatchObject({ code: 'SEARCH_NOT_CONFIGURED', message: expect.stringContaining('Open Settings → Web search') });
  await expect(tool.execute({ query: '', count: 99 })).rejects.toThrow('nonempty');
  expect(request).not.toHaveBeenCalled();
});
it.each([401, 403, 429, 503])('reports HTTP %s without echoing provider secrets', async (status) => {
  const tool = webSearchTool({ apiKey: 'private', fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response('private', { status })) });
  await expect(tool.execute({ query: 'grants' })).rejects.toThrow(`HTTP ${status}`);
  await expect(tool.execute({ query: 'grants' })).rejects.not.toThrow('private');
});
it('handles empty results and malformed responses', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('{"web":{"results":[]}}')).mockResolvedValueOnce(new Response('{}'));
  const tool = webSearchTool({ apiKey: 'private', fetch: request });
  expect(await tool.execute({ query: 'nothing' })).toMatchObject({ results: [] });
  await expect(tool.execute({ query: 'broken' })).rejects.toThrow('invalid response');
});
it('aborts the HTTP request on Stop', async () => {
  const controller = new AbortController();
  const request = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => reject(new Error('abort')), { once: true });
  }));
  const result = webSearchTool({ apiKey: 'private', signal: controller.signal, fetch: request }).execute({ query: 'grants' });
  controller.abort();
  await expect(result).rejects.toThrow('cancelled');
});
