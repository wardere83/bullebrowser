import { create } from 'zustand';
import type { AgentStepEvent } from '../../shared/agent-events.js';
import type {
  AgentConfirmRequest,
  ConversationDetail,
  ConversationSummary,
} from '../../shared/ipc.js';

interface AgentStoreState {
  conversations: ConversationSummary[];
  current: ConversationDetail | null;
  runId: string | null;
  steps: AgentStepEvent[];
  status: 'idle' | 'running' | 'error';
  currentStep: string;
  pendingConfirm: AgentConfirmRequest | null;
  setConversations: (c: ConversationSummary[]) => void;
  setCurrent: (c: ConversationDetail | null) => void;
  refreshCurrent: (c: ConversationDetail) => void;
  startRun: (runId: string) => void;
  appendStep: (s: AgentStepEvent) => void;
  finishRun: () => void;
  setError: (msg: string) => void;
  setPendingConfirm: (p: AgentConfirmRequest | null) => void;
}

export const useAgentStore = create<AgentStoreState>((set) => ({
  conversations: [],
  current: null,
  runId: null,
  steps: [],
  status: 'idle',
  currentStep: '',
  pendingConfirm: null,
  setConversations: (conversations) => set({ conversations }),
  setCurrent: (current) => set({ current, runId: null, pendingConfirm: null, steps: [], status: 'idle' }),
  startRun: (runId) =>
    set({ runId, steps: [], status: 'running', currentStep: 'Thinking…' }),
  appendStep: (s) =>
    set((state) => {
      const next = [...state.steps, s];
      let currentStep = state.currentStep;
      if (s.kind === 'thinking') currentStep = 'Thinking…';
      if (s.kind === 'tool_call') currentStep = s.detail;
      if (s.kind === 'done') currentStep = '';
      return { steps: next, currentStep };
    }),
  finishRun: () => set({ status: 'idle', runId: null, pendingConfirm: null, currentStep: '' }),
  // An error means the run is over too — clear runId so the chrome
  // doesn't keep a stale handle on the failed run.
  setError: (msg) => set({ status: 'error', currentStep: msg, runId: null, pendingConfirm: null }),
  // Refresh the current conversation in place — used when a run finishes
  // and we want to pull in the assistant's saved reply without resetting
  // the step feed / status the way setCurrent does.
  refreshCurrent: (current) => set({ current }),
  setPendingConfirm: (pendingConfirm) => set({ pendingConfirm }),
}));
