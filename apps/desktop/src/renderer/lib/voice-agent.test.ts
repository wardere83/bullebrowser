import { describe, expect, it, vi } from 'vitest';
import type { AgentResultEvent, AgentRunRequest, BrowserBridge, ConversationDetail } from '../../shared/ipc.js';
import { refreshVoiceConversation, runVoiceBrowserTask } from './voice-agent.js';

const request: AgentRunRequest = {
  conversationId: 'conversation-1',
  userMessage: 'Read the current page.',
  model: 'gpt-4o',
};

function fixture() {
  const listeners = new Set<(event: AgentResultEvent) => void>();
  const unsubscribe = vi.fn();
  const run = vi.fn(async () => ({ runId: 'voice-run' }));
  const cancel = vi.fn(async () => {});
  const agent = {
    run,
    cancel,
    onResult: (listener: (event: AgentResultEvent) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        unsubscribe();
      };
    },
  } as unknown as BrowserBridge['agent'];
  const emit = (event: Partial<AgentResultEvent> = {}) => {
    for (const listener of listeners) listener({
      runId: 'voice-run',
      conversationId: request.conversationId,
      status: 'completed',
      text: 'The page explains the grant requirements.',
      ...event,
    });
  };
  return { bridge: { agent }, run, cancel, emit, listeners, unsubscribe };
}

describe('runVoiceBrowserTask', () => {
  it('waits for the matching final result, rather than the initial run handle', async () => {
    const f = fixture();
    const controller = new AbortController();
    const started = vi.fn();
    const task = runVoiceBrowserTask(f.bridge, request, controller.signal, started);
    await Promise.resolve();
    expect(started).toHaveBeenCalledWith('voice-run');
    expect(f.listeners.size).toBe(1);
    f.emit({ runId: 'another-run', text: 'Wrong answer' });
    f.emit({ conversationId: 'another-conversation', text: 'Wrong conversation' });
    expect(f.listeners.size).toBe(1);
    f.emit();
    await expect(task).resolves.toMatchObject({ status: 'completed', text: 'The page explains the grant requirements.' });
    expect(f.listeners.size).toBe(0);
    controller.abort();
    expect(f.cancel).not.toHaveBeenCalled();
  });

  it('buffers a result arriving before the run handle without marking a finished run active', async () => {
    const f = fixture();
    f.run.mockImplementation(async () => {
      expect(f.listeners.size).toBe(1);
      f.emit({ runId: 'unrelated-run' });
      f.emit({ status: 'failed', text: '', error: 'The key was rejected.' });
      return { runId: 'voice-run' };
    });
    const started = vi.fn();
    const task = runVoiceBrowserTask(f.bridge, request, new AbortController().signal, started);
    await expect(task).resolves.toMatchObject({ status: 'failed', error: 'The key was rejected.' });
    expect(started).not.toHaveBeenCalled();
    expect(f.listeners.size).toBe(0);
  });

  it('does not start a run when the voice session was already stopped', async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(runVoiceBrowserTask(f.bridge, request, controller.signal)).resolves.toMatchObject({ status: 'cancelled' });
    expect(f.run).not.toHaveBeenCalled();
    expect(f.cancel).not.toHaveBeenCalled();
    expect(f.listeners.size).toBe(0);
  });

  it('stops only its own active run when the voice session closes', async () => {
    const f = fixture();
    const controller = new AbortController();
    const task = runVoiceBrowserTask(f.bridge, request, controller.signal);
    await Promise.resolve();
    controller.abort();
    await expect(task).resolves.toMatchObject({ status: 'cancelled' });
    expect(f.cancel).toHaveBeenCalledExactlyOnceWith('voice-run');
    expect(f.listeners.size).toBe(0);
    f.emit();
    expect(f.cancel).toHaveBeenCalledTimes(1);
  });

  it('waits for a pending handle to cancel the correct run after an early stop', async () => {
    const f = fixture();
    let deliverHandle!: (handle: { runId: string }) => void;
    f.run.mockImplementation(() => new Promise((resolve) => { deliverHandle = resolve; }));
    const controller = new AbortController();
    const started = vi.fn();
    const task = runVoiceBrowserTask(f.bridge, request, controller.signal, started);
    controller.abort();
    expect(f.listeners.size).toBe(0);
    expect(f.cancel).not.toHaveBeenCalled();
    deliverHandle({ runId: 'late-voice-run' });
    await expect(task).resolves.toMatchObject({ status: 'cancelled' });
    expect(f.cancel).toHaveBeenCalledExactlyOnceWith('late-voice-run');
    expect(started).not.toHaveBeenCalled();
  });

  it('returns startup errors and releases its subscription', async () => {
    const f = fixture();
    f.run.mockRejectedValue(new Error('Conversation not found'));
    await expect(runVoiceBrowserTask(f.bridge, request, new AbortController().signal)).resolves.toMatchObject({
      status: 'failed', error: 'Conversation not found',
    });
    expect(f.listeners.size).toBe(0);
    expect(f.cancel).not.toHaveBeenCalled();
  });

  it('keeps cancellation distinct from successful completion', async () => {
    const f = fixture();
    const task = runVoiceBrowserTask(f.bridge, request, new AbortController().signal);
    await Promise.resolve();
    f.emit({ status: 'cancelled', text: 'Partial research. (Stopped.)' });
    await expect(task).resolves.toMatchObject({ status: 'cancelled', text: 'Partial research. (Stopped.)' });
  });
});

describe('refreshVoiceConversation', () => {
  const conversation = (): ConversationDetail => ({
    id: request.conversationId,
    title: 'Voice task',
    createdAt: 1,
    updatedAt: 1,
    messageCount: 1,
    messages: [{ role: 'user', content: request.userMessage, timestamp: 1 }],
  });

  it('shows the saved full answer after an early voice result', async () => {
    const current = conversation();
    const saved: ConversationDetail = {
      ...current,
      messages: [...current.messages, { role: 'assistant', content: 'The complete answer.', timestamp: 2 }],
    };
    const get = vi.fn(async () => saved);
    const refresh = vi.fn();
    await refreshVoiceConversation({ conversations: { get } } as unknown as BrowserBridge, current.id, {
      current: () => current, refresh,
    });
    expect(get).toHaveBeenCalledWith(current.id);
    expect(refresh).toHaveBeenCalledExactlyOnceWith(saved);
  });

  it('does not overwrite another chat selected while the refresh is pending', async () => {
    let current = conversation();
    const previous = current;
    let resolveRead!: (saved: ConversationDetail) => void;
    const get = vi.fn(() => new Promise<ConversationDetail>((resolve) => { resolveRead = resolve; }));
    const refresh = vi.fn();
    const task = refreshVoiceConversation({ conversations: { get } } as unknown as BrowserBridge, previous.id, {
      current: () => current, refresh,
    });
    current = { ...current, id: 'another-chat' };
    resolveRead(previous);
    await task;
    expect(refresh).not.toHaveBeenCalled();
  });

  it('preserves a newer optimistic prompt in the same chat', async () => {
    let current = conversation();
    const previous = current;
    let resolveRead!: (saved: ConversationDetail) => void;
    const get = vi.fn(() => new Promise<ConversationDetail>((resolve) => { resolveRead = resolve; }));
    const refresh = vi.fn();
    const task = refreshVoiceConversation({ conversations: { get } } as unknown as BrowserBridge, previous.id, {
      current: () => current, refresh,
    });
    current = {
      ...current,
      messages: [...current.messages, { role: 'user', content: 'My next task.', timestamp: 3 }],
    };
    resolveRead(previous);
    await task;
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not turn a failed refresh into a failed voice task', async () => {
    const current = conversation();
    const get = vi.fn(async () => { throw new Error('Read failed'); });
    const refresh = vi.fn();
    await expect(refreshVoiceConversation({ conversations: { get } } as unknown as BrowserBridge, current.id, {
      current: () => current, refresh,
    })).resolves.toBeUndefined();
    expect(refresh).not.toHaveBeenCalled();
  });
});
