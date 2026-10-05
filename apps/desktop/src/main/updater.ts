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

import { app, type BrowserWindow } from 'electron';
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

export function getUpdateStatus(): UpdateStatus {
  if (latest.state !== 'idle' && !isNewerVersion(latest.version)) latest = { state: 'idle' };
  return latest;
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

  const available = (info: { version: string }) => {
    if (!isNewerVersion(info.version) || getUpdateStatus().state === 'ready') return;
    send({ state: 'downloading', version: info.version });
  };
  const downloaded = (info: { version: string }) => {
    if (!isNewerVersion(info.version)) return;
    send({ state: 'ready', version: info.version });
  };
  const unavailable = () => {
    if (getUpdateStatus().state !== 'ready') send({ state: 'idle' });
  };
  const failed = (err: Error) => {
    console.warn('[updater] error:', err?.message ?? err);
    // A failed network check must not hide an installer already on disk.
    unavailable();
  };
  autoUpdater.on('update-available', available);
  autoUpdater.on('update-downloaded', downloaded);
  autoUpdater.on('update-not-available', unavailable);
  autoUpdater.on('error', failed);

  const check = () => {
    // Keep the ready update visible until installation; don't download it again.
    if (getUpdateStatus().state === 'ready') return;
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
  });
}

export function quitAndInstallUpdate() {
  if (getUpdateStatus().state !== 'ready') return;
  // isSilent: false so the installer UI shows on Windows if it needs to;
  // isForceRunAfter: true so the user lands back in the app, which is the whole
  // point of a "relaunch" button.
  autoUpdater.quitAndInstall(false, true);
}
