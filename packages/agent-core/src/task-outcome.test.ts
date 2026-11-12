import { describe, expect, it } from 'vitest';
import type { ToolCallRecord } from './agent-loop.js';
import { TaskOutcomeTracker } from './task-outcome.js';
import { PLAN_STEP_TOOL, type AgentInput } from './types.js';

const input = {
  model: 'claude-opus-4-7',
  systemPrompt: '',
  history: [],
  userMessage: 'What does this page say about eligibility?',
  context: { activeTabId: 't1', signal: new AbortController().signal, runtime: {} },
  onStep: () => {},
} as unknown as AgentInput;

function call(name: string, ok: boolean): ToolCallRecord {
  return { callId: `${name}-${ok}`, name, input: { id: 'g2' }, ok, result: ok ? 'ok' : 'error', attempts: 1, startedAt: 0, durationMs: 1 };
}

describe('task outcome and the planner', () => {
  it('does not mark a finished answer incomplete because a plan update was refused', () => {
    const tracker = new TaskOutcomeTracker(input);
    tracker.record(call('read_page', true));
    tracker.record(call(PLAN_STEP_TOOL, false));
    tracker.record(call(PLAN_STEP_TOOL, false));
    const answer = '{"facts":[{"key":"ages","value":"14 through 18"}]}';
    expect(tracker.finalize(answer)).toBe(answer);
    expect(tracker.outcome.status).toBe('completed');
  });

  it('still reports a real failed operation without recovery', () => {
    const tracker = new TaskOutcomeTracker(input);
    tracker.record(call('read_page', false));
    expect(tracker.finalize('The page says nonprofits are eligible.')).toBe('Task incomplete. An attempted operation failed and no matching recovery was verified.');
  });
});
