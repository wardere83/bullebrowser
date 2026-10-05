// Single source of truth for IPC channel names and the typed bridge
// surface. Both the preload script and the renderer consume this so we
// never duplicate string literals across processes.

import type { ModelId, ProviderId } from '@bullebrowser/agent-core';
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
  AGENT_RESULT: 'agent:result', // main → renderer final task result
  AGENT_CONFIRM_REQUEST: 'agent:confirm-request', // main → renderer
  AGENT_CONFIRM_REPLY: 'agent:confirm-reply',
  AGENT_CAPTURE: 'agent:capture', // screenshot the active tab for an attachment
  // Attachments — session files, projects, voice
  FILE_PICK: 'file:pick',
  FILE_LIST: 'file:list',
  FILE_REMOVE: 'file:remove',
  PROJECT_LIST: 'project:list',
  PROJECT_GET: 'project:get',
  PROJECT_CREATE: 'project:create',
  PROJECT_UPDATE: 'project:update',
  PROJECT_ATTACH_FILES: 'project:attach-files',
  PROJECT_DELETE: 'project:delete',
  VOICE_TRANSCRIBE: 'voice:transcribe',
  VOICE_CONNECT_REALTIME: 'voice:connect-realtime',
  VOICE_DISCONNECT_REALTIME: 'voice:disconnect-realtime',
  // Conversations
  CONVERSATION_LIST: 'conversation:list',
  CONVERSATION_GET: 'conversation:get',
  CONVERSATION_NEW: 'conversation:new',
  CONVERSATION_DELETE: 'conversation:delete',
  // App
  APP_GET_INFO: 'app:get-info',
  APP_QUIT: 'app:quit',
  // Updates
  UPDATE_STATUS: 'update:status', // main → renderer
  UPDATE_GET_STATUS: 'update:get-status',
  UPDATE_INSTALL: 'update:install',
  // UI events from main → renderer
  UI_ASK_AGENT: 'ui:ask-agent', // right-click context menu hands a prompt to the AI panel
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

// Two very different asks share one channel, so the renderer needs to tell
// them apart: `browse_access` is the once-per-task "may I drive your browser?"
// prompt shown inline in the chat, while `destructive` is the per-action
// warning (submitting, purchasing, deleting) shown as a modal.
export interface AgentConfirmRequest {
  runId: string;
  id: string;
  message: string;
  kind: 'browse_access' | 'destructive';
}

export interface AgentResultEvent {
  runId: string;
  conversationId: string;
  status: 'completed' | 'failed' | 'cancelled';
  text: string;
  error?: string;
}

// Where an update has got to. `version` is the version being offered, which is
// what the "Relaunch to update" button names — a bare "an update is ready" tells
// the user nothing about what they're getting.
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'downloading'; version: string }
  | { state: 'ready'; version: string };

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
  defaultModel: ModelId;
  aiPanelOpen: boolean;
  searchProvider: 'bullebrowser' | 'google' | 'bing';
  homepageUrl: string;
  complianceChecklist: string[];
  /** Press the least-permissive option on common cookie banners. */
  autoDismissConsent: boolean;
  /** Default step budget per agent task (weighted; raise per task). */
  stepBudget: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultModel: 'claude-opus-4-7',
  aiPanelOpen: true,
  searchProvider: 'bullebrowser',
  homepageUrl: 'about:blank',
  autoDismissConsent: true,
  stepBudget: 40,
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

// A file the user uploaded into the current session. Bytes live under
// userData/session-files; this is the metadata the UI and agent see. Files are
// swept 8 days after upload — retention is enforced in the store, and
// `expiresAt` is surfaced so the UI can say so.
export interface SessionFile {
  id: string;
  name: string;
  mime: string;
  sizeBytes: number;
  addedAt: number;
  expiresAt: number; // addedAt + 8 days
  // Whether we could read it as text for agent context. Binary files (images,
  // archives) still upload and attach, but carry no inline excerpt.
  isText: boolean;
}

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  fileCount: number;
}

export interface ProjectDetail extends ProjectSummary {
  // Standing instructions the agent should treat as always-on context for any
  // task run "in" this project.
  instructions: string;
  fileIds: string[];
}

// What the user attached to a single run. The renderer sends only references
// (ids/urls); main resolves the actual content when it enriches the prompt, so
// large file text never rides the IPC round-trip twice.
export type RunAttachment =
  | { kind: 'file'; fileId: string; name: string }
  | { kind: 'project'; projectId: string; name: string }
  | { kind: 'screenshot'; url: string };

export interface AgentRunRequest {
  conversationId: string;
  userMessage: string;
  model: ModelId;
  skillId?: string;
  // Optional context the user attached via the "+" menu. Additive: an empty or
  // absent list runs exactly as before.
  attachments?: RunAttachment[];
  /** Step budget for this task; defaults to the Settings value. */
  budget?: number;
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
    hasApiKey(provider?: ProviderId): Promise<boolean>;
    setApiKey(key: string, provider?: ProviderId): Promise<void>;
    clearApiKey(provider?: ProviderId): Promise<void>;
  };
  conversations: {
    list(): Promise<ConversationSummary[]>;
    get(id: string): Promise<ConversationDetail | null>;
    create(): Promise<ConversationDetail>;
    delete(id: string): Promise<void>;
  };
  agent: {
    run(req: AgentRunRequest): Promise<{ runId: string }>;
    cancel(runId: string): Promise<void>;
    onStep(
      cb: (event: { runId: string; step: AgentStepEvent }) => void,
    ): () => void;
    onResult(cb: (event: AgentResultEvent) => void): () => void;
    onConfirmRequest(cb: (event: AgentConfirmRequest) => void): () => void;
    replyConfirm(runId: string, id: string, approved: boolean): Promise<void>;
    // Capture the active tab as a PNG so the composer can show a thumbnail and
    // attach it to the next run. Null when there's no capturable tab.
    captureScreenshot(): Promise<{ pngBase64: string; url: string } | null>;
  };
  files: {
    // Opens a native file picker; returns the files added to the session.
    pick(): Promise<SessionFile[]>;
    list(): Promise<SessionFile[]>;
    remove(id: string): Promise<void>;
  };
  projects: {
    list(): Promise<ProjectSummary[]>;
    get(id: string): Promise<ProjectDetail | null>;
    create(name: string): Promise<ProjectDetail>;
    update(id: string, patch: { name?: string; instructions?: string }): Promise<ProjectDetail | null>;
    attachFiles(id: string, fileIds: string[]): Promise<ProjectDetail | null>;
    delete(id: string): Promise<void>;
  };
  voice: {
    // Local Whisper transcription of mono 16 kHz PCM. No API key needed.
    transcribe(audio: Float32Array): Promise<{ text: string }>;
    // Main exchanges WebRTC SDP using the saved key; credentials stay in main.
    connectRealtime(offerSdp: string): Promise<{ answerSdp: string; callId: string }>;
    disconnectRealtime(callId: string): Promise<void>;
  };
  app: {
    info(): Promise<AppInfo>;
    quit(): Promise<void>;
  };
  updates: {
    status(): Promise<UpdateStatus>;
    onStatus(cb: (status: UpdateStatus) => void): () => void;
    install(): Promise<void>;
  };
  ui: {
    onAskAgent(cb: (prompt: string) => void): () => void;
  };
}

declare global {
  interface Window {
    bullebrowser: BrowserBridge;
  }
}
