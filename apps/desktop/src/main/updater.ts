// Wire up electron-updater to GitHub Releases. Disabled in dev.

import { app } from 'electron';
// electron-updater is CommonJS — import the default export and destructure
// to avoid `Named export 'autoUpdater' not found` at runtime.
import electronUpdater from 'electron-updater';
const { autoUpdater } = electronUpdater;

export function setupAutoUpdate() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater
    .checkForUpdatesAndNotify()
    .catch((err) => console.warn('[updater] check failed:', err));
}
