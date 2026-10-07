import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import type { AgentInput } from '@bullebrowser/agent-core';
import { IPC, type AgentResultEvent, type AgentRunRequest } from '../../shared/ipc.js';

const mocks = vi.hoisted(() => ({
  runAgent: vi.fn<(input: AgentInput) => Promise<string>>(),
  appendMessage: vi.fn(),
  conversation: { id: 'conversation-1', messages: [] },
  setBrowsingActivity: vi.fn(),
  clearBrowsingActivity: vi.fn(),
  pageActivity: vi.fn<(tabId: string) => void>(),
}));

vi.mock('@bullebrowser/agent-core', () => ({
  DEFAULT_MODEL: 'gpt-4o',
  FUNDING_RULES: 'Rules for funding work.',
  FUNDING_WORKFLOW_IDS: ['find_opportunities', 'assess_alignment', 'funder_priorities', 'proposal_guide'],
  findSkill: () => undefined,
  providerFor: () => 'openai',
  runAgent: mocks.runAgent,
}));
vi.mock('../storage/conversations.js', () => ({
  conversationStore: { get: () => mocks.conversation, appendMessage: mocks.appendMessage, bind: () => true },
}));
vi.mock('../funding/platform.js', () => ({ fundingPlatform: () => null }));
vi.mock('../identity/service.js', () => ({ identityService: {} }));
vi.mock('../funding/grounding.js', () => ({
  groundChat: async () => ({
    organizationId: null,
    referenceContext: [],
    tools: [],
    systemNote: "Today's date on the user's device is 2026-10-06.",
  }),
}));
vi.mock('../storage/session-files.js', () => ({ sessionFileStore: {} }));
vi.mock('../storage/projects.js', () => ({ projectStore: {} }));
vi.mock('../storage/secrets.js', () => ({ getApiKey: () => 'test-api-key' }));
vi.mock('../storage/settings.js', () => ({ getSettings: () => ({ defaultModel: 'gpt-4o', stepBudget: 40 }) }));
vi.mock('../tabs/manager.js', () => ({ tabManager: {
  getActiveId: () => 'tab-1',
  setBrowsingActivity: mocks.setBrowsingActivity,
  clearBrowsingActivity: mocks.clearBrowsingActivity,
} }));
vi.mock('./runtime.js', () => ({ DesktopToolRuntime: class {
  constructor(_confirm: unknown, activity: (tabId: string) => void) {
    mocks.pageActivity.mockImplementation(activity);
  }
} }));
vi.mock('./attachments.js', () => ({ buildAttachmentAppendix: () => '' }));

const { startAgentRun, cancelAgentRun } = await import('./run.js');

const request: AgentRunRequest = {
  conversationId: 'conversation-1',
  userMessage: 'Summarize the page.',
  model: 'gpt-4o',
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.conversation.messages = [];
});

async function runTask() {
  const send = vi.fn();
  const win = { webContents: { send } } as unknown as BrowserWindow;
  const handle = await startAgentRun(win, request);
  await vi.waitFor(() => expect(send.mock.calls.some(([channel]) => channel === IPC.AGENT_RESULT)).toBe(true));
  const result = send.mock.calls.find(([channel]) => channel === IPC.AGENT_RESULT)![1] as AgentResultEvent;
  return { send, result, handle };
}

describe('agent task results for live voice', () => {
  it('publishes the complete saved answer before signaling terminal completion', async () => {
    mocks.runAgent.mockImplementation(async (input) => {
      mocks.pageActivity('tab-1');
      input.onStep({ type: 'text', detail: 'An interim finding.' });
      input.onStep({ type: 'text', detail: 'The concluding answer.' });
      input.onStep({ type: 'done' });
      return 'An interim finding. The concluding answer.';
    });
    const { send, result, handle } = await runTask();
    expect(mocks.setBrowsingActivity).toHaveBeenCalledWith(handle.runId, 'tab-1');
    expect(mocks.clearBrowsingActivity).toHaveBeenCalledWith(handle.runId);
    expect(result).toEqual({
      runId: handle.runId,
      conversationId: request.conversationId,
      status: 'completed',
      text: 'An interim finding. The concluding answer.',
    });
    expect(mocks.appendMessage).toHaveBeenLastCalledWith(request.conversationId, expect.objectContaining({
      role: 'assistant', content: result.text,
    }));
    const terminalIndex = send.mock.calls.findIndex(([channel, event]) => channel === IPC.AGENT_STEP && event.step.kind === 'done');
    expect(send.mock.calls.filter(([channel, event]) => channel === IPC.AGENT_STEP && event.step.kind === 'done')).toHaveLength(1);
    const savedOrder = mocks.appendMessage.mock.invocationCallOrder.at(-1)!;
    expect(savedOrder).toBeLessThan(send.mock.invocationCallOrder[terminalIndex]!);
    expect(send.mock.invocationCallOrder[terminalIndex]!).toBeLessThan(send.mock.invocationCallOrder.at(-1)!);
  });

  it('returns a run failure and preserves partial work without treating it as success', async () => {
    mocks.runAgent.mockImplementation(async (input) => {
      mocks.pageActivity('tab-1');
      input.onStep({ type: 'text', detail: 'One source was read.' });
      throw new Error('Network connection failed.');
    });
    const { send, result, handle } = await runTask();
    expect(mocks.clearBrowsingActivity).toHaveBeenCalledWith(handle.runId);
    expect(result.status).toBe('failed');
    expect(result.text).toContain('One source was read.');
    expect(result.error).toBeTruthy();
    expect(send.mock.calls.some(([channel, event]) => channel === IPC.AGENT_STEP && event.step.kind === 'error' && !event.step.toolName)).toBe(true);
    expect(mocks.appendMessage).toHaveBeenLastCalledWith(request.conversationId, expect.objectContaining({ role: 'assistant', content: result.text }));
  });

  it('reports a stopped task as cancelled, including the partial answer', async () => {
    mocks.runAgent.mockImplementation(async (input) => {
      input.onStep({ type: 'text', detail: 'The first page was checked.' });
      const error = new Error('The operation was aborted.');
      error.name = 'AbortError';
      throw error;
    });
    const { result } = await runTask();
    expect(result).toMatchObject({ status: 'cancelled', text: 'The first page was checked.\n\n_(Stopped.)_' });
    expect(result.error).toBeUndefined();
  });

  it('clears browsing immediately on Stop and ignores page activity from a late operation', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    mocks.runAgent.mockImplementation(async () => {
      mocks.pageActivity('tab-1');
      await gate;
      mocks.pageActivity('tab-2');
      throw new Error('cancelled');
    });
    const send = vi.fn();
    const handle = await startAgentRun({ webContents: { send } } as unknown as BrowserWindow, request);
    expect(mocks.setBrowsingActivity).toHaveBeenCalledTimes(1);
    cancelAgentRun(handle.runId);
    expect(mocks.clearBrowsingActivity).toHaveBeenCalledWith(handle.runId);
    release();
    await vi.waitFor(() => expect(send.mock.calls.some(([channel]) => channel === IPC.AGENT_RESULT)).toBe(true));
    expect(mocks.setBrowsingActivity).toHaveBeenCalledTimes(1);
    expect(mocks.clearBrowsingActivity).toHaveBeenCalledTimes(2);
  });

  it('still settles the voice tool when saving the answer fails', async () => {
    mocks.runAgent.mockResolvedValue('The final answer.');
    mocks.appendMessage.mockImplementation((_id, message) => {
      if (message.role === 'assistant') throw new Error('Storage is unavailable.');
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { result } = await runTask();
      expect(result).toMatchObject({
        status: 'failed', text: 'The final answer.', error: 'The task finished, but its answer could not be saved.',
      });
    } finally {
      log.mockRestore();
    }
  });
});
