import { describe, expect, it } from 'vitest';
import { AGENT_PROMPT_EVENT, parseAddressBarInput, sendAgentPrompt, takePendingAgentPrompts } from './url.js';

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

describe('handing a prompt to the AI panel', () => {
  it('keeps a prompt sent while the panel is closed until the panel takes it', () => {
    takePendingAgentPrompts();
    // The address bar opens a closed panel and sends in the same tick, before
    // the panel has mounted and started listening. That prompt was dropped.
    const target = new EventTarget();
    sendAgentPrompt('find arts grants in Ohio', target);
    sendAgentPrompt('summarise this page', target);
    expect(takePendingAgentPrompts()).toEqual(['find arts grants in Ohio', 'summarise this page']);
    expect(takePendingAgentPrompts()).toEqual([]);
  });

  it('does not keep a prompt the open panel took', () => {
    takePendingAgentPrompts();
    const target = new EventTarget();
    const received: string[] = [];
    target.addEventListener(AGENT_PROMPT_EVENT, (event) => {
      received.push((event as CustomEvent<string>).detail);
      event.preventDefault();
    });
    sendAgentPrompt('compare these funders', target);
    expect(received).toEqual(['compare these funders']);
    expect(takePendingAgentPrompts()).toEqual([]);
  });
});
