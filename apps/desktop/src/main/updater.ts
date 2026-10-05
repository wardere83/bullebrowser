// Auto-update against GitHub Releases.
//
// The update is downloaded quietly in the background; the user is never
// interrupted mid-task. When it's on disk we tell the renderer, which offers a
// top-right "Update App" button. Nothing installs until they click it — the one
// exception being a normal quit, where installing costs them nothing.
//
// This replaces checkForUpdatesAndNotify(), which fired a native OS
// notification (easy to miss, gone forever once dismissed) and only ran once at
// launch — a browser left open for days would never learn about a fix.

import { app, autoUpdater as nativeAutoUpdater, type BrowserWindow } from 'electron';
// electron-updater is CommonJS — import the default export and destructure
// to avoid `Named export 'autoUpdater' not found` at runtime.
import electronUpdater from 'electron-updater';
import { IPC, type UpdateStatus } from '../shared/ipc.js';

const { autoUpdater } = electronUpdater;

// A browser stays open for days, so a launch-only check misses everything
// shipped in between. Releases now go out on every merge (auto-release.yml),
// so check often enough that a fix reaches people the same day. The check is
// one small manifest request; the download only happens when there is news.
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let latest: UpdateStatus = { state: 'idle' };
// macOS may still be staging its native update after update-downloaded. Keep
// one install request in flight so repeated clicks cannot schedule two restarts.
let installRequested = false;
let retryNativeStaging = false;
const nativeDownloadListeners = () => nativeAutoUpdater.listeners('update-downloaded') as Array<(...args: unknown[]) => void>;
let nativeRestartListeners: ReturnType<typeof nativeDownloadListeners> = [];

function clearNativeRestartListeners() {
  for (const listener of nativeRestartListeners) nativeAutoUpdater.removeListener('update-downloaded', listener);
  nativeRestartListeners = [];
}

export function getUpdateStatus(): UpdateStatus {
  if (latest.state !== 'idle' && !isNewerVersion(latest.version)) latest = { state: 'idle' };
  // Keep the downloaded update internally for a failed-install retry, but
  // remove its prompt as soon as installation starts, including after the
  // renderer reloads while macOS is still staging the update.
  return installRequested ? { state: 'idle' } : latest;
}

// Use the updater's SemVer parser, including prerelease ordering. Cached or
// delayed events must never offer the version already running (or a downgrade).
function isNewerVersion(version: string): boolean {
  try {
    return autoUpdater.currentVersion.compare(version) < 0;
  } catch {
    return false;
  }
}

export function setupAutoUpdate(win: BrowserWindow) {
  // In dev there is no signed bundle to replace and no feed to read.
  if (!app.isPackaged) return;

  const send = (status: UpdateStatus) => {
    latest = status;
    if (!win.isDestroyed()) win.webContents.send(IPC.UPDATE_STATUS, status);
  };

  autoUpdater.autoDownload = true;
  autoUpdater.allowDowngrade = false;
  // Installing on quit is free for the user — they're already leaving. The
  // in-app button just lets them have the fix sooner.
  autoUpdater.autoInstallOnAppQuit = true;
  // MacUpdater ignores quitAndInstall's arguments and uses this setting to
  // choose between restarting on the new version and simply quitting.
  autoUpdater.autoRunAppAfterInstall = true;

  const available = (info: { version: string }) => {
    if (installRequested || !isNewerVersion(info.version) || getUpdateStatus().state === 'ready') return;
    send({ state: 'downloading', version: info.version });
  };
  const downloaded = (info: { version: string }) => {
    if (!isNewerVersion(info.version) || installRequested) return;
    send({ state: 'ready', version: info.version });
  };
  const unavailable = () => {
    if (!installRequested && getUpdateStatus().state !== 'ready') send({ state: 'idle' });
  };
  const nativeFailed = () => {
    // Squirrel can fail after ready is shown but before the first click. Keep
    // retry intent separate from feed/network errors while staging is healthy.
    if (latest.state === 'ready' && isNewerVersion(latest.version)) retryNativeStaging = true;
  };
  const failed = (err: Error) => {
    console.warn('[updater] error:', err?.message ?? err);
    if (installRequested) {
      installRequested = false;
      retryNativeStaging = nativeRestartListeners.length > 0;
      // MacUpdater leaves a queued restart callback behind when staging fails.
      // Remove only callbacks added by our request, preserving its staging
      // listener, so a retry cannot schedule two native restarts.
      clearNativeRestartListeners();
      // The process is still running: let the user retry a failed install.
      send(getUpdateStatus());
      return;
    }
    // A failed network check must not hide an installer already on disk.
    unavailable();
  };
  autoUpdater.on('update-available', available);
  autoUpdater.on('update-downloaded', downloaded);
  autoUpdater.on('update-not-available', unavailable);
  autoUpdater.on('error', failed);
  nativeAutoUpdater.on('error', nativeFailed);

  const check = () => {
    // Keep the ready update visible until installation; don't download it again.
    if (installRequested || getUpdateStatus().state === 'ready') return;
    void autoUpdater.checkForUpdates().catch(failed);
  };

  void check();
  const timer = setInterval(check, CHECK_INTERVAL_MS);
  win.once('closed', () => {
    clearInterval(timer);
    autoUpdater.removeListener('update-available', available);
    autoUpdater.removeListener('update-downloaded', downloaded);
    autoUpdater.removeListener('update-not-available', unavailable);
    autoUpdater.removeListener('error', failed);
    nativeAutoUpdater.removeListener('error', nativeFailed);
  });
}

export function quitAndInstallUpdate() {
  if (getUpdateStatus().state !== 'ready' || installRequested) return;
  installRequested = true;
  const existingListeners = new Set(nativeDownloadListeners());
  const captureNativeRestartListeners = () => {
    nativeRestartListeners = nativeDownloadListeners().filter((listener) => !existingListeners.has(listener));
  };
  try {
    // Windows installs without another wizard and launches the updated app.
    // macOS delegates shutdown and reopening to its native updater instead.
    autoUpdater.quitAndInstall(true, true);
    captureNativeRestartListeners();
    if (!installRequested) {
      clearNativeRestartListeners();
    } else if (retryNativeStaging && nativeRestartListeners.length > 0) {
      // A failed Mac staging attempt has stopped downloading. The updater's
      // auto-install-on-quit mode does not start it again on its own.
      retryNativeStaging = false;
      nativeAutoUpdater.checkForUpdates();
    }
  } catch (err) {
    captureNativeRestartListeners();
    retryNativeStaging = retryNativeStaging || nativeRestartListeners.length > 0;
    clearNativeRestartListeners();
    installRequested = false;
    throw err;
  }
}
