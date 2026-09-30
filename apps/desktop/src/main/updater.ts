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
  return latest;
}

export function setupAutoUpdate(win: BrowserWindow) {
  // In dev there is no signed bundle to replace and no feed to read.
  if (!app.isPackaged) return;

  const send = (status: UpdateStatus) => {
    latest = status;
    if (!win.isDestroyed()) win.webContents.send(IPC.UPDATE_STATUS, status);
  };

  autoUpdater.autoDownload = true;
  // Installing on quit is free for the user — they're already leaving. The
  // in-app button just lets them have the fix sooner.
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    send({ state: 'downloading', version: info.version });
  });
  autoUpdater.on('update-downloaded', (info) => {
    // Surfaces the "Update App" button. Installing is the user's call: the
    // app never restarts on its own.
    send({ state: 'ready', version: info.version });
  });
  autoUpdater.on('update-not-available', () => {
    send({ state: 'idle' });
  });
  // An update failure must never surface as an error the user has to act on:
  // the app they have works fine, they simply won't get the new one yet.
  autoUpdater.on('error', (err) => {
    console.warn('[updater] error:', err?.message ?? err);
    send({ state: 'idle' });
  });

  const check = () =>
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn('[updater] check failed:', err?.message ?? err);
    });

  void check();
  const timer = setInterval(check, CHECK_INTERVAL_MS);
  win.on('closed', () => clearInterval(timer));
}

export function quitAndInstallUpdate() {
  // isSilent: false so the installer UI shows on Windows if it needs to;
  // isForceRunAfter: true so the user lands back in the app, which is the whole
  // point of a "relaunch" button.
  autoUpdater.quitAndInstall(false, true);
}
