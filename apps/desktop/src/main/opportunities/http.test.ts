import { describe, expect, it, vi } from 'vitest';
import { createHttpClient } from './http.js';

const reply = (body: string, init: { status?: number; type?: string; length?: string } = {}) =>
  new Response(body, {
    status: init.status ?? 200,
    headers: {
      'content-type': init.type ?? 'application/json',
      ...(init.length ? { 'content-length': init.length } : {}),
    },
  });
const request = (extra: object = {}) => ({
  url: 'https://example.gov/api',
  source: 'Example Grants',
  signal: new AbortController().signal,
  ...extra,
});

describe('funding source requests', () => {
  it('sends JSON bodies as POST with a browser-like agent and no organization data', async () => {
    const fetchMock = vi.fn(async () => reply('{"ok":true}'));
    const http = createHttpClient(fetchMock);
    expect(await http.json(request({ body: { keyword: 'workforce' } }))).toEqual({ ok: true });
    const [, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"keyword":"workforce"}');
    const headers = init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(headers['user-agent']).toMatch(/Mozilla/);
    expect(Object.keys(headers).map((key) => key.toLowerCase())).not.toContain('origin');
  });

  it('defaults to GET and returns text when asked', async () => {
    const fetchMock = vi.fn(async () => reply('<rss/>', { type: 'application/rss+xml' }));
    const http = createHttpClient(fetchMock);
    expect(await http.text(request())).toBe('<rss/>');
    expect((fetchMock.mock.calls[0]! as unknown as [string, RequestInit])[1].method).toBe('GET');
  });

  it.each([
    ['an error status', () => reply('{}', { status: 503 }), /status 503/],
    ['a web page served as success', () => reply('<!doctype html><title>Just a moment</title>', { type: 'text/html' }), /web page instead of data/],
    ['a challenge page mislabelled as JSON', () => reply('  <html>blocked</html>'), /web page instead of data/],
    ['broken data', () => reply('{"rows": [1, 2'), /not valid data/],
    ['an oversized answer', () => reply('{}', { length: String(50 * 1024 * 1024) }), /too large/],
  ])('reports %s as the source being unavailable, never as an empty result', async (_label, respond, message) => {
    const http = createHttpClient(async () => respond());
    await expect(http.json(request())).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE', message: expect.stringMatching(message) });
    await expect(http.json(request())).rejects.toThrow(/^Example Grants could not be read/);
  });

  it('reports a dropped connection without leaking the underlying error', async () => {
    const http = createHttpClient(async () => {
      throw new TypeError('getaddrinfo ENOTFOUND internal-host.example');
    });
    const failure = http.json(request());
    await expect(failure).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
    await expect(failure).rejects.not.toThrow(/ENOTFOUND|internal-host/);
  });

  it('times out a source that never answers', async () => {
    const http = createHttpClient(
      (_url, init) => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted')))),
    );
    await expect(http.json(request({ timeoutMs: 20 }))).rejects.toThrow(/took too long/);
  });

  it('stops immediately when the search is cancelled', async () => {
    const controller = new AbortController();
    const http = createHttpClient(
      (_url, init) => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted')))),
    );
    const pending = http.json(request({ signal: controller.signal }));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    await expect(http.json(request({ signal: controller.signal }))).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});
