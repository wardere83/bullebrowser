import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentStepEvent } from '../../shared/agent-events.js';
import type { ConversationDetail } from '../../shared/ipc.js';
import { useAgentStore } from './agent-store.js';

const conversation = (id: string): ConversationDetail => ({ id, title: id, createdAt: 1, updatedAt: 1, messageCount: 0, messages: [] });
const reading: AgentStepEvent = { kind: 'tool_call', toolName: 'read_page', detail: 'read_page({})', input: {}, ts: 1 };

beforeEach(() => {
  useAgentStore.setState({ ...useAgentStore.getInitialState(), current: conversation('chat-a') }, true);
});

describe('chat activity ownership and IPC timing', () => {
  it('keeps events that arrive before the run IPC returns its handle', () => {
    const store = useAgentStore.getState();
    store.prepareRun('chat-a');
    expect(store.appendStep(reading, 'run-a')).toBe(true);
    store.startRun('run-a', 'chat-a');
    expect(useAgentStore.getState()).toMatchObject({ runId: 'run-a', status: 'running', steps: [reading] });
    expect(useAgentStore.getState().activities['chat-a']).toMatchObject({ runId: 'run-a', steps: [reading], status: 'running' });
  });

  it('never restarts a run that completed before its handle arrived', () => {
    const store = useAgentStore.getState();
    store.prepareRun('chat-a');
    store.appendStep({ kind: 'text', text: 'The answer is ready.', ts: 1 }, 'run-a');
    store.appendStep({ kind: 'done', ts: 2 }, 'run-a');
    store.finishRun();
    store.startRun('run-a', 'chat-a');
    expect(useAgentStore.getState()).toMatchObject({ runId: null, status: 'idle' });
    expect(useAgentStore.getState().activities['chat-a']?.steps).toHaveLength(2);
  });

  it('never restarts a failed run when its IPC handle arrives late', () => {
    const store = useAgentStore.getState();
    store.prepareRun('chat-a');
    store.appendStep({ kind: 'error', message: 'The request could not run.', ts: 1 }, 'run-a');
    store.setError('The request could not run.');
    store.startRun('run-a', 'chat-a');
    expect(useAgentStore.getState()).toMatchObject({ runId: null, status: 'error', currentStep: 'The request could not run.' });
  });

  it('rejects other run events and handles during a running task', () => {
    const store = useAgentStore.getState();
    store.prepareRun('chat-a');
    store.startRun('run-a', 'chat-a');
    expect(store.appendStep(reading, 'run-b')).toBe(false);
    store.startRun('run-b', 'chat-b');
    expect(useAgentStore.getState()).toMatchObject({ runId: 'run-a', runConversationId: 'chat-a', steps: [] });
  });

  it('keeps a background task running while History shows another chat', () => {
    const store = useAgentStore.getState();
    store.prepareRun('chat-a');
    store.appendStep(reading, 'run-a');
    store.setCurrent(conversation('chat-b'));
    store.appendStep({ kind: 'text', text: 'Private entity A findings.', ts: 2 }, 'run-a');
    expect(useAgentStore.getState()).toMatchObject({ runId: 'run-a', runConversationId: 'chat-a', status: 'running', current: { id: 'chat-b' } });
    expect(useAgentStore.getState().activities['chat-b']).toBeUndefined();
    expect(useAgentStore.getState().activities['chat-a']?.steps).toHaveLength(2);
    store.finishRun();
    store.setCurrent(conversation('chat-a'));
    expect(useAgentStore.getState().activities['chat-a']).toMatchObject({ status: 'idle', steps: [reading, { kind: 'text', text: 'Private entity A findings.', ts: 2 }] });
  });

  it('ignores retired run events before a newer task receives its handle', () => {
    const store = useAgentStore.getState();
    store.prepareRun('chat-a');
    store.appendStep(reading, 'run-a');
    store.finishRun();
    store.prepareRun('chat-a');
    expect(store.appendStep({ kind: 'done', ts: 3 }, 'run-a')).toBe(false);
    store.startRun('run-a', 'chat-a');
    expect(useAgentStore.getState()).toMatchObject({ runId: null, activityRunId: null, status: 'running', steps: [] });
    store.appendStep(reading, 'run-b');
    expect(useAgentStore.getState()).toMatchObject({ runId: 'run-b', status: 'running', steps: [reading] });
  });

  it('starts fresh activity for a new task without losing another chat’s record', () => {
    const store = useAgentStore.getState();
    store.prepareRun('chat-a');
    store.appendStep(reading, 'run-a');
    store.finishRun();
    store.setCurrent(conversation('chat-b'));
    store.prepareRun('chat-b');
    store.startRun('run-b', 'chat-b');
    expect(useAgentStore.getState().activities['chat-a']).toMatchObject({ status: 'idle', steps: [reading] });
    expect(useAgentStore.getState().activities['chat-b']).toMatchObject({ status: 'running', steps: [] });
  });
});
