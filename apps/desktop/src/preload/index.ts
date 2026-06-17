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
    hasApiKey: () => ipcRenderer.invoke(IPC.SECRET_HAS_API_KEY),
    setApiKey: (k) => ipcRenderer.invoke(IPC.SECRET_SET_API_KEY, k),
    clearApiKey: () => ipcRenderer.invoke(IPC.SECRET_CLEAR_API_KEY),
  },
  conversations: {
    list: () => ipcRenderer.invoke(IPC.CONVERSATION_LIST),
    get: (id) => ipcRenderer.invoke(IPC.CONVERSATION_GET, id),
    new: () => ipcRenderer.invoke(IPC.CONVERSATION_NEW),
    delete: (id) => ipcRenderer.invoke(IPC.CONVERSATION_DELETE, id),
  },
  agent: {
    run: (req: AgentRunRequest) => ipcRenderer.invoke(IPC.AGENT_RUN, req),
    cancel: (runId) => ipcRenderer.invoke(IPC.AGENT_CANCEL, runId),
    onStep: (cb) => subscribe(IPC.AGENT_STEP, cb),
    onConfirmRequest: (cb) => subscribe(IPC.AGENT_CONFIRM_REQUEST, cb),
    replyConfirm: (runId, id, approved) =>
      ipcRenderer.invoke(IPC.AGENT_CONFIRM_REPLY, runId, id, approved),
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
