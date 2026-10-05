import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { app, updater, nativeUpdater } = vi.hoisted(() => ({
  app: { isPackaged: true },
  nativeUpdater: { on: vi.fn(), listeners: vi.fn(), removeListener: vi.fn(), checkForUpdates: vi.fn() },
  updater: {
    currentVersion: { compare: vi.fn() },
    autoDownload: false,
    autoInstallOnAppQuit: false,
    autoRunAppAfterInstall: false,
    allowDowngrade: true,
    on: vi.fn(),
    removeListener: vi.fn(),
    checkForUpdates: vi.fn(),
    quitAndInstall: vi.fn(),
  },
}));
vi.mock('electron', () => ({ app, autoUpdater: nativeUpdater }));
vi.mock('electron-updater', () => ({ default: { autoUpdater: updater } }));

let events: EventEmitter;
let nativeEvents: EventEmitter;
let win: EventEmitter & { isDestroyed: () => boolean; webContents: { send: ReturnType<typeof vi.fn> } };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  app.isPackaged = true;
  events = new EventEmitter();
  nativeEvents = new EventEmitter();
  nativeUpdater.on.mockImplementation((event, callback) => nativeEvents.on(event, callback));
  nativeUpdater.listeners.mockImplementation((event) => nativeEvents.listeners(event));
  nativeUpdater.removeListener.mockImplementation((event, callback) => nativeEvents.removeListener(event, callback));
  nativeUpdater.checkForUpdates.mockReset();
  updater.on.mockImplementation((event, callback) => events.on(event, callback));
  updater.removeListener.mockImplementation((event, callback) => events.removeListener(event, callback));
  updater.checkForUpdates.mockResolvedValue(null);
  updater.quitAndInstall.mockReset();
  updater.autoRunAppAfterInstall = false;
  // Installed: 0.2.37. Delegate real semver comparison to electron-updater in production.
  updater.currentVersion.compare.mockImplementation((version: string) => {
    if (version === '0.2.37') return 0;
    if (version === '0.2.36') return 1;
    if (version === '0.2.38' || version === '0.2.39') return -1;
    throw new Error('Invalid version');
  });
  win = Object.assign(new EventEmitter(), { isDestroyed: () => false, webContents: { send: vi.fn() } });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  win.emit('closed');
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function start() {
  const api = await import('./updater.js');
  api.setupAutoUpdate(win as unknown as BrowserWindow);
  return api;
}

describe('in-app updates', () => {
  it('downloads newer releases and installs only after the ready action', async () => {
    const api = await start();
    expect(updater.autoDownload).toBe(true);
    expect(updater.allowDowngrade).toBe(false);
    expect(updater.autoRunAppAfterInstall).toBe(true);
    api.quitAndInstallUpdate();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    events.emit('update-available', { version: '0.2.38' });
    expect(api.getUpdateStatus()).toEqual({ state: 'downloading', version: '0.2.38' });
    api.quitAndInstallUpdate();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    events.emit('update-downloaded', { version: '0.2.38' });
    expect(api.getUpdateStatus()).toEqual({ state: 'ready', version: '0.2.38' });
    api.quitAndInstallUpdate();
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true);
    expect(api.getUpdateStatus()).toEqual({ state: 'idle' });
  });

  it('requests one restart while macOS finishes staging the downloaded update', async () => {
    const api = await start();
    events.emit('update-downloaded', { version: '0.2.38' });
    api.quitAndInstallUpdate();
    win.webContents.send.mockClear();
    events.emit('update-downloaded', { version: '0.2.38' });
    api.quitAndInstallUpdate();
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
    // A repeated ready event must not re-enable the button during installation.
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it('starts installation synchronously and suppresses stale events and status reads until it finishes', async () => {
    const api = await start();
    events.emit('update-downloaded', { version: '0.2.38' });
    updater.quitAndInstall.mockImplementation(() => {
      expect(api.getUpdateStatus()).toEqual({ state: 'idle' });
    });
    win.webContents.send.mockClear();
    api.quitAndInstallUpdate();
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
    events.emit('update-not-available');
    events.emit('update-available', { version: '0.2.39' });
    events.emit('update-downloaded', { version: '0.2.39' });
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
    expect(api.getUpdateStatus()).toEqual({ state: 'idle' });
    expect(win.webContents.send).not.toHaveBeenCalled();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    api.quitAndInstallUpdate();
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);

    events.emit('error', new Error('Installer could not start'));
    expect(api.getUpdateStatus()).toEqual({ state: 'ready', version: '0.2.38' });
    expect(win.webContents.send).toHaveBeenCalledWith('update:status', { state: 'ready', version: '0.2.38' });
  });

  it('restores the ready action when installation emits an error before shutdown', async () => {
    const api = await start();
    events.emit('update-downloaded', { version: '0.2.38' });
    api.quitAndInstallUpdate();
    win.webContents.send.mockClear();
    events.emit('error', new Error('Cannot stage installer'));
    expect(win.webContents.send).toHaveBeenCalledWith('update:status', { state: 'ready', version: '0.2.38' });
    api.quitAndInstallUpdate();
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(2);
  });

  it('allows retry when the native install request throws', async () => {
    const api = await start();
    events.emit('update-downloaded', { version: '0.2.38' });
    updater.quitAndInstall.mockImplementationOnce(() => { throw new Error('Installer unavailable'); });
    expect(() => api.quitAndInstallUpdate()).toThrow('Installer unavailable');
    api.quitAndInstallUpdate();
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(2);
  });

  it('removes only a failed Mac restart callback before retrying native staging', async () => {
    const api = await start();
    const staged = vi.fn();
    const restart = vi.fn();
    // The updater's own listener must survive cleanup of its queued restart.
    nativeEvents.on('update-downloaded', staged);
    updater.quitAndInstall.mockImplementation(() => {
      nativeEvents.on('update-downloaded', () => restart());
    });
    events.emit('update-downloaded', { version: '0.2.38' });
    api.quitAndInstallUpdate();
    expect(nativeUpdater.checkForUpdates).not.toHaveBeenCalled();
    events.emit('error', new Error('Native staging failed'));
    expect(nativeEvents.listenerCount('update-downloaded')).toBe(1);
    nativeUpdater.checkForUpdates.mockImplementation(() => nativeEvents.emit('update-downloaded'));
    api.quitAndInstallUpdate();
    expect(nativeUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(staged).toHaveBeenCalledTimes(1);
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('can retry native staging again when its check both reports an error and throws', async () => {
    const api = await start();
    const staged = vi.fn();
    const restart = vi.fn();
    nativeEvents.on('update-downloaded', staged);
    updater.quitAndInstall.mockImplementation(() => nativeEvents.on('update-downloaded', () => restart()));
    events.emit('update-downloaded', { version: '0.2.38' });
    api.quitAndInstallUpdate();
    events.emit('error', new Error('Staging interrupted'));
    nativeUpdater.checkForUpdates.mockImplementationOnce(() => {
      events.emit('error', new Error('Native check unavailable'));
      throw new Error('Native check unavailable');
    });
    expect(() => api.quitAndInstallUpdate()).toThrow('Native check unavailable');
    expect(nativeEvents.listenerCount('update-downloaded')).toBe(1);
    nativeUpdater.checkForUpdates.mockImplementation(() => nativeEvents.emit('update-downloaded'));
    api.quitAndInstallUpdate();
    expect(nativeUpdater.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(staged).toHaveBeenCalledTimes(1);
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('retries Mac staging that failed before the user clicked Update App', async () => {
    const api = await start();
    const restart = vi.fn();
    updater.quitAndInstall.mockImplementation(() => nativeEvents.on('update-downloaded', () => restart()));
    events.emit('update-downloaded', { version: '0.2.38' });
    nativeEvents.emit('error', new Error('Native staging failed before click'));
    nativeUpdater.checkForUpdates.mockImplementation(() => nativeEvents.emit('update-downloaded'));
    api.quitAndInstallUpdate();
    expect(nativeUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('does not restart healthy Mac staging after an unrelated feed error', async () => {
    const api = await start();
    updater.quitAndInstall.mockImplementation(() => nativeEvents.on('update-downloaded', vi.fn()));
    events.emit('update-downloaded', { version: '0.2.38' });
    events.emit('error', new Error('Feed offline'));
    api.quitAndInstallUpdate();
    expect(nativeUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it.each(['0.2.37', '0.2.36', 'invalid'])('never offers installed, older, or invalid version %s', async (version) => {
    const api = await start();
    events.emit('update-available', { version });
    events.emit('update-downloaded', { version });
    expect(api.getUpdateStatus()).toEqual({ state: 'idle' });
    api.quitAndInstallUpdate();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('clears the prompt once that version is installed and offers the next release', async () => {
    const api = await start();
    events.emit('update-downloaded', { version: '0.2.38' });
    updater.currentVersion.compare.mockImplementation((version) => version === '0.2.39' ? -1 : 0);
    expect(api.getUpdateStatus()).toEqual({ state: 'idle' });
    events.emit('update-downloaded', { version: '0.2.38' });
    expect(api.getUpdateStatus()).toEqual({ state: 'idle' });
    api.quitAndInstallUpdate();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    events.emit('update-downloaded', { version: '0.2.39' });
    expect(api.getUpdateStatus()).toEqual({ state: 'ready', version: '0.2.39' });
  });

  it('starts idle after relaunch onto the installed release', async () => {
    let api = await start();
    events.emit('update-downloaded', { version: '0.2.38' });
    win.emit('closed');
    vi.resetModules();
    updater.currentVersion.compare.mockReturnValue(0);
    api = await start();
    events.emit('update-not-available');
    expect(api.getUpdateStatus()).toEqual({ state: 'idle' });
  });

  it('keeps a downloaded update available through errors and avoids repeat downloads', async () => {
    const api = await start();
    events.emit('update-downloaded', { version: '0.2.38' });
    events.emit('error', new Error('offline'));
    events.emit('update-not-available');
    events.emit('update-available', { version: '0.2.38' });
    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000);
    expect(api.getUpdateStatus()).toEqual({ state: 'ready', version: '0.2.38' });
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('retries checks hourly and releases subscriptions when the window closes', async () => {
    await start();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    win.emit('closed');
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(events.listenerCount('update-downloaded')).toBe(0);
    expect(events.listenerCount('error')).toBe(0);
    expect(nativeEvents.listenerCount('error')).toBe(0);
  });

  it('leaves development builds idle', async () => {
    app.isPackaged = false;
    const api = await start();
    expect(api.getUpdateStatus()).toEqual({ state: 'idle' });
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });
});
