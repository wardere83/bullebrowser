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

export function registerIpc(win: BrowserWindow) {
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
  ipcMain.handle(IPC.AGENT_RUN, (_e, req: AgentRunRequest) => startAgentRun(win, req));
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

  // open external links from chrome
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}
