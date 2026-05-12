import { app, BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { product } from '@bullebrowser/brand-tokens';
import { createBrowserWindow } from './window.js';
import { registerIpc } from './ipc-handlers.js';
import { tabManager } from './tabs/manager.js';
import { setupAutoUpdate } from './updater.js';

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

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  await createWindow();
  setupAutoUpdate();

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
