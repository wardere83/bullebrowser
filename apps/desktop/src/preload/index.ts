// Preload bridge. Exposes the typed BrowserBridge surface to the
// renderer via contextBridge — no Node, no Electron globals leak.

import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  type AgentRunRequest,
  type AppSettings,
  type BrowserBridge,
} from '../shared/ipc.js';

const subscribe = <T>(channel: string, cb: (payload: T) => void) => {
  const handler = (_e: unknown, payload: T) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
};

const bridge: BrowserBridge = {
  tabs: {
    list: () => ipcRenderer.invoke(IPC.TAB_LIST),
    create: (url) => ipcRenderer.invoke(IPC.TAB_CREATE, url),
    close: (id) => ipcRenderer.invoke(IPC.TAB_CLOSE, id),
    switch: (id) => ipcRenderer.invoke(IPC.TAB_SWITCH, id),
    navigate: (id, url) => ipcRenderer.invoke(IPC.TAB_NAVIGATE, id, url),
    reload: (id) => ipcRenderer.invoke(IPC.TAB_RELOAD, id),
    back: (id) => ipcRenderer.invoke(IPC.TAB_BACK, id),
    forward: (id) => ipcRenderer.invoke(IPC.TAB_FORWARD, id),
    reorder: (ids) => ipcRenderer.invoke(IPC.TAB_REORDER, ids),
    onUpdated: (cb) => subscribe(IPC.TAB_UPDATED, cb),
  },
  layout: {
    setBounds: (b) => ipcRenderer.invoke(IPC.LAYOUT_SET_BOUNDS, b),
  },
  history: {
    list: (limit) => ipcRenderer.invoke(IPC.HISTORY_LIST, limit),
    clear: () => ipcRenderer.invoke(IPC.HISTORY_CLEAR),
  },
  bookmarks: {
    list: () => ipcRenderer.invoke(IPC.BOOKMARK_LIST),
    add: (b) => ipcRenderer.invoke(IPC.BOOKMARK_ADD, b),
    remove: (id) => ipcRenderer.invoke(IPC.BOOKMARK_REMOVE, id),
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
    set: (patch: Partial<AppSettings>) => ipcRenderer.invoke(IPC.SETTINGS_SET, patch),
  },
  secrets: {
    hasApiKey: (p) => ipcRenderer.invoke(IPC.SECRET_HAS_API_KEY, p),
    setApiKey: (k, p) => ipcRenderer.invoke(IPC.SECRET_SET_API_KEY, k, p),
    clearApiKey: (p) => ipcRenderer.invoke(IPC.SECRET_CLEAR_API_KEY, p),
  },
  conversations: {
    list: () => ipcRenderer.invoke(IPC.CONVERSATION_LIST),
    get: (id) => ipcRenderer.invoke(IPC.CONVERSATION_GET, id),
    create: () => ipcRenderer.invoke(IPC.CONVERSATION_NEW),
    delete: (id) => ipcRenderer.invoke(IPC.CONVERSATION_DELETE, id),
  },
  agent: {
    run: (req: AgentRunRequest) => ipcRenderer.invoke(IPC.AGENT_RUN, req),
    cancel: (runId) => ipcRenderer.invoke(IPC.AGENT_CANCEL, runId),
    onStep: (cb) => subscribe(IPC.AGENT_STEP, cb),
    onResult: (cb) => subscribe(IPC.AGENT_RESULT, cb),
    onConfirmRequest: (cb) => subscribe(IPC.AGENT_CONFIRM_REQUEST, cb),
    replyConfirm: (runId, id, approved) =>
      ipcRenderer.invoke(IPC.AGENT_CONFIRM_REPLY, runId, id, approved),
    captureScreenshot: () => ipcRenderer.invoke(IPC.AGENT_CAPTURE),
  },
  files: {
    pick: () => ipcRenderer.invoke(IPC.FILE_PICK),
    list: () => ipcRenderer.invoke(IPC.FILE_LIST),
    remove: (id) => ipcRenderer.invoke(IPC.FILE_REMOVE, id),
  },
  projects: {
    list: () => ipcRenderer.invoke(IPC.PROJECT_LIST),
    get: (id) => ipcRenderer.invoke(IPC.PROJECT_GET, id),
    create: (name) => ipcRenderer.invoke(IPC.PROJECT_CREATE, name),
    update: (id, patch) => ipcRenderer.invoke(IPC.PROJECT_UPDATE, id, patch),
    attachFiles: (id, fileIds) => ipcRenderer.invoke(IPC.PROJECT_ATTACH_FILES, id, fileIds),
    delete: (id) => ipcRenderer.invoke(IPC.PROJECT_DELETE, id),
  },
  voice: {
    transcribe: (audio) => ipcRenderer.invoke(IPC.VOICE_TRANSCRIBE, audio),
    connectRealtime: (offerSdp) => ipcRenderer.invoke(IPC.VOICE_CONNECT_REALTIME, offerSdp),
    disconnectRealtime: (callId) => ipcRenderer.invoke(IPC.VOICE_DISCONNECT_REALTIME, callId),
  },
  updates: {
    status: () => ipcRenderer.invoke(IPC.UPDATE_GET_STATUS),
    onStatus: (cb) => subscribe(IPC.UPDATE_STATUS, cb),
    install: () => ipcRenderer.invoke(IPC.UPDATE_INSTALL),
  },
  app: {
    info: () => ipcRenderer.invoke(IPC.APP_GET_INFO),
    quit: () => ipcRenderer.invoke(IPC.APP_QUIT),
  },
  ui: {
    onAskAgent: (cb) => subscribe(IPC.UI_ASK_AGENT, cb),
  },
};

contextBridge.exposeInMainWorld('bullebrowser', bridge);
