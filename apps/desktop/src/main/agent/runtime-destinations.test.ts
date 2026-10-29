import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  url: 'https://agency.gov/', navigationUrl: 'https://agency.gov/',
  execute: vi.fn(), capture: vi.fn(), load: vi.fn(), activate: vi.fn(),
  getView: vi.fn(), send: vi.fn(), preconnect: vi.fn(),
}));
vi.mock('../tabs/manager.js', () => ({ tabManager: {
  getView: mocks.getView,
  getNavigationUrl: () => mocks.navigationUrl,
  activate: mocks.activate,
} }));
vi.mock('../storage/settings.js', () => ({ getSettings: () => ({}) }));
vi.mock('../storage/site-permissions.js', () => ({ originOf: vi.fn(), sitePermissions: { level: vi.fn(), set: vi.fn() } }));
import { DesktopToolRuntime } from './runtime.js';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.url = 'https://agency.gov/';
  mocks.navigationUrl = mocks.url;
  const mainFrame = {
    get url() { return mocks.url; },
    framesInSubtree: [], executeJavaScript: mocks.execute,
  };
  mocks.getView.mockReturnValue({ webContents: {
    isDestroyed: () => false, getURL: () => mocks.url,
    getTitle: () => 'Source', on: vi.fn(), off: vi.fn(), once: vi.fn(), focus: vi.fn(),
    mainFrame,
    session: { preconnect: mocks.preconnect, webRequest: { onBeforeRequest: vi.fn(), onCompleted: vi.fn(), onErrorOccurred: vi.fn() } },
    debugger: { isAttached: () => true, sendCommand: mocks.send },
    executeJavaScript: mocks.execute, capturePage: mocks.capture, loadURL: mocks.load,
  } });
});

it('recovers from a blocked attempted destination without reading or presenting it', async () => {
  mocks.navigationUrl = 'https://\u0064uckduckgo.com/';
  const onActivity = vi.fn();
  const runtime = new DesktopToolRuntime({ request: vi.fn() }, onActivity);
  await runtime.presentAction('tab', 'navigate', new AbortController().signal);
  expect(mocks.execute).not.toHaveBeenCalled();
  expect(onActivity).not.toHaveBeenCalled();
  mocks.load.mockImplementation(async (url: string) => {
    expect(mocks.execute).not.toHaveBeenCalled();
    mocks.navigationUrl = url;
    mocks.url = url;
  });
  mocks.execute.mockResolvedValue(undefined);
  await expect(runtime.navigate('tab', 'https://agency.gov/grants', { wait: 'none' })).resolves.toMatchObject({ url: 'https://agency.gov/grants' });
  expect(mocks.load).toHaveBeenCalledExactlyOnceWith('https://agency.gov/grants');
  expect(mocks.preconnect).toHaveBeenCalledExactlyOnceWith({ url: 'https://agency.gov', numSockets: 1 });
  expect(onActivity).toHaveBeenCalledExactlyOnceWith('tab');
});

it('rejects blocked navigation before touching the current page or presenting activity', async () => {
  const onActivity = vi.fn();
  const runtime = new DesktopToolRuntime({ request: vi.fn() }, onActivity);
  await expect(runtime.navigate('tab', 'https://\u0064uckduckgo.com/?q=private')).rejects.toThrow('blocked by BulleBrowser policy');
  expect(mocks.getView).not.toHaveBeenCalled();
  expect(mocks.preconnect).not.toHaveBeenCalled();
  expect(mocks.load).not.toHaveBeenCalled();
  expect(onActivity).not.toHaveBeenCalled();
});

it('refuses reading, screenshots and actions on a prohibited existing page', async () => {
  mocks.url = 'https://html.\u0064uckduckgo.com/';
  mocks.navigationUrl = mocks.url;
  const onActivity = vi.fn();
  const runtime = new DesktopToolRuntime({ request: vi.fn() }, onActivity);
  for (const call of [
    () => runtime.readPage('tab'), () => runtime.screenshot('tab'),
    () => runtime.click('tab', 'link'), () => runtime.type('tab', 'search', 'private'),
    () => runtime.listLinks('tab'), () => runtime.switchTab('tab'),
  ]) await expect(call()).rejects.toThrow('blocked by BulleBrowser policy');
  expect(mocks.execute).not.toHaveBeenCalled();
  expect(mocks.capture).not.toHaveBeenCalled();
  expect(mocks.activate).not.toHaveBeenCalled();
  expect(onActivity).not.toHaveBeenCalled();
});

it('does not read the old document when a blocked redirect left it behind', async () => {
  mocks.navigationUrl = 'https://ddg.gg/';
  const runtime = new DesktopToolRuntime({ request: vi.fn() });
  await expect(runtime.readPage('tab')).rejects.toThrow('blocked by BulleBrowser policy');
  expect(mocks.execute).not.toHaveBeenCalled();
});

it.each(['click', 'Enter'] as const)('reports a prevented %s navigation as a policy error while the old URL remains loaded', async (action) => {
  const runtime = new DesktopToolRuntime({ request: vi.fn() });
  const blocked = 'https://\u0064uckduckgo.com/?q=private';
  mocks.execute.mockResolvedValue({ ok: true, value: { matched: 'Search', onTop: true, x: 5, y: 5, ref: '@1' } });
  mocks.send.mockImplementation(async (_method: string, params: { type: string }) => {
    if (params.type === 'mouseReleased' || params.type === 'keyDown') mocks.navigationUrl = blocked;
  });
  vi.useFakeTimers();
  try {
    const result = expect(action === 'click'
      ? runtime.click('tab', 'Search', { wait: 'none' })
      : runtime.pressKey('tab', 'Enter')).rejects.toMatchObject({ code: 'BLOCKED_BY_POLICY' });
    await vi.runAllTimersAsync();
    await result;
    expect(mocks.navigationUrl).toBe(blocked);
    expect(mocks.url).toBe('https://agency.gov/');
  } finally {
    vi.useRealTimers();
  }
});

it('filters prohibited link destinations from discovery on allowed pages', async () => {
  mocks.execute.mockResolvedValue([
    { text: 'blocked', href: 'https://\u0064uckduckgo.com/?q=grants' },
    { text: 'source', href: 'https://agency.gov/grants' },
  ]);
  const runtime = new DesktopToolRuntime({ request: vi.fn() });
  await expect(runtime.listLinks('tab')).resolves.toEqual([{ text: 'source', href: 'https://agency.gov/grants' }]);
});
