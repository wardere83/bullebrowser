import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import type { BrowserWindow } from 'electron';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

interface MockView {
  webContents: EventEmitter & {
    loadURL: Mock; reload: Mock; stop: Mock; getURL: Mock;
    executeJavaScript: Mock; setWindowOpenHandler: Mock;
    navigationHistory: { canGoBack: Mock; goBack: Mock };
  };
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
    getURL = vi.fn(() => 'about:blank');
    stop = vi.fn();
    close = vi.fn();
    isDestroyed = () => false;
    setWindowOpenHandler = vi.fn();
    navigationHistory = { canGoBack: vi.fn(() => false), canGoForward: () => false, goBack: vi.fn(), goForward: vi.fn() };
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
  it('shows direct policy refusals without creating a view or loading a page, then recovers', async () => {
    const { manager, id, view, win } = await createManager();
    const loads = view.webContents.loadURL.mock.calls.length;
    for (const url of ['https://duckduckgo.com/?q=private', 'https://html.duckduckgo.com/', 'https://duck.com/', 'https://ddg.gg/']) {
      await expect(manager.create(url)).rejects.toThrow('blocked by BulleBrowser policy');
      await expect(manager.navigate(id, url)).rejects.toThrow('blocked by BulleBrowser policy');
      expect(manager.list()[0]).toMatchObject({ url, loading: false, loadError: {
        code: -20, message: expect.stringContaining('blocked by BulleBrowser policy'),
      } });
      expect(manager.getNavigationUrl(id)).toBe(url);
      expect(view.setVisible).toHaveBeenLastCalledWith(false);
      expect(win.webContents.send).toHaveBeenLastCalledWith(expect.any(String), manager.list());
    }
    expect(mocks.views).toHaveLength(1);
    expect(view.webContents.loadURL).toHaveBeenCalledTimes(loads);
    await manager.navigate(id, 'https://agency.gov/');
    expect(manager.getNavigationUrl(id)).toBe('https://agency.gov/');
    expect(manager.list()[0]?.loadError).toBeUndefined();
    expect(view.setVisible).toHaveBeenLastCalledWith(true);
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

  it('records denied popup attempts on the originating tab without opening or loading another page', async () => {
    const { manager, id, view } = await createManager();
    const allowed = 'https://agency.gov/';
    await manager.navigate(id, allowed);
    view.webContents.getURL.mockReturnValue(allowed);
    const loads = view.webContents.loadURL.mock.calls.length;
    const open = view.webContents.setWindowOpenHandler.mock.calls[0]![0] as (details: { url: string }) => { action: string };
    const blocked = 'https://duckduckgo.com/?q=private';
    expect(open({ url: blocked })).toEqual({ action: 'deny' });
    expect(manager.getNavigationUrl(id)).toBe(blocked);
    expect(manager.list()).toHaveLength(1);
    expect(manager.list()[0]).toMatchObject({ id, url: blocked, canGoBack: true, loadError: { code: -20 } });
    expect(mocks.views).toHaveLength(1);
    expect(view.webContents.loadURL).toHaveBeenCalledTimes(loads);
    expect(view.webContents.getURL()).toBe(allowed);
    await manager.back(id);
    expect(manager.getNavigationUrl(id)).toBe(allowed);
    expect(manager.list()[0]?.loadError).toBeUndefined();
    expect(view.webContents.loadURL).toHaveBeenCalledTimes(loads);
  });

  it('still opens allowed popups as managed tabs without marking the originating page as blocked', async () => {
    const { manager, id, view } = await createManager();
    const allowed = 'https://agency.gov/';
    await manager.navigate(id, allowed);
    view.webContents.getURL.mockReturnValue(allowed);
    const open = view.webContents.setWindowOpenHandler.mock.calls[0]![0] as (details: { url: string }) => { action: string };
    expect(open({ url: 'https://agency.gov/grants' })).toEqual({ action: 'deny' });
    expect(manager.getNavigationUrl(id)).toBe(allowed);
    expect(manager.list().find((tab) => tab.id === id)?.loadError).toBeUndefined();
    expect(mocks.views).toHaveLength(2);
    expect(mocks.views[1]!.webContents.loadURL).toHaveBeenCalledExactlyOnceWith('https://agency.gov/grants');
    expect(manager.list()[1]).toMatchObject({ url: 'https://agency.gov/grants', active: true });
  });

  it('keeps a popup refusal through retained-page history and hash changes until Back recovery', async () => {
    const { manager, id, view } = await createManager();
    const allowed = 'https://agency.gov/grants';
    await manager.navigate(id, allowed);
    view.webContents.getURL.mockReturnValue(allowed);
    const open = view.webContents.setWindowOpenHandler.mock.calls[0]![0] as (details: { url: string }) => { action: string };
    const blocked = 'https://duckduckgo.com/?q=private';
    open({ url: blocked });
    const loads = view.webContents.loadURL.mock.calls.length;
    const updated = `${allowed}?tab=eligibility#requirements`;
    for (const url of [`${allowed}?tab=eligibility`, updated]) {
      view.webContents.getURL.mockReturnValue(url);
      view.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true, url });
      view.webContents.emit('did-navigate-in-page', {}, url, true);
      expect(manager.getNavigationUrl(id)).toBe(blocked);
      expect(manager.list()[0]).toMatchObject({ url: blocked, canGoBack: true, loadError: { code: -20 } });
      expect(view.setVisible).toHaveBeenLastCalledWith(false);
    }

    await manager.back(id);
    expect(manager.getNavigationUrl(id)).toBe(updated);
    expect(manager.list()[0]?.loadError).toBeUndefined();
    expect(view.setVisible).toHaveBeenLastCalledWith(true);
    expect(view.webContents.loadURL).toHaveBeenCalledTimes(loads);
    expect(view.webContents.navigationHistory.goBack).not.toHaveBeenCalled();
    const afterRecovery = `${allowed}?tab=eligibility#deadline`;
    view.webContents.getURL.mockReturnValue(afterRecovery);
    view.webContents.emit('did-navigate-in-page', {}, afterRecovery, true);
    expect(manager.getNavigationUrl(id)).toBe(afterRecovery);
    expect(manager.list()[0]?.url).toBe(afterRecovery);
  });

  it('accepts same-document updates after explicit allowed navigation clears a refusal', async () => {
    const { manager, id, view } = await createManager();
    view.webContents.getURL.mockReturnValue('https://agency.gov/');
    const open = view.webContents.setWindowOpenHandler.mock.calls[0]![0] as (details: { url: string }) => { action: string };
    open({ url: 'https://duckduckgo.com/' });
    const allowed = 'https://agency.gov/next';
    await manager.navigate(id, allowed);
    view.webContents.getURL.mockReturnValue(allowed);
    start(view, allowed);
    view.webContents.emit('did-navigate', {}, allowed, 200, 'OK');
    view.webContents.emit('did-stop-loading');
    const updated = `${allowed}#details`;
    view.webContents.getURL.mockReturnValue(updated);
    view.webContents.emit('did-navigate-in-page', {}, updated, true);
    expect(manager.getNavigationUrl(id)).toBe(updated);
    expect(manager.list()[0]).toMatchObject({ url: updated, loading: false });
    expect(manager.list()[0]?.loadError).toBeUndefined();
    expect(view.setVisible).toHaveBeenLastCalledWith(true);
  });

  it('clears retained browsing decoration when the run stopped while its policy error hid the document', async () => {
    const { manager, id, view } = await createManager();
    const allowed = 'https://agency.gov/';
    await manager.navigate(id, allowed);
    view.webContents.getURL.mockReturnValue(allowed);
    let decorated = true;
    const cloud = { remove: () => { decorated = false; }, toggleAttribute: vi.fn() };
    const page = { window: {}, document: { getElementById: () => decorated ? cloud : null } };
    view.webContents.executeJavaScript.mockImplementation(async (script: string) => runInNewContext(script, page));
    manager.setBrowsingActivity('run', id);
    expect(decorated).toBe(true);
    view.webContents.emit('will-navigate', { preventDefault: vi.fn() }, 'https://duckduckgo.com/');
    const scriptsBeforeStop = view.webContents.executeJavaScript.mock.calls.length;
    manager.clearBrowsingActivity('run');
    // Policy keeps the hidden document untouched until explicit recovery.
    expect(view.webContents.executeJavaScript).toHaveBeenCalledTimes(scriptsBeforeStop);
    expect(decorated).toBe(true);
    await manager.back(id);
    expect(manager.getNavigationUrl(id)).toBe(allowed);
    expect(decorated).toBe(false);
  });

  it.each([false, true])('restores the retained allowed page without loading or traversing history (native back: %s)', async (nativeBack) => {
    const { manager, id, view, win } = await createManager();
    const allowed = 'https://agency.gov/grants';
    await manager.navigate(id, allowed);
    view.webContents.getURL.mockReturnValue(allowed);
    view.webContents.emit('did-navigate', {}, allowed, 200, 'OK');
    view.webContents.emit('did-stop-loading');
    view.webContents.navigationHistory.canGoBack.mockReturnValue(nativeBack);
    expect(manager.list()[0]?.canGoBack).toBe(nativeBack);
    const loads = view.webContents.loadURL.mock.calls.length;
    const blocked = 'https://duckduckgo.com/?q=private';
    view.webContents.emit('will-navigate', { preventDefault: vi.fn() }, blocked);
    expect(manager.list()[0]).toMatchObject({ url: blocked, canGoBack: true, loadError: { code: -20 } });
    expect(view.setVisible).toHaveBeenLastCalledWith(false);

    await manager.back(id);
    expect(manager.list()[0]).toMatchObject({ url: allowed, loading: false, canGoBack: nativeBack });
    expect(manager.list()[0]?.loadError).toBeUndefined();
    expect(manager.getNavigationUrl(id)).toBe(allowed);
    expect(view.setVisible).toHaveBeenLastCalledWith(true);
    expect(win.webContents.send).toHaveBeenLastCalledWith(expect.any(String), manager.list());
    expect(view.webContents.loadURL).toHaveBeenCalledTimes(loads);
    expect(view.webContents.navigationHistory.goBack).not.toHaveBeenCalled();
    expect(mocks.record).toHaveBeenCalledTimes(1);

    fail(view, blocked, -20);
    expect(manager.list()[0]?.loadError).toBeUndefined();
    expect(manager.getNavigationUrl(id)).toBe(allowed);
  });

  it.each(['about:blank', 'https://duck.com/', 'file:///private/document.html', 'chrome-error://chromewebdata/'])('does not restore an unsafe retained document: %s', async (retainedUrl) => {
    const { manager, id, view } = await createManager();
    view.webContents.getURL.mockReturnValue(retainedUrl);
    const blocked = 'https://duckduckgo.com/';
    view.webContents.emit('will-navigate', { preventDefault: vi.fn() }, blocked);
    expect(manager.list()[0]?.canGoBack).toBe(false);
    const loads = view.webContents.loadURL.mock.calls.length;
    await manager.back(id);
    expect(manager.list()[0]).toMatchObject({ url: blocked, loadError: { code: -20 } });
    expect(view.setVisible).toHaveBeenLastCalledWith(false);
    expect(view.webContents.loadURL).toHaveBeenCalledTimes(loads);
    expect(view.webContents.navigationHistory.goBack).not.toHaveBeenCalled();
  });

  it('revalidates a retained document before restoring it', async () => {
    const { manager, id, view } = await createManager();
    view.webContents.getURL.mockReturnValue('https://agency.gov/');
    const blocked = 'https://duckduckgo.com/';
    view.webContents.emit('will-navigate', { preventDefault: vi.fn() }, blocked);
    expect(manager.list()[0]?.canGoBack).toBe(true);
    view.webContents.getURL.mockReturnValue('https://ddg.gg/');
    await manager.back(id);
    expect(manager.list()[0]).toMatchObject({ url: blocked, canGoBack: false, loadError: { code: -20 } });
    expect(view.setVisible).toHaveBeenLastCalledWith(false);
    expect(view.webContents.navigationHistory.goBack).not.toHaveBeenCalled();
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
