// The application menu and the right-click menu for the app's own chrome.
//
// Shortcuts live here, as menu accelerators, rather than as keydown listeners
// in the renderer: once the user clicks into a web page, keystrokes go to that
// page's view, never to the chrome — so Cmd+W / Cmd+T in the renderer only
// worked while the toolbar had focus, and a tab a site opened on top of the
// page could not be closed from the keyboard. Accelerators fire whatever has
// focus. (Electron's default menu also mapped Cmd+W to closing the whole
// window.) The Edit roles are what make Cmd+C / Cmd+V work at all.

import { app, Menu, MenuItem, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { product } from '@bullebrowser/brand-tokens';
import { tabManager } from './tabs/manager.js';

export function setupAppMenu(win: BrowserWindow) {
  const isMac = process.platform === 'darwin';
  const activeTab = () => tabManager.getActiveId();

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: product.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          } as MenuItemConstructorOptions,
        ]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => void tabManager.create() },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            const id = activeTab();
            if (id) void tabManager.close(id);
          },
        },
        { type: 'separator' },
        isMac ? { role: 'close', accelerator: 'CmdOrCtrl+Shift+W' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload Page',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            const id = activeTab();
            if (id) void tabManager.reload(id);
          },
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : ([{ role: 'toggleDevTools' }] as MenuItemConstructorOptions[])),
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  // Right-click in the chrome — the assistant's replies, the prompt box, the
  // address bar. Without it, selected text could only be copied by shortcut.
  win.webContents.on('context-menu', (_e, params) => {
    const menu = new Menu();
    if (params.isEditable) {
      menu.append(new MenuItem({ role: 'cut', enabled: params.editFlags.canCut }));
      menu.append(new MenuItem({ role: 'copy', enabled: params.editFlags.canCopy }));
      menu.append(new MenuItem({ role: 'paste', enabled: params.editFlags.canPaste }));
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({ role: 'selectAll' }));
    } else if (params.selectionText.trim()) {
      menu.append(new MenuItem({ role: 'copy' }));
    }
    if (menu.items.length) menu.popup({ window: win });
  });
}
