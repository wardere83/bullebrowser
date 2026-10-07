import { app, BrowserWindow, session } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { product } from '@bullebrowser/brand-tokens';
import { createBrowserWindow, runsHidden } from './window.js';
import { registerIpc } from './ipc-handlers.js';
import { tabManager } from './tabs/manager.js';
import { setupAutoUpdate } from './updater.js';
import { setupPermissions } from './permissions.js';
import { setupAppMenu } from './menu.js';
import { trackNetwork } from './agent/browser/net-activity.js';
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

// Hidden automated runs stay out of the Dock and are never activated, so they
// cannot pull focus away from whatever the person at the machine is doing. A
// fully transparent window counts as occluded, which would throttle painting
// and timers to a crawl; keep it running at the speed of a visible session.
if (runsHidden()) {
  app.dock?.hide();
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
}

// Present as the Chrome this is built on. Electron's default user agent adds
// "Electron/x" and the app name, and sites that gate features on the browser —
// Microsoft 365 (Word for the web can drop to view-only), Google sign-in —
// treat that unknown token as an unsupported browser. Set before any page loads.
app.userAgentFallback = app.userAgentFallback
  .replace(/\s?Electron\/\S+/, '')
  .replace(new RegExp(`\\s?${product.name}\\/\\S+`), '');
app.setAppUserModelId(product.appId);

// Disable Chromium's "from <product>" affordance in window titles by force.
app.commandLine.appendSwitch(
  'disable-features',
  runsHidden() ? 'ChromeLabs,MacWebContentsOcclusion' : 'ChromeLabs',
);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow: BrowserWindow | null = null;

async function createWindow() {
  const preloadPath = join(__dirname, '../preload/index.cjs');
  mainWindow = createBrowserWindow({ preloadPath });
  tabManager.attachWindow(mainWindow);
  registerIpc(mainWindow, () => mainWindow);
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
  // Count each tab's requests from the start, so "has the page gone quiet?"
  // knows about everything already in flight when an action begins.
  trackNetwork(session.defaultSession);
  await createWindow();
  // Test hook: lets the end-to-end suite drive the agent's browser runtime
  // directly (no model), to check refs, waits and consent handling exactly.
  // Only ever set by the test harness; never in a normal launch.
  if (process.env.BULLEBROWSER_TEST_HOOKS === '1') {
    const { DesktopToolRuntime } = await import('./agent/runtime.js');
    // The funding platform adds its own hooks to the same object when it starts.
    Object.assign(((globalThis as Record<string, unknown>).__bbTest ??= {}) as Record<string, unknown>, {
      tabManager,
      runtime: new DesktopToolRuntime({ request: async () => true }),
    });
  }
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
