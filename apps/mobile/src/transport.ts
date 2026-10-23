import type { NativeMobile } from './native';

/** The key never enters the browser page or JS model request. Native owns endpoint and auth. */
export function nativeModelFetch(native: NativeMobile): typeof fetch {
  return async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const provider =
      url.origin === 'https://api.anthropic.com' && url.pathname === '/v1/messages'
        ? 'anthropic'
        : url.origin === 'https://api.openai.com' && url.pathname === '/v1/chat/completions'
          ? 'openai'
          : null;
    if (
      !provider ||
      url.username ||
      url.password ||
      url.search ||
      init?.method !== 'POST' ||
      typeof init.body !== 'string'
    )
      throw new Error('Unsupported native model request.');
    const requestId = crypto.randomUUID();
    const signal = init.signal;
    signal?.throwIfAborted();
    let abortReject: ((reason: unknown) => void) | undefined;
    const abort = () => {
      void native.cancelModel({ requestId });
      abortReject?.(new DOMException('Task stopped', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const result = await Promise.race([
        native.requestModel({ provider, body: init.body, requestId }),
        new Promise<never>((_resolve, reject) => {
          abortReject = reject;
        }),
      ]);
      signal?.throwIfAborted();
      return new Response(result.body, {
        status: result.status,
        headers: { 'content-type': 'application/json' },
      });
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  };
}
