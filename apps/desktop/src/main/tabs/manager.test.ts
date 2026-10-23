import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

interface MockView {
  webContents: EventEmitter & { loadURL: Mock; reload: Mock; stop: Mock };
  setVisible: Mock;
  setBounds: Mock;
}

const mocks = vi.hoisted(() => ({ views: [] as MockView[], record: vi.fn() }));

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class WebContents extends EventEmitter {
    loadURL = vi.fn(async () => {});
    reload = vi.fn();
    executeJavaScript = vi.fn(async () => {});
    getURL = () => 'about:blank';
    stop = vi.fn();
    close = vi.fn();
    isDestroyed = () => false;
    setWindowOpenHandler = vi.fn();
    navigationHistory = { canGoBack: () => false, canGoForward: () => false, goBack: vi.fn(), goForward: vi.fn() };
  }
  return {
    app: { isPackaged: true },
    clipboard: { writeText: vi.fn() },
    Menu: class {},
    MenuItem: class {},
    WebContentsView: class {
      webContents = new WebContents();
      setVisible = vi.fn();
      setBounds = vi.fn();
      constructor() { mocks.views.push(this); }
    },
  };
});
vi.mock('../storage/history.js', () => ({ historyStore: { record: mocks.record } }));
vi.mock('../storage/settings.js', () => ({ getSettings: () => ({ homepageUrl: 'about:blank' }) }));
vi.mock('../agent/browser/browsing-cloud.js', () => ({ browsingCloudScript: () => '' }));
vi.mock('../agent/browser/net-activity.js', () => ({ trackNetwork: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.views.length = 0;
});

async function createManager() {
  const { tabManager } = await import('./manager.js');
  const win = Object.assign(new EventEmitter(), {
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    getContentSize: () => [1280, 800],
    webContents: { send: vi.fn() },
  });
  tabManager.attachWindow(win as unknown as BrowserWindow);
  const tab = await tabManager.create();
  return { manager: tabManager, id: tab.id, view: mocks.views[0]!, win };
}

function start(view: MockView, url: string) {
  view.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url });
}

function fail(view: MockView, url: string, code = -102, mainFrame = true) {
  view.webContents.emit('did-fail-load', {}, code, 'ERR_CONNECTION_REFUSED', url, mainFrame);
}

describe('native browsing navigation recovery', () => {
  it('refuses prohibited direct destinations before creating a view or loading a page', async () => {
    const { manager, id, view } = await createManager();
    const loads = view.webContents.loadURL.mock.calls.length;
    for (const url of ['https://duckduckgo.com/?q=private', 'https://html.duckduckgo.com/', 'https://duck.com/', 'https://ddg.gg/']) {
      await expect(manager.create(url)).rejects.toThrow('blocked by BulleBrowser policy');
      await expect(manager.navigate(id, url)).rejects.toThrow('blocked by BulleBrowser policy');
    }
    expect(mocks.views).toHaveLength(1);
    expect(view.webContents.loadURL).toHaveBeenCalledTimes(loads);
    expect(manager.list()[0]?.url).toBe('about:blank');
  });

  it('prevents page navigations and redirects and exposes the blocked outcome', async () => {
    const { manager, id, view } = await createManager();
    const url = 'https://DUCKDUCKGO.COM./?q=private';
    const event = { preventDefault: vi.fn() };
    view.webContents.emit('will-navigate', event, url);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(manager.list()[0]?.loadError?.message).toContain('blocked by BulleBrowser policy');
    expect(manager.getNavigationUrl(id)).toBe(url);
    await expect(manager.reload(id)).rejects.toThrow('blocked by BulleBrowser policy');
    await manager.navigate(id, 'https://agency.gov/');
    expect(manager.list()[0]?.loadError).toBeUndefined();
    const redirect = { preventDefault: vi.fn() };
    view.webContents.emit('will-redirect', redirect, 'https://ddg.gg/', false, true);
    expect(redirect.preventDefault).toHaveBeenCalledOnce();
    expect(manager.getNavigationUrl(id)).toBe('https://ddg.gg/');
  });

  it('blocks prohibited subframes without marking the allowed parent page as failed', async () => {
    const { manager, view } = await createManager();
    const event = { preventDefault: vi.fn(), url: 'https://links.duckduckgo.com/', isMainFrame: false };
    view.webContents.emit('will-frame-navigate', event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(manager.list()[0]?.loadError).toBeUndefined();
  });

  it('lets an allowed navigation recover while an older prohibited load finishes failing', async () => {
    const { manager, id, view } = await createManager();
    const blocked = 'https://duckduckgo.com/?q=private';
    start(view, blocked);
    expect(manager.list()[0]?.loadError).toBeDefined();
    // Session policy cancels that load; a separate stop would race this one.
    expect(view.webContents.stop).not.toHaveBeenCalled();
    await manager.navigate(id, 'https://agency.gov/');
    fail(view, blocked, -20);
    expect(manager.list()[0]).toMatchObject({ url: 'https://agency.gov/', loading: true });
    expect(manager.list()[0]?.loadError).toBeUndefined();
    expect(manager.getNavigationUrl(id)).toBe('https://agency.gov/');
  });

  it('shows the native view and attempted address as soon as a blank tab starts browsing', async () => {
    const { manager, id, view } = await createManager();
    expect(view.setVisible).toHaveBeenLastCalledWith(false);
    await manager.navigate(id, 'https://example.com/');
    expect(manager.list()[0]).toMatchObject({ url: 'https://example.com/', loading: true });
    expect(view.setVisible).toHaveBeenLastCalledWith(true);
  });

  it('keeps pages hidden through navigation and tab switches while a dialog is open', async () => {
    const { manager, id, view, win } = await createManager();
    await manager.navigate(id, 'https://example.com/');
    manager.setBounds({ topInset: 80, rightInset: 440, modalOpen: true });
    expect(view.setVisible).toHaveBeenLastCalledWith(false);
    start(view, 'https://example.com/next');
    win.emit('resize');
    expect(view.setVisible).toHaveBeenLastCalledWith(false);
    await manager.create('https://example.org/');
    const other = mocks.views[1]!;
    expect(other.setVisible).toHaveBeenLastCalledWith(false);
    manager.setBounds({ topInset: 80, rightInset: 440, modalOpen: false });
    expect(other.setVisible).toHaveBeenLastCalledWith(true);
    expect(view.setVisible).toHaveBeenLastCalledWith(false);
  });

  it('retains a failed first address across Chromium’s old blank commit and recovers through Reload', async () => {
    const { manager, id, view } = await createManager();
    const url = 'http://127.0.0.1:12345/missing';
    start(view, url);
    view.webContents.emit('did-navigate', {}, 'about:blank', -1, '');
    fail(view, url);
    expect(manager.list()[0]).toMatchObject({ url, loading: false, loadError: { code: -102 } });
    expect(view.setVisible).toHaveBeenLastCalledWith(false);
    expect(mocks.record).not.toHaveBeenCalled();
    await manager.reload(id);
    expect(view.webContents.loadURL).toHaveBeenLastCalledWith(url);
    expect(manager.list()[0]?.loadError).toBeUndefined();
    expect(view.setVisible).toHaveBeenLastCalledWith(true);
    start(view, url);
    view.webContents.emit('did-navigate', {}, url, 200, 'OK');
    view.webContents.emit('did-stop-loading');
    expect(manager.list()[0]).toMatchObject({ url, loading: false });
    expect(manager.list()[0]?.loadError).toBeUndefined();
  });

  it('does not replace the main page for cancelled loads, subframe errors or iframe hash navigation', async () => {
    const { manager, view } = await createManager();
    const url = 'https://example.com/';
    start(view, url);
    fail(view, url, -3);
    fail(view, 'https://embedded.example/frame', -102, false);
    view.webContents.emit('did-navigate-in-page', {}, 'https://embedded.example/frame#child', false);
    expect(manager.list()[0]).toMatchObject({ url, loading: true });
    expect(manager.list()[0]?.loadError).toBeUndefined();
    expect(view.setVisible).toHaveBeenLastCalledWith(true);
  });

  it('ignores a late failure from an address the user has already replaced', async () => {
    const { manager, id, view } = await createManager();
    await manager.navigate(id, 'https://old.example/');
    await manager.navigate(id, 'https://current.example/');
    fail(view, 'https://old.example/');
    expect(manager.list()[0]).toMatchObject({ url: 'https://current.example/', loading: true });
    expect(manager.list()[0]?.loadError).toBeUndefined();
    expect(view.setVisible).toHaveBeenLastCalledWith(true);
  });

  it('reports failures at the redirected address without bypassing certificate checks', async () => {
    const { manager, view } = await createManager();
    start(view, 'https://example.com/');
    const url = 'https://secure.example/';
    view.webContents.emit('did-redirect-navigation', { isMainFrame: true, url });
    fail(view, url, -202);
    expect(manager.list()[0]).toMatchObject({ url, loadError: { code: -202, message: expect.stringContaining('secure connection') } });
    expect(view.setVisible).toHaveBeenLastCalledWith(false);
  });

  it('keeps another active page visible when a background tab fails', async () => {
    const { manager, id, view } = await createManager();
    start(view, 'https://first.example/');
    const other = await manager.create('https://second.example/');
    const otherView = mocks.views[1]!;
    start(otherView, 'https://second.example/');
    fail(view, 'https://first.example/');
    expect(manager.getActiveId()).toBe(other.id);
    expect(otherView.setVisible).toHaveBeenLastCalledWith(true);
    manager.activate(id);
    expect(view.setVisible).toHaveBeenLastCalledWith(false);
    expect(manager.list().find((tab) => tab.id === id)?.loadError).toBeDefined();
  });
});
