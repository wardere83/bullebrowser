import { describe, expect, it, vi } from 'vitest';
import { nativeModelFetch } from './transport';
import type { NativeMobile } from './native';

describe('native assistant transport', () => {
  it('forwards model body only; never passes JS authorization headers to a page', async () => {
    const requestModel = vi.fn(async () => ({ status: 200, body: '{"ok":true}' }));
    const native = { requestModel } as unknown as NativeMobile;
    const response = await nativeModelFetch(native)('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': 'must-not-forward' },
      body: '{"model":"test"}',
    });
    expect(await response.json()).toEqual({ ok: true });
    expect(requestModel).toHaveBeenCalledWith({
      provider: 'anthropic',
      body: '{"model":"test"}',
      requestId: expect.any(String),
    });
    expect(JSON.stringify(requestModel.mock.calls)).not.toContain('must-not-forward');
  });
  it('rejects redirects, arbitrary endpoints and URL credentials before native transport', async () => {
    const requestModel = vi.fn();
    const fetch = nativeModelFetch({ requestModel } as unknown as NativeMobile);
    for (const url of [
      'https://evil.com/v1/messages',
      'https://api.anthropic.com.evil.com/v1/messages',
      'http://api.anthropic.com/v1/messages',
      'https://api.anthropic.com/v1/messages?destination=evil',
      'https://key@api.openai.com/v1/chat/completions',
    ]) {
      await expect(fetch(url, { method: 'POST', body: '{}' })).rejects.toThrow();
    }
    expect(requestModel).not.toHaveBeenCalled();
  });
  it('aborts immediately and asks native to cancel its in-flight request', async () => {
    const abort = new AbortController();
    const native = {
      requestModel: vi.fn(() => new Promise(() => {})),
      cancelModel: vi.fn(async () => {}),
    };
    const result = nativeModelFetch(native as unknown as NativeMobile)(
      'https://api.openai.com/v1/chat/completions',
      { method: 'POST', body: '{}', signal: abort.signal },
    );
    abort.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(native.cancelModel).toHaveBeenCalledWith({ requestId: expect.any(String) });
  });
  it('never dispatches a request after Stop', async () => {
    const abort = new AbortController();
    abort.abort();
    const requestModel = vi.fn();
    await expect(
      nativeModelFetch({ requestModel } as unknown as NativeMobile)(
        'https://api.openai.com/v1/chat/completions',
        { method: 'POST', body: '{}', signal: abort.signal },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(requestModel).not.toHaveBeenCalled();
  });
});
