import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { compare } from 'semver';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { app, updater, nativeUpdater } = vi.hoisted(() => ({
  app: { isPackaged: true, quit: vi.fn(), relaunch: vi.fn(), once: vi.fn() },
  nativeUpdater: { getFeedURL: vi.fn(), emit: vi.fn(), on: vi.fn(), removeListener: vi.fn(), quitAndInstall: vi.fn(), checkForUpdates: vi.fn() },
  updater: {
    currentVersion: { compare: vi.fn() },
    autoDownload: true,
    autoInstallOnAppQuit: false,
    autoRunAppAfterInstall: true,
    allowDowngrade: true,
    on: vi.fn(),
    removeListener: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
  },
}));
vi.mock('electron', () => ({ app, autoUpdater: nativeUpdater }));
vi.mock('electron-updater', () => ({ default: { autoUpdater: updater } }));

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
let events: EventEmitter;
let nativeEvents: EventEmitter;
let appEvents: EventEmitter;
let win: EventEmitter & { isDestroyed: () => boolean; webContents: { send: ReturnType<typeof vi.fn> } };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'linux' });
  app.isPackaged = true;
  events = new EventEmitter();
  nativeEvents = new EventEmitter();
  // Match MacUpdater's synchronous native error forwarder.
  nativeEvents.on('error', (error) => events.emit('error', error));
  nativeUpdater.emit.mockImplementation((event, ...args) => nativeEvents.emit(event, ...args));
  appEvents = new EventEmitter();
  app.once.mockImplementation((event, callback) => appEvents.once(event, callback));
  nativeUpdater.getFeedURL.mockReturnValue('http://127.0.0.1:12345/');
  nativeUpdater.on.mockImplementation((event, callback) => nativeEvents.on(event, callback));
  nativeUpdater.removeListener.mockImplementation((event, callback) => nativeEvents.removeListener(event, callback));
  updater.on.mockImplementation((event, callback) => events.on(event, callback));
  updater.removeListener.mockImplementation((event, callback) => events.removeListener(event, callback));
  updater.checkForUpdates.mockReset().mockResolvedValue(null);
  updater.downloadUpdate.mockReset().mockResolvedValue([]);
  updater.currentVersion.compare.mockImplementation((version: string) => compare('0.2.37', version));
  win = Object.assign(new EventEmitter(), { isDestroyed: () => false, webContents: { send: vi.fn() } });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  appEvents.emit('quit');
  win.emit('closed');
  Object.defineProperty(process, 'platform', originalPlatform);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}

async function start() {
  const api = await import('./updater.js');
  api.setupAutoUpdate(win as unknown as BrowserWindow);
  await flush();
  return api;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('background app updates', () => {
  it('automatically downloads a new release and acknowledges it without closing or restarting', async () => {
    const api = await start();
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(true);
    expect(updater.autoRunAppAfterInstall).toBe(false);
    expect(updater.allowDowngrade).toBe(false);
    expect(() => api.prepareUpdate('0.2.38')).toThrow('no longer ready');
    events.emit('update-available', { version: '0.2.38' });
    expect(api.getUpdateStatus()).toEqual({ state: 'downloading', version: '0.2.38' });
    await flush();
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(() => api.prepareUpdate('0.2.38')).toThrow('no longer ready');
    expect(api.getUpdateStatus().state).toBe('downloading');
    events.emit('update-downloaded', { version: '0.2.38' });
    expect(api.getUpdateStatus()).toEqual({ state: 'ready', version: '0.2.38' });
    api.prepareUpdate('0.2.38');
    expect(api.getUpdateStatus()).toEqual({ state: 'idle' });
    expect(win.webContents.send).toHaveBeenLastCalledWith('update:status', { state: 'idle' });
    expect(() => api.prepareUpdate('0.2.38')).toThrow('no longer ready');
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(nativeUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(app.quit).not.toHaveBeenCalled();
    expect(app.relaunch).not.toHaveBeenCalled();
  });

  it('keeps acknowledgment across renderer status reads and shows the next newer release', async () => {
    const api = await start();
    events.emit('update-downloaded', { version: '0.2.38' });
    api.prepareUpdate('0.2.38');
    events.emit('update-available', { version: '0.2.38' });
    events.emit('update-downloaded', { version: '0.2.38' });
    events.emit('update-not-available');
    expect(api.getUpdateStatus()).toEqual({ state: 'idle' });
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    events.emit('update-available', { version: '0.2.39' });
    await flush();
    expect(api.getUpdateStatus()).toEqual({ state: 'downloading', version: '0.2.39' });
    events.emit('update-downloaded', { version: '0.2.39' });
    expect(api.getUpdateStatus()).toEqual({ state: 'ready', version: '0.2.39' });
  });

  it('rejects a stale acknowledgment instead of hiding a newer ready release', async () => {
    const api = await start();
    events.emit('update-downloaded', { version: '0.2.38' });
    events.emit('update-downloaded', { version: '0.2.39' });
    expect(() => api.prepareUpdate('0.2.38')).toThrow('no longer ready');
    expect(api.getUpdateStatus()).toEqual({ state: 'ready', version: '0.2.39' });
    api.prepareUpdate('0.2.39');
    expect(api.getUpdateStatus()).toEqual({ state: 'idle' });
  });

  it('checks every five minutes even after a ready update is acknowledged', async () => {
    const api = await start();
    events.emit('update-downloaded', { version: '0.2.38' });
    api.prepareUpdate('0.2.38');
    updater.checkForUpdates.mockImplementationOnce(async () => {
      events.emit('update-available', { version: '0.2.38' });
      return null;
    }).mockImplementationOnce(async () => {
      events.emit('update-available', { version: '0.2.39' });
      return null;
    });
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(api.getUpdateStatus()).toEqual({ state: 'idle' });
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(api.getUpdateStatus()).toEqual({ state: 'downloading', version: '0.2.39' });
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(3);
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it('does not download a ready version twice, or replace it with a stale lower feed', async () => {
    const api = await start();
    events.emit('update-downloaded', { version: '0.2.39' });
    updater.checkForUpdates.mockImplementation(async () => {
      events.emit('update-available', { version: '0.2.38' });
      return null;
    });
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    events.emit('update-available', { version: '0.2.39' });
    events.emit('update-downloaded', { version: '0.2.38' });
    events.emit('update-not-available');
    expect(api.getUpdateStatus()).toEqual({ state: 'ready', version: '0.2.39' });
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(4);
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
  });

  it.each(['0.2.37', '0.2.36', 'invalid'])('ignores installed, older, or invalid version %s', async (version) => {
    const api = await start();
    events.emit('update-available', { version });
    events.emit('update-downloaded', { version });
    await flush();
    expect(api.getUpdateStatus()).toEqual({ state: 'idle' });
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
  });

  it('orders release numbers and prereleases with SemVer', async () => {
    const api = await start();
    events.emit('update-downloaded', { version: '0.2.99' });
    events.emit('update-downloaded', { version: '0.2.100-beta.10' });
    events.emit('update-downloaded', { version: '0.2.100-beta.2' });
    expect(api.getUpdateStatus()).toEqual({ state: 'ready', version: '0.2.100-beta.10' });
    events.emit('update-downloaded', { version: '0.2.100' });
    events.emit('update-downloaded', { version: '0.2.99' });
    expect(api.getUpdateStatus()).toEqual({ state: 'ready', version: '0.2.100' });
  });

  it('clamps progress and ignores progress after the update is ready', async () => {
    const transfer = deferred<string[]>();
    updater.downloadUpdate.mockReturnValue(transfer.promise);
    const api = await start();
    events.emit('update-available', { version: '0.2.38' });
    events.emit('download-progress', { percent: -5 });
    expect(api.getUpdateStatus()).toEqual({ state: 'downloading', version: '0.2.38', percent: 0 });
    events.emit('download-progress', { percent: 41.8 });
    expect(api.getUpdateStatus()).toEqual({ state: 'downloading', version: '0.2.38', percent: 42 });
    events.emit('download-progress', { percent: 105 });
    events.emit('download-progress', { percent: NaN });
    expect(api.getUpdateStatus()).toEqual({ state: 'downloading', version: '0.2.38', percent: 100 });
    events.emit('update-downloaded', { version: '0.2.38' });
    events.emit('download-progress', { percent: 70 });
    expect(api.getUpdateStatus()).toEqual({ state: 'ready', version: '0.2.38' });
    transfer.resolve([]);
    await flush();
  });

  it('shows a failed known download and retries successfully without closing the app', async () => {
    const api = await start();
    updater.downloadUpdate.mockRejectedValueOnce(new Error('Connection interrupted'));
    events.emit('update-available', { version: '0.2.38' });
    await flush();
    expect(api.getUpdateStatus()).toEqual({ state: 'error', version: '0.2.38', message: 'Could not download the update. Check your connection and retry.' });
    updater.checkForUpdates.mockImplementationOnce(async () => {
      events.emit('update-available', { version: '0.2.38' });
      return null;
    });
    await api.retryUpdate();
    await flush();
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(2);
    expect(api.getUpdateStatus()).toEqual({ state: 'downloading', version: '0.2.38' });
    events.emit('update-downloaded', { version: '0.2.38' });
    expect(api.getUpdateStatus()).toEqual({ state: 'ready', version: '0.2.38' });
    expect(app.quit).not.toHaveBeenCalled();
  });

  it('reports a new retry failure instead of hiding the notice or returning a stale ready state', async () => {
    const api = await start();
    updater.downloadUpdate.mockRejectedValueOnce(new Error('Download interrupted'));
    events.emit('update-available', { version: '0.2.38' });
    await flush();
    updater.checkForUpdates.mockRejectedValueOnce(new Error('Release server unavailable'));
    await api.retryUpdate();
    expect(api.getUpdateStatus()).toEqual({ state: 'error', version: '0.2.38', message: 'Could not check for the update. Please retry.' });
    events.emit('update-not-available');
    expect(api.getUpdateStatus().state).toBe('error');
  });

  it('handles the emitted and rejected forms of one download failure without changing its explanation', async () => {
    const transfer = deferred<string[]>();
    updater.downloadUpdate.mockReturnValueOnce(transfer.promise);
    const api = await start();
    events.emit('update-available', { version: '0.2.38' });
    await flush();
    const error = new Error('Download interrupted at https://user:secret@example.org/package');
    events.emit('error', error);
    transfer.reject(error);
    await flush();
    expect(api.getUpdateStatus()).toEqual({ state: 'error', version: '0.2.38', message: 'Could not download the update. Check your connection and retry.' });
    expect(JSON.stringify(api.getUpdateStatus())).not.toContain('secret');
  });

  it('preserves a ready installer through an unrelated failed release check', async () => {
    const api = await start();
    events.emit('update-downloaded', { version: '0.2.38' });
    updater.checkForUpdates.mockRejectedValueOnce(new Error('Feed offline'));
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    events.emit('error', new Error('Feed offline'));
    expect(api.getUpdateStatus()).toEqual({ state: 'ready', version: '0.2.38' });
    await api.retryUpdate();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('serializes checks and downloads while allowing the next version after completion', async () => {
    const check = deferred<null>();
    updater.checkForUpdates.mockReturnValueOnce(check.promise);
    const api = await start();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    win.emit('focus');
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    check.resolve(null);
    await flush();
    const transfer = deferred<string[]>();
    updater.downloadUpdate.mockReturnValueOnce(transfer.promise);
    events.emit('update-available', { version: '0.2.38' });
    events.emit('update-available', { version: '0.2.38' });
    events.emit('update-available', { version: '0.2.39' });
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
    events.emit('update-downloaded', { version: '0.2.38' });
    transfer.resolve([]);
    await flush();
    updater.checkForUpdates.mockImplementationOnce(async () => {
      events.emit('update-available', { version: '0.2.39' });
      return null;
    });
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(api.getUpdateStatus()).toEqual({ state: 'downloading', version: '0.2.39' });
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(2);
  });

  it('checks when focused at most once per minute', async () => {
    await start();
    win.emit('focus');
    await vi.advanceTimersByTimeAsync(59 * 1000);
    win.emit('focus');
    await flush();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    win.emit('focus');
    await flush();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    win.emit('focus');
    await flush();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('waits for native Mac staging, allows staging retries, and never adds restart callbacks', async () => {
    Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'darwin' });
    const api = await start();
    events.emit('update-downloaded', { version: '0.2.38' });
    expect(api.getUpdateStatus()).toEqual({ state: 'downloading', version: '0.2.38', phase: 'preparing' });
    expect(() => api.prepareUpdate('0.2.38')).toThrow('no longer ready');
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    // electron-updater forwards native staging errors to its own error event.
    events.emit('error', new Error('Cannot stage signed bundle'));
    expect(api.getUpdateStatus()).toEqual({ state: 'error', version: '0.2.38', message: 'Could not prepare the update. Please retry.' });
    updater.checkForUpdates.mockImplementationOnce(async () => {
      events.emit('update-available', { version: '0.2.38' });
      return null;
    });
    await api.retryUpdate();
    await flush();
    events.emit('update-downloaded', { version: '0.2.38' });
    nativeEvents.emit('update-downloaded', {}, '', '', new Date(), 'http://127.0.0.1:12345/update.zip');
    expect(api.getUpdateStatus()).toEqual({ state: 'ready', version: '0.2.38' });
    api.prepareUpdate('0.2.38');
    nativeEvents.emit('update-downloaded', {}, '', '', new Date(), 'http://127.0.0.1:12345/update.zip');
    expect(api.getUpdateStatus()).toEqual({ state: 'idle' });
    expect(nativeEvents.listenerCount('update-downloaded')).toBe(1);
    expect(nativeUpdater.checkForUpdates).not.toHaveBeenCalled();
    expect(nativeUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(app.quit).not.toHaveBeenCalled();
  });

  it('ignores an old Mac native event while the newer package is being staged', async () => {
    Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'darwin' });
    const api = await start();
    events.emit('update-downloaded', { version: '0.2.38' });
    // A different package event cannot supersede in-flight native staging.
    events.emit('update-downloaded', { version: '0.2.39' });
    events.emit('error', new Error('Native package validation failed'));
    expect(api.getUpdateStatus().state).toBe('error');
    nativeUpdater.getFeedURL.mockReturnValueOnce('http://127.0.0.1:54321/');
    events.emit('update-downloaded', { version: '0.2.39' });
    nativeEvents.emit('update-downloaded', {}, '', '', new Date(), 'http://127.0.0.1:12345/update.zip');
    expect(api.getUpdateStatus()).toEqual({ state: 'downloading', version: '0.2.39', phase: 'preparing' });
    nativeEvents.emit('update-downloaded', {}, '', '', new Date(), 'invalid');
    expect(api.getUpdateStatus().state).toBe('downloading');
    nativeEvents.emit('update-downloaded', {}, '', '', new Date(), 'http://127.0.0.1:54321/new.zip');
    expect(api.getUpdateStatus()).toEqual({ state: 'ready', version: '0.2.39' });
  });

  it('ignores omitted native URL metadata rather than reporting an uncorrelated package ready', async () => {
    Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'darwin' });
    const api = await start();
    nativeEvents.emit('update-downloaded');
    expect(api.getUpdateStatus()).toEqual({ state: 'idle' });
    events.emit('update-downloaded', { version: '0.2.38' });
    events.emit('update-downloaded', { version: '0.2.39' });
    nativeEvents.emit('update-downloaded');
    expect(api.getUpdateStatus()).toEqual({ state: 'downloading', version: '0.2.38', phase: 'preparing' });
  });

  it('reports stalled native staging, then safely recovers a late matching completion', async () => {
    Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'darwin' });
    const api = await start();
    events.emit('update-downloaded', { version: '0.2.38' });
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    // Duplicate package events cannot reset the staging deadline.
    events.emit('update-downloaded', { version: '0.2.38' });
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(api.getUpdateStatus()).toEqual({ state: 'error', version: '0.2.38', message: 'Quit and reopen BulleBrowser to finish preparing this update.', retryable: false });
    await api.retryUpdate();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    events.emit('update-downloaded', { version: '0.2.39' });
    nativeEvents.emit('update-downloaded', {}, '', '', new Date(), 'http://127.0.0.1:54321/new.zip');
    expect(api.getUpdateStatus().state).toBe('error');
    nativeEvents.emit('update-downloaded', {}, '', '', new Date(), 'http://127.0.0.1:12345/update.zip');
    expect(api.getUpdateStatus()).toEqual({ state: 'ready', version: '0.2.38' });
    updater.checkForUpdates.mockImplementationOnce(async () => {
      events.emit('update-available', { version: '0.2.39' });
      return null;
    });
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    events.emit('update-downloaded', { version: '0.2.39' });
    nativeEvents.emit('update-downloaded', {}, '', '', new Date(), 'http://127.0.0.1:54321/new.zip');
    expect(api.getUpdateStatus()).toEqual({ state: 'deferred', version: '0.2.39', preparedVersion: '0.2.38' });
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(api.getUpdateStatus().state).toBe('deferred');
  });

  it('preserves the first prepared Mac bundle and announces each newer release without staging again', async () => {
    Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'darwin' });
    const api = await start();
    events.emit('update-available', { version: '0.2.50' });
    await flush();
    events.emit('update-downloaded', { version: '0.2.50' });
    nativeEvents.emit('update-downloaded', {}, '', '', new Date(), 'http://127.0.0.1:12345/update.zip');
    expect(api.getUpdateStatus()).toEqual({ state: 'ready', version: '0.2.50' });
    api.prepareUpdate('0.2.50');
    expect(api.getUpdateStatus()).toEqual({ state: 'idle' });
    updater.checkForUpdates.mockImplementationOnce(async () => {
      events.emit('update-available', { version: '0.2.51' });
      return null;
    });
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(api.getUpdateStatus()).toEqual({ state: 'deferred', version: '0.2.51', preparedVersion: '0.2.50' });
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(nativeUpdater.getFeedURL).toHaveBeenCalledTimes(1);
    api.dismissUpdateNotice('0.2.51');
    expect(api.getUpdateStatus()).toEqual({ state: 'idle' });
    events.emit('update-available', { version: '0.2.51' });
    events.emit('update-downloaded', { version: '0.2.51' });
    nativeEvents.emit('update-downloaded', {}, '', '', new Date(), 'http://127.0.0.1:12345/update.zip');
    expect(api.getUpdateStatus()).toEqual({ state: 'idle' });
    events.emit('update-available', { version: '0.2.52' });
    expect(api.getUpdateStatus()).toEqual({ state: 'deferred', version: '0.2.52', preparedVersion: '0.2.50' });
    events.emit('update-available', { version: '0.2.51' });
    events.emit('update-downloaded', { version: '0.2.52' });
    events.emit('error', new Error('Unrelated feed error'));
    expect(api.getUpdateStatus()).toEqual({ state: 'deferred', version: '0.2.52', preparedVersion: '0.2.50' });
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(() => api.dismissUpdateNotice('0.2.51')).toThrow('notice has changed');
    expect(() => api.prepareUpdate('0.2.52')).toThrow('no longer ready');
    expect(api.getUpdateStatus().state).toBe('deferred');
    expect(app.quit).not.toHaveBeenCalled();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('can fetch the latest Mac release after normal relaunch activates the previously prepared version', async () => {
    Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'darwin' });
    let api = await start();
    events.emit('update-downloaded', { version: '0.2.50' });
    nativeEvents.emit('update-downloaded', {}, '', '', new Date(), 'http://127.0.0.1:12345/update.zip');
    events.emit('update-available', { version: '0.2.51' });
    api.dismissUpdateNotice('0.2.51');
    appEvents.emit('quit');
    vi.resetModules();
    updater.currentVersion.compare.mockImplementation((version: string) => compare('0.2.50', version));
    api = await start();
    events.emit('update-available', { version: '0.2.52' });
    await flush();
    expect(api.getUpdateStatus()).toEqual({ state: 'downloading', version: '0.2.52' });
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
    events.emit('update-downloaded', { version: '0.2.52' });
    nativeEvents.emit('update-downloaded', {}, '', '', new Date(), 'http://127.0.0.1:12345/update.zip');
    expect(api.getUpdateStatus()).toEqual({ state: 'ready', version: '0.2.52' });
  });

  it('reports native rejection with a safe reopen instruction', async () => {
    Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'darwin' });
    const api = await start();
    events.emit('update-downloaded', { version: '0.2.38' });
    nativeEvents.emit('update-not-available');
    expect(api.getUpdateStatus()).toEqual({ state: 'error', version: '0.2.38', message: 'Quit and reopen BulleBrowser to finish preparing this update.', retryable: false });
    expect(nativeUpdater.emit).not.toHaveBeenCalled();
  });

  it.each(['timeout', 'native unavailable'])('does not race a pending native transfer after %s; genuine failure enables retry', async (failure) => {
    Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'darwin' });
    updater.downloadUpdate.mockImplementationOnce(() => new Promise<string[]>((_resolve, reject) => {
      // MacUpdater registers this rejection before asking Squirrel to fetch.
      nativeEvents.once('error', reject);
      events.emit('update-downloaded', { version: '0.2.38' });
    }));
    const api = await start();
    events.emit('update-available', { version: '0.2.38' });
    await flush();
    expect(api.getUpdateStatus()).toEqual({ state: 'downloading', version: '0.2.38', phase: 'preparing' });
    if (failure === 'timeout') await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    else nativeEvents.emit('update-not-available');
    await flush();
    expect(api.getUpdateStatus()).toEqual({ state: 'error', version: '0.2.38', message: 'Quit and reopen BulleBrowser to finish preparing this update.', retryable: false });
    await api.retryUpdate();
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(nativeUpdater.emit).not.toHaveBeenCalled();
    // A real native error rejects MacUpdater's pending promise; only then is
    // it safe to prepare another update through its ordinary retry path.
    nativeEvents.emit('error', new Error('Native signed bundle validation failed'));
    await flush();
    expect(api.getUpdateStatus()).toEqual({ state: 'error', version: '0.2.38', message: 'Could not prepare the update. Please retry.' });
    updater.checkForUpdates.mockImplementationOnce(async () => {
      events.emit('update-available', { version: '0.2.38' });
      return null;
    });
    await api.retryUpdate();
    await flush();
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(2);
    events.emit('update-downloaded', { version: '0.2.38' });
    nativeEvents.emit('update-downloaded', {}, '', '', new Date(), 'http://127.0.0.1:12345/update.zip');
    expect(api.getUpdateStatus()).toEqual({ state: 'ready', version: '0.2.38' });
    expect(app.quit).not.toHaveBeenCalled();
  });

  it('continues Mac staging and update checks with no windows, then rebinds the existing updater', async () => {
    Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'darwin' });
    const api = await start();
    const oldWindow = win;
    events.emit('update-downloaded', { version: '0.2.38' });
    oldWindow.emit('closed');
    oldWindow.webContents.send.mockClear();
    nativeEvents.emit('update-downloaded', {}, '', '', new Date(), 'http://127.0.0.1:12345/update.zip');
    expect(api.getUpdateStatus()).toEqual({ state: 'ready', version: '0.2.38' });
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(oldWindow.webContents.send).not.toHaveBeenCalled();
    win = Object.assign(new EventEmitter(), { isDestroyed: () => false, webContents: { send: vi.fn() } });
    api.setupAutoUpdate(win as unknown as BrowserWindow);
    api.setupAutoUpdate(win as unknown as BrowserWindow);
    expect(win.webContents.send).toHaveBeenLastCalledWith('update:status', { state: 'ready', version: '0.2.38' });
    expect(events.listenerCount('update-downloaded')).toBe(1);
    expect(nativeEvents.listenerCount('update-downloaded')).toBe(1);
    expect(win.listenerCount('focus')).toBe(1);
    expect(win.listenerCount('closed')).toBe(1);
  });

  it('removes all updater subscriptions, timers, and pending publications on app quit', async () => {
    Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'darwin' });
    const api = await start();
    const transfer = deferred<string[]>();
    updater.downloadUpdate.mockReturnValueOnce(transfer.promise);
    events.emit('update-available', { version: '0.2.38' });
    await flush();
    appEvents.emit('quit');
    win.webContents.send.mockClear();
    transfer.reject(new Error('Window closed'));
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(events.eventNames()).toEqual([]);
    // The dependency's native error forwarder is not owned by our setup.
    expect(nativeEvents.eventNames()).toEqual(['error']);
    expect(win.listenerCount('focus')).toBe(0);
    expect(win.webContents.send).not.toHaveBeenCalled();
    await api.retryUpdate();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('starts idle after a normal relaunch onto the installed release', async () => {
    let api = await start();
    events.emit('update-downloaded', { version: '0.2.38' });
    api.prepareUpdate('0.2.38');
    appEvents.emit('quit');
    vi.resetModules();
    updater.currentVersion.compare.mockImplementation((version: string) => compare('0.2.38', version));
    api = await start();
    events.emit('update-downloaded', { version: '0.2.38' });
    expect(api.getUpdateStatus()).toEqual({ state: 'idle' });
    events.emit('update-downloaded', { version: '0.2.39' });
    expect(api.getUpdateStatus()).toEqual({ state: 'ready', version: '0.2.39' });
  });

  it('retains acknowledgment and offers subsequent releases when a closed window is recreated', async () => {
    const api = await start();
    events.emit('update-downloaded', { version: '0.2.38' });
    api.prepareUpdate('0.2.38');
    const oldWindow = win;
    oldWindow.emit('closed');
    oldWindow.webContents.send.mockClear();
    win = Object.assign(new EventEmitter(), { isDestroyed: () => false, webContents: { send: vi.fn() } });
    api.setupAutoUpdate(win as unknown as BrowserWindow);
    await flush();
    expect(api.getUpdateStatus()).toEqual({ state: 'idle' });
    events.emit('update-downloaded', { version: '0.2.38' });
    expect(api.getUpdateStatus()).toEqual({ state: 'idle' });
    events.emit('update-downloaded', { version: '0.2.39' });
    expect(api.getUpdateStatus()).toEqual({ state: 'ready', version: '0.2.39' });
    expect(win.webContents.send).toHaveBeenLastCalledWith('update:status', { state: 'ready', version: '0.2.39' });
    expect(oldWindow.webContents.send).not.toHaveBeenCalled();
    expect(events.listenerCount('update-downloaded')).toBe(1);
  });

  it('offers the release again after a crash/relaunch that did not apply the update', async () => {
    let api = await start();
    events.emit('update-downloaded', { version: '0.2.38' });
    api.prepareUpdate('0.2.38');
    appEvents.emit('quit');
    vi.resetModules();
    api = await start();
    events.emit('update-downloaded', { version: '0.2.38' });
    expect(api.getUpdateStatus()).toEqual({ state: 'ready', version: '0.2.38' });
  });

  it('does not start updater work in development builds', async () => {
    app.isPackaged = false;
    const api = await start();
    expect(api.getUpdateStatus()).toEqual({ state: 'idle' });
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
  });
});
