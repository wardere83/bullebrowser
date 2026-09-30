import { app, BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { product } from '@bullebrowser/brand-tokens';
import { createBrowserWindow } from './window.js';
import { registerIpc } from './ipc-handlers.js';
import { tabManager } from './tabs/manager.js';
import { setupAutoUpdate } from './updater.js';
import { setupPermissions } from './permissions.js';
import { setupAppMenu } from './menu.js';
import { loadDotEnv } from './env.js';

// In development, pick up ANTHROPIC_API_KEY (and any other vars) from a local
// .env so the agent is connected without re-entering the key in Settings.
loadDotEnv([process.cwd(), app.getAppPath()]);

// Hard-quit if a second instance launches; the first instance focuses its window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.setName(product.name);
app.setAppUserModelId(product.appId);

// Disable Chromium's "from <product>" affordance in window titles by force.
app.commandLine.appendSwitch('disable-features', 'ChromeLabs');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow: BrowserWindow | null = null;

async function createWindow() {
  const preloadPath = join(__dirname, '../preload/index.cjs');
  mainWindow = createBrowserWindow({ preloadPath });
  tabManager.attachWindow(mainWindow);
  registerIpc(mainWindow);
  setupAppMenu(mainWindow);
  // Deny capability requests to everything except this window's own chrome —
  // the agent browses arbitrary sites in this same session.
  setupPermissions(mainWindow.webContents.id);

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  await createWindow();
  // The updater pushes status to this window, so it needs the handle.
  if (mainWindow) setupAutoUpdate(mainWindow);

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
