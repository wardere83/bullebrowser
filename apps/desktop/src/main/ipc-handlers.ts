import { app, type BrowserWindow, ipcMain, shell } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { product } from '@bullebrowser/brand-tokens';
import {
  IPC,
  type AgentRunRequest,
  type AppInfo,
  type AppSettings,
  type LayoutBounds,
} from '../shared/ipc.js';
import { tabManager } from './tabs/manager.js';
import { historyStore } from './storage/history.js';
import { bookmarkStore } from './storage/bookmarks.js';
import { getSettings, setSettings } from './storage/settings.js';
import { conversationStore } from './storage/conversations.js';
import {
  clearApiKey,
  hasApiKey,
  setApiKey,
} from './storage/secrets.js';
import {
  cancelAgentRun,
  replyAgentConfirm,
  startAgentRun,
} from './agent/run.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Track which window is currently the IPC target. When a new window
// is created (e.g., the macOS dock reactivate path), we want to re-target
// the agent + window-open handlers at that window rather than crash by
// double-registering ipcMain.handle.
let currentWindow: BrowserWindow | null = null;
let handlersRegistered = false;

const ALL_CHANNELS: readonly string[] = [
  IPC.TAB_LIST, IPC.TAB_CREATE, IPC.TAB_CLOSE, IPC.TAB_SWITCH, IPC.TAB_NAVIGATE,
  IPC.TAB_RELOAD, IPC.TAB_BACK, IPC.TAB_FORWARD, IPC.TAB_REORDER,
  IPC.LAYOUT_SET_BOUNDS,
  IPC.HISTORY_LIST, IPC.HISTORY_CLEAR,
  IPC.BOOKMARK_LIST, IPC.BOOKMARK_ADD, IPC.BOOKMARK_REMOVE,
  IPC.SETTINGS_GET, IPC.SETTINGS_SET,
  IPC.SECRET_HAS_API_KEY, IPC.SECRET_SET_API_KEY, IPC.SECRET_CLEAR_API_KEY,
  IPC.CONVERSATION_LIST, IPC.CONVERSATION_GET, IPC.CONVERSATION_NEW, IPC.CONVERSATION_DELETE,
  IPC.AGENT_RUN, IPC.AGENT_CANCEL, IPC.AGENT_CONFIRM_REPLY,
  IPC.APP_GET_INFO, IPC.APP_QUIT,
];

export function registerIpc(win: BrowserWindow) {
  // Re-target window-scoped concerns every call (the window can change on
  // macOS reactivate). Channel handlers themselves register only once.
  currentWindow = win;
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  if (handlersRegistered) return;
  handlersRegistered = true;
  for (const ch of ALL_CHANNELS) ipcMain.removeHandler(ch);

  // tabs
  ipcMain.handle(IPC.TAB_LIST, () => tabManager.list());
  ipcMain.handle(IPC.TAB_CREATE, (_e, url?: string) => tabManager.create(url));
  ipcMain.handle(IPC.TAB_CLOSE, (_e, id: string) => tabManager.close(id));
  ipcMain.handle(IPC.TAB_SWITCH, (_e, id: string) => tabManager.activate(id));
  ipcMain.handle(IPC.TAB_NAVIGATE, (_e, id: string, url: string) =>
    tabManager.navigate(id, url),
  );
  ipcMain.handle(IPC.TAB_RELOAD, (_e, id: string) => tabManager.reload(id));
  ipcMain.handle(IPC.TAB_BACK, (_e, id: string) => tabManager.back(id));
  ipcMain.handle(IPC.TAB_FORWARD, (_e, id: string) => tabManager.forward(id));
  ipcMain.handle(IPC.TAB_REORDER, (_e, ids: string[]) => tabManager.reorder(ids));

  // layout
  ipcMain.handle(IPC.LAYOUT_SET_BOUNDS, (_e, b: LayoutBounds) => tabManager.setBounds(b));

  // history & bookmarks
  ipcMain.handle(IPC.HISTORY_LIST, (_e, limit?: number) => historyStore.list(limit));
  ipcMain.handle(IPC.HISTORY_CLEAR, () => historyStore.clear());
  ipcMain.handle(IPC.BOOKMARK_LIST, () => bookmarkStore.list());
  ipcMain.handle(IPC.BOOKMARK_ADD, (_e, b: { url: string; title: string }) =>
    bookmarkStore.add(b),
  );
  ipcMain.handle(IPC.BOOKMARK_REMOVE, (_e, id: string) => bookmarkStore.remove(id));

  // settings & secrets
  ipcMain.handle(IPC.SETTINGS_GET, () => getSettings());
  ipcMain.handle(IPC.SETTINGS_SET, (_e, patch: Partial<AppSettings>) => setSettings(patch));
  ipcMain.handle(IPC.SECRET_HAS_API_KEY, () => hasApiKey());
  ipcMain.handle(IPC.SECRET_SET_API_KEY, (_e, key: string) => setApiKey(key));
  ipcMain.handle(IPC.SECRET_CLEAR_API_KEY, () => clearApiKey());

  // conversations
  ipcMain.handle(IPC.CONVERSATION_LIST, () => conversationStore.list());
  ipcMain.handle(IPC.CONVERSATION_GET, (_e, id: string) => conversationStore.get(id));
  ipcMain.handle(IPC.CONVERSATION_NEW, () => conversationStore.create());
  ipcMain.handle(IPC.CONVERSATION_DELETE, (_e, id: string) => conversationStore.delete(id));

  // agent
  ipcMain.handle(IPC.AGENT_RUN, (_e, req: AgentRunRequest) => {
    if (!currentWindow) throw new Error('No active window to host the agent run.');
    return startAgentRun(currentWindow, req);
  });
  ipcMain.handle(IPC.AGENT_CANCEL, (_e, runId: string) => cancelAgentRun(runId));
  ipcMain.handle(
    IPC.AGENT_CONFIRM_REPLY,
    (_e, runId: string, id: string, approved: boolean) =>
      replyAgentConfirm(runId, id, approved),
  );

  // app info
  ipcMain.handle(IPC.APP_GET_INFO, (): AppInfo => {
    let thirdPartyNotices: AppInfo['thirdPartyNotices'] = [];
    try {
      const noticesPath = join(__dirname, '../renderer/third-party-notices.json');
      thirdPartyNotices = JSON.parse(readFileSync(noticesPath, 'utf-8'));
    } catch {
      /* notices file is generated at build time; ok if missing in dev */
    }
    return {
      name: product.name,
      version: app.getVersion(),
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      platform: process.platform,
      thirdPartyNotices,
    };
  });
  ipcMain.handle(IPC.APP_QUIT, () => app.quit());

}
