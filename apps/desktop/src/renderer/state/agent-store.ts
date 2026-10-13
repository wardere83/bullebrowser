import { create } from 'zustand';
import type { AgentStepEvent } from '../../shared/agent-events.js';
import type {
  AgentConfirmRequest,
  ConversationDetail,
  ConversationSummary,
} from '../../shared/ipc.js';

export interface AgentActivity {
  runId: string | null;
  steps: AgentStepEvent[];
  status: 'idle' | 'running' | 'error';
  currentStep: string;
}

interface AgentStoreState {
  conversations: ConversationSummary[];
  current: ConversationDetail | null;
  runId: string | null;
  steps: AgentStepEvent[];
  status: 'idle' | 'running' | 'error';
  currentStep: string;
  /** The chat that owns the pending/running task, even when History shows another. */
  runConversationId: string | null;
  /** Retained after completion so a late IPC handle cannot restart the same task. */
  activityRunId: string | null;
  retiredRunIds: string[];
  activities: Record<string, AgentActivity>;
  pendingConfirm: AgentConfirmRequest | null;
  setConversations: (c: ConversationSummary[]) => void;
  setCurrent: (c: ConversationDetail | null) => void;
  refreshCurrent: (c: ConversationDetail) => void;
  prepareRun: (conversationId: string) => void;
  startRun: (runId: string, conversationId?: string) => void;
  appendStep: (s: AgentStepEvent, runId?: string) => boolean;
  finishRun: () => void;
  setError: (msg: string) => void;
  setPendingConfirm: (p: AgentConfirmRequest | null) => void;
}

function retireRun(state: AgentStoreState): string[] {
  return state.activityRunId
    ? [...state.retiredRunIds.filter((id) => id !== state.activityRunId), state.activityRunId].slice(-100)
    : state.retiredRunIds;
}

function recordActivity(state: AgentStoreState, patch: Partial<AgentStoreState>): Partial<AgentStoreState> {
  const next = { ...state, ...patch };
  if (!next.runConversationId) return patch;
  return {
    ...patch,
    activities: {
      ...state.activities,
      [next.runConversationId]: {
        runId: next.activityRunId,
        steps: next.steps,
        status: next.status,
        currentStep: next.currentStep,
      },
    },
  };
}

export const useAgentStore = create<AgentStoreState>((set) => ({
  conversations: [],
  current: null,
  runId: null,
  steps: [],
  status: 'idle',
  currentStep: '',
  runConversationId: null,
  activityRunId: null,
  retiredRunIds: [],
  activities: {},
  pendingConfirm: null,
  setConversations: (conversations) => set({ conversations }),
  // Selecting a chat does not stop the task or move its events into that chat.
  setCurrent: (current) => set({ current }),
  prepareRun: (conversationId) => set((state) => recordActivity(state, {
    runId: null,
    activityRunId: null,
    runConversationId: conversationId,
    steps: [],
    status: 'running',
    currentStep: 'Working…',
  })),
  startRun: (runId, conversationId) => set((state) => {
    // Events may reach the renderer before the IPC returns its handle. Keep
    // those events, and never turn an already completed task back on.
    if (state.activityRunId === runId || state.retiredRunIds.includes(runId)) return {};
    if (state.runId && state.runId !== runId) return {};
    const owner = conversationId ?? state.runConversationId ?? state.current?.id ?? null;
    const prepared = state.status === 'running' && state.runConversationId === owner;
    return recordActivity(state, {
      runId,
      activityRunId: runId,
      runConversationId: owner,
      steps: prepared ? state.steps : [],
      status: 'running',
      currentStep: prepared ? state.currentStep : 'Working…',
    });
  }),
  appendStep: (s, runId) => {
    let accepted = false;
    set((state) => {
      if (runId && (state.status !== 'running' || state.retiredRunIds.includes(runId) || (state.runId && state.runId !== runId))) return {};
      accepted = true;
      const next = [...state.steps, s];
      let currentStep = state.currentStep;
      if (s.kind === 'thinking') currentStep = 'Working…';
      if (s.kind === 'tool_call') currentStep = s.detail;
      if (s.kind === 'done') currentStep = '';
      return recordActivity(state, {
        steps: next,
        currentStep,
        ...(runId ? { runId, activityRunId: runId } : {}),
      });
    });
    return accepted;
  },
  finishRun: () => set((state) => recordActivity(state, { status: 'idle', runId: null, currentStep: '', retiredRunIds: retireRun(state) })),
  // An error means the run is over too — clear runId so the chrome
  // doesn't keep a stale handle on the failed run.
  setError: (msg) => set((state) => recordActivity(state, { status: 'error', currentStep: msg, runId: null, retiredRunIds: retireRun(state) })),
  // Refresh the current conversation in place — used when a run finishes
  // and we want to pull in the assistant's saved reply without resetting
  // the step feed / status the way setCurrent does.
  refreshCurrent: (current) => set({ current }),
  setPendingConfirm: (pendingConfirm) => set({ pendingConfirm }),
}));
