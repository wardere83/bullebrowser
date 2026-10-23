import { describe, expect, it } from 'vitest';
import { parseAddressBarInput } from './url.js';

describe('address bar navigation', () => {
  it.each([
    ['example.org?funding=1', 'https://example.org/?funding=1'],
    ['www.example.org#grants', 'https://www.example.org/#grants'],
    ['example.org:8443/app?q=grant#results', 'https://example.org:8443/app?q=grant#results'],
    ['localhost:4321?funding=1', 'http://localhost:4321/?funding=1'],
    ['127.0.0.1:4321/page', 'http://127.0.0.1:4321/page'],
    ['[::1]:4321/page', 'http://[::1]:4321/page'],
    ['bücher.example/grants', 'https://xn--bcher-kva.example/grants'],
  ])('navigates the whole address %s rather than dispatching a chat task', (input, url) => {
    expect(parseAddressBarInput(input)).toEqual({ type: 'url', url });
  });

  it.each(['localhost grants', 'localhostish', '999.999.999.999', 'example.org:99999'])('does not turn invalid address %s into an HTTP request', (input) => {
    expect(parseAddressBarInput(input)).toEqual({ type: 'agent', prompt: input });
  });

  it('preserves explicit URLs and the selected search or assistant behavior', () => {
    expect(parseAddressBarInput('https://example.org/path?q=1')).toEqual({ type: 'url', url: 'https://example.org/path?q=1' });
    expect(parseAddressBarInput('open example.org')).toEqual({ type: 'agent', prompt: 'open example.org' });
    expect(parseAddressBarInput('funding for CBOs', 'google')).toEqual({ type: 'url', url: 'https://www.google.com/search?q=funding%20for%20CBOs' });
    expect(parseAddressBarInput('funding for CBOs', 'bing')).toEqual({ type: 'url', url: 'https://www.bing.com/search?q=funding%20for%20CBOs' });
  });
});
