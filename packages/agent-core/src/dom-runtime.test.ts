import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDomToolRuntime } from './dom-runtime.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function field(attributes: Record<string, string>) {
  return {
    tagName: 'INPUT',
    value: '',
    isContentEditable: false,
    outerHTML: '<input>',
    getAttribute: (name: string) => attributes[name] ?? null,
    scrollIntoView: vi.fn(),
    focus: vi.fn(),
    dispatchEvent: vi.fn(),
  };
}

function stubPage(element: unknown, bodyText = '') {
  vi.stubGlobal('location', { href: 'https://crm.example.com/contacts' });
  vi.stubGlobal('document', {
    body: { innerText: bodyText },
    querySelectorAll: (selector: string) => (selector === '*' || !element ? [] : [element]),
  });
  vi.stubGlobal('HTMLInputElement', class {});
  vi.stubGlobal('HTMLTextAreaElement', class {});
  vi.stubGlobal('Event', class { constructor(public type: string) {} });
}

// The embedded widget's runtime typed into any field a selector named. The
// policy only reads the words of the target, and \"#field-2\" has none, so a
// password or card number could be typed by the agent there.
describe('embedded widget typing', () => {
  it.each([
    [{ type: 'password' }],
    [{ type: 'PASSWORD' }],
    [{ type: 'text', autocomplete: 'cc-number' }],
    [{ type: 'text', autocomplete: 'one-time-code' }],
    [{ type: 'text', autocomplete: 'current-password' }],
  ])('refuses a sensitive field named by selector: %o', async (attributes) => {
    const input = field(attributes);
    stubPage(input);
    await expect(createDomToolRuntime().type('page', '#field-2', 'hunter2')).rejects.toMatchObject({
      code: 'BLOCKED_BY_POLICY',
    });
    expect(input.focus).not.toHaveBeenCalled();
    expect(input.value).toBe('');
  });

  it('still types into an ordinary field', async () => {
    vi.useFakeTimers();
    const input = field({ type: 'search' });
    stubPage(input);
    const typing = createDomToolRuntime().type('page', '#field-2', 'ab');
    await vi.runAllTimersAsync();
    await expect(typing).resolves.toEqual({ matched: '<input>' });
    expect(input.value).toBe('ab');
  });
});

// wait_for with only `text` paused and then reported a match without looking.
describe('embedded widget wait_for text', () => {
  it('reports no match when the text never appears', async () => {
    vi.useFakeTimers();
    stubPage(null, 'Loading contacts');
    const waiting = createDomToolRuntime().waitFor('page', { text: 'Saved', timeoutMs: 1_000 });
    await vi.runAllTimersAsync();
    await expect(waiting).resolves.toEqual({ matched: false });
  });

  it('reports a match once the text is on the page, in any case', async () => {
    stubPage(null, 'Contact SAVED successfully');
    await expect(createDomToolRuntime().waitFor('page', { text: 'saved', timeoutMs: 1_000 })).resolves.toEqual({
      matched: true,
    });
  });
});
