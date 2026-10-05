import { app, type BrowserWindow, dialog, ipcMain } from 'electron';
import type { ProviderId } from '@bullebrowser/agent-core';
import { getUpdateStatus, quitAndInstallUpdate } from './updater.js';
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
import { sessionFileStore } from './storage/session-files.js';
import { projectStore } from './storage/projects.js';
import { transcribeAudio } from './voice.js';
import { connectRealtimeVoice, disconnectRealtimeVoice, disposeRealtimeVoice } from './realtime-voice.js';
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
  ipcMain.handle(IPC.UPDATE_GET_STATUS, () => getUpdateStatus());
  ipcMain.handle(IPC.UPDATE_INSTALL, () => quitAndInstallUpdate());
  ipcMain.handle(IPC.SECRET_HAS_API_KEY, (_e, provider?: ProviderId) => hasApiKey(provider));
  ipcMain.handle(IPC.SECRET_SET_API_KEY, (_e, key: string, provider?: ProviderId) => setApiKey(key, provider));
  ipcMain.handle(IPC.SECRET_CLEAR_API_KEY, (_e, provider?: ProviderId) => clearApiKey(provider));

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
  // Screenshot the active tab for a composer attachment. Reuses the same
  // capturePage the agent's screenshot tool uses.
  ipcMain.handle(IPC.AGENT_CAPTURE, async () => {
    const id = tabManager.getActiveId();
    const view = id ? tabManager.getView(id) : null;
    if (!id || !view) return null;
    return tabManager.withoutBrowsingCloud(id, async () => {
      const image = await view.webContents.capturePage();
      return { pngBase64: image.toPNG().toString('base64'), url: view.webContents.getURL() };
    });
  });

  // session files
  ipcMain.handle(IPC.FILE_PICK, async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Attach files',
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled || result.filePaths.length === 0) return [];
    return sessionFileStore.add(result.filePaths);
  });
  ipcMain.handle(IPC.FILE_LIST, () => sessionFileStore.list());
  ipcMain.handle(IPC.FILE_REMOVE, (_e, id: string) => sessionFileStore.remove(id));

  // projects
  ipcMain.handle(IPC.PROJECT_LIST, () => projectStore.list());
  ipcMain.handle(IPC.PROJECT_GET, (_e, id: string) => projectStore.get(id));
  ipcMain.handle(IPC.PROJECT_CREATE, (_e, name: string) => projectStore.create(name));
  ipcMain.handle(
    IPC.PROJECT_UPDATE,
    (_e, id: string, patch: { name?: string; instructions?: string }) =>
      projectStore.update(id, patch),
  );
  ipcMain.handle(IPC.PROJECT_ATTACH_FILES, (_e, id: string, fileIds: string[]) =>
    projectStore.attachFiles(id, fileIds),
  );
  ipcMain.handle(IPC.PROJECT_DELETE, (_e, id: string) => projectStore.delete(id));

  // voice → local transcription (no API key)
  ipcMain.handle(IPC.VOICE_TRANSCRIBE, (event, audio: Float32Array) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) {
      throw new Error('Voice transcription is only available in the app.');
    }
    return transcribeAudio(audio);
  });
  // Only the app's top-level chrome may connect live voice; website frames
  // cannot use the user's saved key or terminate a session owned by the app.
  ipcMain.handle(IPC.VOICE_CONNECT_REALTIME, (event, offerSdp: string) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) {
      throw new Error('Live voice is only available in the app.');
    }
    return connectRealtimeVoice(event.sender.id, offerSdp);
  });
  ipcMain.handle(IPC.VOICE_DISCONNECT_REALTIME, (event, callId: string) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) {
      throw new Error('Live voice is only available in the app.');
    }
    return disconnectRealtimeVoice(event.sender.id, callId);
  });
  const voiceOwnerId = win.webContents.id;
  win.webContents.once('destroyed', () => disposeRealtimeVoice(voiceOwnerId));
  win.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) disposeRealtimeVoice(voiceOwnerId);
  });

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

  // Chrome is the app interface, never a browsing surface. Reply links and
  // window.open requests belong in the managed web pane, keeping chat intact.
  const openWebTab = (url: string) => {
    try {
      if (!['http:', 'https:'].includes(new URL(url).protocol)) return;
      void tabManager.create(url).catch((error) => console.warn('[tabs] Could not open link:', error));
    } catch {
      // Invalid or non-web destinations cannot replace the app interface.
    }
  };
  win.webContents.setWindowOpenHandler(({ url }) => {
    openWebTab(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    openWebTab(url);
  });
}
