import { app, type BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type { ProviderId } from '@bullebrowser/agent-core';
import { dismissUpdateNotice, getUpdateStatus, prepareUpdate, retryUpdate } from './updater.js';
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
import { identityService } from './identity/service.js';
import { startFundingPlatform } from './funding/platform.js';
import { transcribeAudio } from './voice.js';
import { prepareSpeech, synthesizeAudio } from './speech.js';
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

// Chats and projects can hold what an organization's documents say, so they
// are listed, opened and changed only under the organization they belong to.
async function activeOrganizationId(): Promise<string | null> {
  try {
    return (await identityService.currentSession()).organizationId;
  } catch {
    return null;
  }
}

export function registerIpc(win: BrowserWindow, getWindow: () => BrowserWindow | null = () => win) {
  // The funding platform has one door of its own (funding/rpc.ts).
  startFundingPlatform(getWindow);

  // These handlers capture this window. Release only our own channels when it
  // closes so macOS can recreate its browser window without duplicate handlers
  // or callbacks pointing at destroyed web contents. Funding RPC stays global.
  const channels = new Set<string>();
  const handle: typeof ipcMain.handle = (channel, listener) => {
    ipcMain.handle(channel, listener);
    channels.add(channel);
  };
  win.once('closed', () => {
    for (const channel of channels) ipcMain.removeHandler(channel);
  });

  // tabs
  handle(IPC.TAB_LIST, () => tabManager.list());
  handle(IPC.TAB_CREATE, (_e, url?: string) => tabManager.create(url));
  handle(IPC.TAB_CLOSE, (_e, id: string) => tabManager.close(id));
  handle(IPC.TAB_SWITCH, (_e, id: string) => tabManager.activate(id));
  handle(IPC.TAB_NAVIGATE, (_e, id: string, url: string) =>
    tabManager.navigate(id, url),
  );
  handle(IPC.TAB_RELOAD, (_e, id: string) => tabManager.reload(id));
  handle(IPC.TAB_BACK, (_e, id: string) => tabManager.back(id));
  handle(IPC.TAB_FORWARD, (_e, id: string) => tabManager.forward(id));
  handle(IPC.TAB_REORDER, (_e, ids: string[]) => tabManager.reorder(ids));

  // layout
  handle(IPC.LAYOUT_SET_BOUNDS, (_e, b: LayoutBounds) => tabManager.setBounds(b));

  // history & bookmarks
  handle(IPC.HISTORY_LIST, (_e, limit?: number) => historyStore.list(limit));
  handle(IPC.HISTORY_CLEAR, () => historyStore.clear());
  handle(IPC.BOOKMARK_LIST, () => bookmarkStore.list());
  handle(IPC.BOOKMARK_ADD, (_e, b: { url: string; title: string }) =>
    bookmarkStore.add(b),
  );
  handle(IPC.BOOKMARK_REMOVE, (_e, id: string) => bookmarkStore.remove(id));

  // settings & secrets
  handle(IPC.SETTINGS_GET, () => getSettings());
  handle(IPC.SETTINGS_SET, (_e, patch: Partial<AppSettings>) => setSettings(patch));
  handle(IPC.UPDATE_GET_STATUS, () => getUpdateStatus());
  handle(IPC.UPDATE_PREPARE, (_e, version: string) => prepareUpdate(version));
  handle(IPC.UPDATE_RETRY, () => retryUpdate());
  handle(IPC.UPDATE_DISMISS, (_e, version: string) => dismissUpdateNotice(version));
  handle(IPC.SECRET_HAS_API_KEY, (_e, provider?: ProviderId) => hasApiKey(provider));
  handle(IPC.SECRET_SET_API_KEY, (_e, key: string, provider?: ProviderId) => setApiKey(key, provider));
  handle(IPC.SECRET_CLEAR_API_KEY, (_e, provider?: ProviderId) => clearApiKey(provider));

  // conversations
  handle(IPC.CONVERSATION_LIST, async () => conversationStore.list(await activeOrganizationId()));
  handle(IPC.CONVERSATION_GET, async (_e, id: string) =>
    conversationStore.get(id, await activeOrganizationId()),
  );
  handle(IPC.CONVERSATION_NEW, async () => conversationStore.create(await activeOrganizationId()));
  handle(IPC.CONVERSATION_DELETE, async (_e, id: string) =>
    conversationStore.delete(id, await activeOrganizationId()),
  );

  // agent
  handle(IPC.AGENT_RUN, (_e, req: AgentRunRequest) => startAgentRun(win, req));
  handle(IPC.AGENT_CANCEL, (_e, runId: string) => cancelAgentRun(runId));
  handle(
    IPC.AGENT_CONFIRM_REPLY,
    (_e, runId: string, id: string, approved: boolean) =>
      replyAgentConfirm(runId, id, approved),
  );
  // Screenshot the active tab for a composer attachment. Reuses the same
  // capturePage the agent's screenshot tool uses.
  handle(IPC.AGENT_CAPTURE, async () => {
    const id = tabManager.getActiveId();
    const view = id ? tabManager.getView(id) : null;
    if (!id || !view) return null;
    return tabManager.withoutBrowsingCloud(id, async () => {
      const image = await view.webContents.capturePage();
      return { pngBase64: image.toPNG().toString('base64'), url: view.webContents.getURL() };
    });
  });

  // session files
  handle(IPC.FILE_PICK, async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Attach files',
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled || result.filePaths.length === 0) return [];
    return sessionFileStore.add(result.filePaths);
  });
  handle(IPC.FILE_LIST, () => sessionFileStore.list());
  handle(IPC.FILE_REMOVE, (_e, id: string) => sessionFileStore.remove(id));

  // projects
  handle(IPC.PROJECT_LIST, async () => projectStore.list(await activeOrganizationId()));
  handle(IPC.PROJECT_GET, async (_e, id: string) => projectStore.get(id, await activeOrganizationId()));
  handle(IPC.PROJECT_CREATE, async (_e, name: string) =>
    projectStore.create(name, await activeOrganizationId()),
  );
  // A project that is not visible under the active organization is treated as missing.
  const ownProject = async (id: string) => projectStore.get(id, await activeOrganizationId()) !== null;
  handle(
    IPC.PROJECT_UPDATE,
    async (_e, id: string, patch: { name?: string; instructions?: string }) =>
      (await ownProject(id)) ? projectStore.update(id, patch) : null,
  );
  handle(IPC.PROJECT_ATTACH_FILES, async (_e, id: string, fileIds: string[]) =>
    (await ownProject(id)) ? projectStore.attachFiles(id, fileIds) : null,
  );
  handle(IPC.PROJECT_DELETE, async (_e, id: string) => {
    if (await ownProject(id)) projectStore.delete(id);
  });

  // voice → local transcription (no API key)
  handle(IPC.VOICE_TRANSCRIBE, (event, audio: Float32Array) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) {
      throw new Error('Voice transcription is only available in the app.');
    }
    return transcribeAudio(audio);
  });
  handle(IPC.VOICE_PREPARE_SPEECH, (event) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) {
      throw new Error('Voice is only available in the app.');
    }
    return prepareSpeech();
  });
  handle(IPC.VOICE_SYNTHESIZE, (event, text: string) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) {
      throw new Error('Voice is only available in the app.');
    }
    return synthesizeAudio(text);
  });
  // Only the app's top-level chrome may connect live voice; website frames
  // cannot use the user's saved key or terminate a session owned by the app.
  handle(IPC.VOICE_CONNECT_REALTIME, (event, offerSdp: string) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) {
      throw new Error('Live voice is only available in the app.');
    }
    return connectRealtimeVoice(event.sender.id, offerSdp);
  });
  handle(IPC.VOICE_DISCONNECT_REALTIME, (event, callId: string) => {
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
  handle(IPC.APP_GET_INFO, (): AppInfo => {
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
  handle(IPC.APP_QUIT, () => app.quit());

  // Chrome is the app interface, never a browsing surface. Reply links and
  // window.open requests belong in the managed web pane, keeping chat intact.
  const openReplyLink = (url: string) => {
    try {
      if (/^mailto:support@bullebrowser\.com$/i.test(url)) {
        void shell.openExternal(url).catch((error) => console.warn('[support] Could not open email:', error));
        return;
      }
      if (!['http:', 'https:'].includes(new URL(url).protocol)) return;
      void tabManager.create(url).catch((error) => console.warn('[tabs] Could not open link:', error));
    } catch {
      // Invalid or non-web destinations cannot replace the app interface.
    }
  };
  win.webContents.setWindowOpenHandler(({ url }) => {
    openReplyLink(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    openReplyLink(url);
  });
}
