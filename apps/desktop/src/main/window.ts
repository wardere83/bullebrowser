import { app, BrowserWindow, nativeImage } from 'electron';
import { join } from 'node:path';
import { product } from '@bullebrowser/brand-tokens';

export interface WindowOptions {
  preloadPath: string;
}

// Automated checks only: run with no visible window and without taking the
// desktop's focus, so a suite can run while someone is using the machine. The
// window is still composited (fully transparent, click-through, never key and
// never in the Dock) rather than left unshown, because a window that is never
// shown stops painting, and screenshots and visibility-dependent timers would
// then no longer match a real session. Ignored in a packaged build, so an
// installed app can never be started invisibly.
export function runsHidden(): boolean {
  return !app.isPackaged && process.env.BULLEBROWSER_HIDDEN === '1';
}

export function createBrowserWindow(opts: WindowOptions): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: product.windowTitle,
    backgroundColor: '#071422',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    // Centre the macOS close / minimise / zoom buttons in the 44px top bar.
    // The top bar leaves a matching gutter for them (MAC_TRAFFIC_LIGHT_GUTTER
    // in TopBar.tsx) so they never sit on the back and forward buttons.
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 16, y: 15 } } : {}),
    autoHideMenuBar: true,
    show: false,
    icon: tryIcon(),
    webPreferences: {
      preload: opts.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      // No DevTools on the app's own UI in a shipped build: it exposes the
      // chrome's internals and the IPC bridge to anyone poking at it. Still on
      // in development, where it's the main debugging tool.
      //
      // Worth being clear about what this is and isn't: it raises the bar, it
      // does not make the code secret. Any Electron app's JavaScript can be
      // read out of the installed bundle by someone who wants to. Treat this as
      // tidiness, never as a place to hide a secret.
      devTools: !app.isPackaged,
    },
  });

  if (runsHidden()) {
    win.setOpacity(0);
    win.setHasShadow(false);
    win.setIgnoreMouseEvents(true);
    win.setFocusable(false);
    win.once('ready-to-show', () => win.showInactive());
  } else {
    win.once('ready-to-show', () => win.show());
  }
  win.on('page-title-updated', (e) => e.preventDefault()); // keep our title

  return win;
}

function tryIcon() {
  try {
    return nativeImage.createFromPath(
      join(process.resourcesPath, 'icon.png'),
    );
  } catch {
    return undefined;
  }
}
