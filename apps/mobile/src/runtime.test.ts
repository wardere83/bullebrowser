import { describe, expect, it, vi } from 'vitest';
import { MobileRuntime } from './runtime';
import type { NativeMobile } from './native';

describe('mobile action authority', () => {
  it('never dispatches navigation, typing, or history actions after Stop', async () => {
    const controller = new AbortController();
    controller.abort();
    const browser = vi.fn();
    const runtime = new MobileRuntime(
      { browser } as unknown as NativeMobile,
      async () => true,
      controller.signal,
      async () => {},
    );
    await expect(runtime.newTab()).rejects.toThrow();
    await expect(runtime.navigate('tab', 'https://example.com')).rejects.toThrow();
    await expect(runtime.type('tab', 'Name', 'Text')).rejects.toThrow();
    await expect(runtime.goBack('tab')).rejects.toThrow();
    expect(browser).not.toHaveBeenCalled();
  });
  it('requires separate exact-action approvals even after a previous approval', async () => {
    const ask = vi.fn(async () => true);
    const runtime = new MobileRuntime(
      {} as NativeMobile,
      ask,
      new AbortController().signal,
      async () => {},
    );
    expect(await runtime.checkPermission('tab', 'full', { action: 'Send message one' })).toBe(
      'confirmed',
    );
    expect(await runtime.checkPermission('tab', 'full', { action: 'Send message two' })).toBe(
      'confirmed',
    );
    expect(ask).toHaveBeenCalledTimes(2);
    ask.mockResolvedValue(false);
    expect(await runtime.checkPermission('tab', 'type', { action: 'Edit a field' })).toBe('denied');
  });
  it('reports inaccessible canvas editors instead of faking successful typing', async () => {
    const browser = vi.fn(async (input: { action: string }) =>
      input.action === 'list'
        ? {
            tabs: [{ id: 'tab', active: true, title: 'Editor', url: 'https://example.com/editor' }],
          }
        : input.action === 'switch'
          ? { tab: { id: 'tab' } }
          : { value: false },
    );
    const runtime = new MobileRuntime(
      { browser } as unknown as NativeMobile,
      async () => true,
      new AbortController().signal,
      async () => {},
    );
    await expect(runtime.type('tab', 'Editor', 'Do not pretend this was written')).rejects.toThrow(
      'requires manual input',
    );
    expect(browser.mock.calls.filter(([input]) => input.action === 'evaluate')).toHaveLength(1);
  });
});
