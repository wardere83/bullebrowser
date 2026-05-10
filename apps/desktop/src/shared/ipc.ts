// Single source of truth for IPC channel names and the typed bridge
// surface. Both the preload script and the renderer consume this so we
// never duplicate string literals across processes.

import type { ClaudeModelId } from '@bullebrowser/agent-core';
import type { AgentStepEvent } from './agent-events.js';

export const IPC = {
  // Tabs
  TAB_LIST: 'tab:list',
  TAB_CREATE: 'tab:create',
  TAB_CLOSE: 'tab:close',
  TAB_SWITCH: 'tab:switch',
  TAB_NAVIGATE: 'tab:navigate',
  TAB_RELOAD: 'tab:reload',
  TAB_BACK: 'tab:back',
  TAB_FORWARD: 'tab:forward',
  TAB_REORDER: 'tab:reorder',
  TAB_UPDATED: 'tab:updated', // main → renderer broadcast
  // Layout
  LAYOUT_SET_BOUNDS: 'layout:set-bounds',
  // History / bookmarks
  HISTORY_LIST: 'history:list',
  HISTORY_CLEAR: 'history:clear',
  BOOKMARK_LIST: 'bookmark:list',
  BOOKMARK_ADD: 'bookmark:add',
  BOOKMARK_REMOVE: 'bookmark:remove',
  // Settings / secrets
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SECRET_HAS_API_KEY: 'secret:has-api-key',
  SECRET_SET_API_KEY: 'secret:set-api-key',
  SECRET_CLEAR_API_KEY: 'secret:clear-api-key',
  // Agent
  AGENT_RUN: 'agent:run',
  AGENT_CANCEL: 'agent:cancel',
  AGENT_STEP: 'agent:step', // main → renderer stream
  AGENT_CONFIRM_REQUEST: 'agent:confirm-request', // main → renderer
  AGENT_CONFIRM_REPLY: 'agent:confirm-reply',
  // Conversations
  CONVERSATION_LIST: 'conversation:list',
  CONVERSATION_GET: 'conversation:get',
  CONVERSATION_NEW: 'conversation:new',
  CONVERSATION_DELETE: 'conversation:delete',
  // App
  APP_GET_INFO: 'app:get-info',
  APP_QUIT: 'app:quit',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

export interface TabState {
  id: string;
  title: string;
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  faviconUrl?: string;
  active: boolean;
}

export interface LayoutBounds {
  topInset: number; // pixels reserved at the top for chrome
  rightInset: number; // pixels reserved on the right for the AI panel (0 when closed)
}

export interface AppSettings {
  defaultModel: ClaudeModelId;
  aiPanelOpen: boolean;
  searchProvider: 'duckduckgo' | 'google' | 'bing';
  homepageUrl: string;
  complianceChecklist: string[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultModel: 'claude-opus-4-7',
  aiPanelOpen: false,
  searchProvider: 'duckduckgo',
  homepageUrl: 'https://duckduckgo.com',
  complianceChecklist: [
    'EEO: Equal Employment Opportunity references and required language',
    'FERPA: Family Educational Rights and Privacy Act references',
    'ADA: Americans with Disabilities Act and accessibility obligations',
  ],
};

export interface HistoryEntry {
  url: string;
  title: string;
  visitedAt: number;
}

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  addedAt: number;
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface ConversationDetail extends ConversationSummary {
  messages: { role: 'user' | 'assistant'; content: string; timestamp: number }[];
}

export interface AgentRunRequest {
  conversationId: string;
  userMessage: string;
  model: ClaudeModelId;
  skillId?: string;
}

export interface AppInfo {
  name: string;
  version: string;
  electronVersion: string; // shown only on the About page
  chromeVersion: string; // shown only on the About page
  platform: NodeJS.Platform;
  thirdPartyNotices: { name: string; version: string; license: string }[];
}

// The shape exposed by preload as window.bullebrowser
export interface BrowserBridge {
  tabs: {
    list(): Promise<TabState[]>;
    create(url?: string): Promise<TabState>;
    close(id: string): Promise<void>;
    switch(id: string): Promise<void>;
    navigate(id: string, url: string): Promise<void>;
    reload(id: string): Promise<void>;
    back(id: string): Promise<void>;
    forward(id: string): Promise<void>;
    reorder(orderedIds: string[]): Promise<void>;
    onUpdated(cb: (tabs: TabState[]) => void): () => void;
  };
  layout: {
    setBounds(bounds: LayoutBounds): Promise<void>;
  };
  history: {
    list(limit?: number): Promise<HistoryEntry[]>;
    clear(): Promise<void>;
  };
  bookmarks: {
    list(): Promise<Bookmark[]>;
    add(b: { url: string; title: string }): Promise<Bookmark>;
    remove(id: string): Promise<void>;
  };
  settings: {
    get(): Promise<AppSettings>;
    set(patch: Partial<AppSettings>): Promise<AppSettings>;
  };
  secrets: {
    hasApiKey(): Promise<boolean>;
    setApiKey(key: string): Promise<void>;
    clearApiKey(): Promise<void>;
  };
  conversations: {
    list(): Promise<ConversationSummary[]>;
    get(id: string): Promise<ConversationDetail | null>;
    new(): Promise<ConversationDetail>;
    delete(id: string): Promise<void>;
  };
  agent: {
    run(req: AgentRunRequest): Promise<{ runId: string }>;
    cancel(runId: string): Promise<void>;
    onStep(
      cb: (event: { runId: string; step: AgentStepEvent }) => void,
    ): () => void;
    onConfirmRequest(
      cb: (event: { runId: string; id: string; message: string }) => void,
    ): () => void;
    replyConfirm(runId: string, id: string, approved: boolean): Promise<void>;
  };
  app: {
    info(): Promise<AppInfo>;
    quit(): Promise<void>;
  };
}

declare global {
  interface Window {
    bullebrowser: BrowserBridge;
  }
}
