import { beforeEach, describe, expect, it } from 'vitest';
import { useAgentStore } from './agent-store.js';

describe('agent run lifecycle', () => {
  beforeEach(() => useAgentStore.getState().setCurrent(null));
  it('registers a run before events arrive and clears it on completion', () => {
    useAgentStore.getState().startRun('new-run');
    expect(useAgentStore.getState().runId).toBe('new-run');
    expect(useAgentStore.getState().status).toBe('running');
    useAgentStore.getState().finishRun();
    expect(useAgentStore.getState().runId).toBeNull();
    expect(useAgentStore.getState().pendingConfirm).toBeNull();
  });
  it('switching conversation invalidates the old run and activity', () => {
    useAgentStore.getState().startRun('old-run');
    useAgentStore.getState().appendStep({ kind: 'done', ts: 1 });
    useAgentStore.getState().setCurrent(null);
    expect(useAgentStore.getState().runId).toBeNull();
    expect(useAgentStore.getState().steps).toEqual([]);
    expect(useAgentStore.getState().status).toBe('idle');
  });
});
