// Turns a self-contained HTML page into PDF bytes with Chromium's own printer.
// The page runs in a hidden window of its own, in a private in-memory session
// with script turned off, and nothing outside the page itself may load.

import { BrowserWindow, session } from 'electron';

const PARTITION = 'bb-pdf-render';
let guarded = false;

export async function renderPdf(html: string): Promise<Buffer> {
  const ses = session.fromPartition(PARTITION, { cache: false });
  if (!guarded) {
    ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('data:') }));
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    guarded = true;
  }
  const win = new BrowserWindow({
    show: false,
    width: 816,
    height: 1056,
    webPreferences: { session: ses, javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return await win.webContents.printToPDF({ pageSize: 'Letter', printBackground: true, preferCSSPageSize: true });
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}
