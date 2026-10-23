import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  url: 'https://example.com/form',
  level: vi.fn(() => 'click'),
  set: vi.fn(),
}));
vi.mock('../tabs/manager.js', () => ({ tabManager: {
  getView: () => ({ webContents: { isDestroyed: () => false, getURL: () => mocks.url } }),
} }));
vi.mock('../storage/settings.js', () => ({ getSettings: () => ({}) }));
vi.mock('../storage/site-permissions.js', () => ({
  originOf: (url: string) => new URL(url).origin,
  sitePermissions: { level: mocks.level, set: mocks.set },
}));

import { DesktopToolRuntime } from './runtime.js';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.url = 'https://example.com/form';
});

describe('site action permissions', () => {
  it('prompts through the existing confirmation channel and scopes approval to this task and origin', async () => {
    const request = vi.fn(async () => true);
    const runtime = new DesktopToolRuntime({ request });
    const ask = { action: 'type in Name' };
    expect(await runtime.checkPermission('tab', 'type', ask)).toBe('granted');
    expect(request).toHaveBeenCalledWith('Allow type in Name on https://example.com for this task?', undefined);
    expect(await runtime.checkPermission('tab', 'type', ask)).toBe('granted');
    expect(request).toHaveBeenCalledTimes(1);
    mocks.url = 'https://other.example/form';
    await runtime.checkPermission('tab', 'type', ask);
    expect(request).toHaveBeenCalledTimes(2);
    await new DesktopToolRuntime({ request }).checkPermission('tab', 'type', ask);
    expect(request).toHaveBeenCalledTimes(3);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it('denies declined actions without granting subsequent access', async () => {
    const request = vi.fn(async () => false);
    const runtime = new DesktopToolRuntime({ request });
    expect(await runtime.checkPermission('tab', 'full', { action: 'submit' })).toBe('denied');
    expect(await runtime.checkPermission('tab', 'full', { action: 'submit' })).toBe('denied');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('shows the submission preview and confirms only the approved action', async () => {
    const request = vi.fn(async () => true);
    const runtime = new DesktopToolRuntime({ request });
    const preview = { summary: 'Submit application', fields: [{ label: 'Name', value: 'Ada' }] };
    expect(await runtime.checkPermission('tab', 'full', { action: 'submit', preview })).toBe('confirmed');
    expect(request).toHaveBeenCalledWith(expect.any(String), preview);
    expect(await runtime.checkPermission('tab', 'full', { action: 'submit again', preview })).toBe('granted');
    await runtime.confirmDestructive('Submit again?', preview);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith('Submit again?', preview);
  });
});
