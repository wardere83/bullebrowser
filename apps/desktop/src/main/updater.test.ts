import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { app, updater } = vi.hoisted(() => ({
  app: { isPackaged: true },
  updater: {
    currentVersion: { compare: vi.fn() },
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowDowngrade: true,
    on: vi.fn(),
    removeListener: vi.fn(),
    checkForUpdates: vi.fn(),
    quitAndInstall: vi.fn(),
  },
}));
vi.mock('electron', () => ({ app }));
vi.mock('electron-updater', () => ({ default: { autoUpdater: updater } }));

let events: EventEmitter;
let win: EventEmitter & { isDestroyed: () => boolean; webContents: { send: ReturnType<typeof vi.fn> } };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  app.isPackaged = true;
  events = new EventEmitter();
  updater.on.mockImplementation((event, callback) => events.on(event, callback));
  updater.removeListener.mockImplementation((event, callback) => events.removeListener(event, callback));
  updater.checkForUpdates.mockResolvedValue(null);
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
    api.quitAndInstallUpdate();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    events.emit('update-available', { version: '0.2.38' });
    expect(api.getUpdateStatus()).toEqual({ state: 'downloading', version: '0.2.38' });
    api.quitAndInstallUpdate();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    events.emit('update-downloaded', { version: '0.2.38' });
    expect(api.getUpdateStatus()).toEqual({ state: 'ready', version: '0.2.38' });
    api.quitAndInstallUpdate();
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
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
  });

  it('leaves development builds idle', async () => {
    app.isPackaged = false;
    const api = await start();
    expect(api.getUpdateStatus()).toEqual({ state: 'idle' });
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });
});
