import { describe, expect, it, vi } from 'vitest';
import { GoalPlanner, parseGoals } from './planning.js';
import type { AgentInput } from './types.js';
import type { ToolCallRecord } from './agent-loop.js';

const input = () => ({ model: 'claude-opus-5-5', onStep: vi.fn() }) as unknown as AgentInput;
const record = (ok: boolean) => ({ name: 'read_page', ok, errorCode: ok ? undefined : 'ELEMENT_NOT_FOUND' }) as ToolCallRecord;
describe('separate goal planning', () => {
  it('rejects malformed or unbounded plans instead of executing their contents', () => {
    expect(() => parseGoals('{}')).toThrow();
    expect(() => parseGoals('[]')).toThrow();
    expect(() => parseGoals(JSON.stringify(['x'.repeat(401)]))).toThrow();
    expect(parseGoals('["Read source","Verify result"]')[0]?.status).toBe('active');
  });
  it('replans after two failures on one goal and coalesces concurrent requests', async () => {
    const request = vi.fn(async (_input: AgentInput, _diagnostics: string[]) => '["Find a source","Verify it"]');
    const planner = new GoalPlanner(input(), request);
    await Promise.all([planner.ensure(), planner.ensure()]);
    expect(request).toHaveBeenCalledTimes(1);
    planner.observe(record(false)); await planner.ensure();
    expect(request).toHaveBeenCalledTimes(1);
    planner.observe(record(false)); await planner.ensure();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[1]).toEqual(['read_page: ELEMENT_NOT_FOUND', 'read_page: ELEMENT_NOT_FOUND']);
  });
  it('asks again for a cut-off plan, then works to a plain plan, instead of ending the task', async () => {
    const retried = vi.fn(async () => '["Read the list').mockResolvedValueOnce('["Read the list').mockResolvedValueOnce('["Read the list","Verify it"]');
    const planner = new GoalPlanner(input(), retried);
    await planner.ensure();
    expect(retried).toHaveBeenCalledTimes(2);
    expect(planner.goals.map((goal) => goal.goal)).toEqual(['Read the list', 'Verify it']);

    const broken = new GoalPlanner(input(), async () => '');
    await broken.ensure();
    expect(broken.goals.map((goal) => goal.status)).toEqual(['active', 'pending']);
  });
  it('still ends the task when the plan request itself fails', async () => {
    const planner = new GoalPlanner(input(), async () => { throw new Error('Your credit balance is too low'); });
    await expect(planner.ensure()).rejects.toThrow('credit balance');
  });
  it('requires a tool observation before completing the active goal', async () => {
    const planner = new GoalPlanner(input(), async () => '["Read","Verify"]');
    await planner.ensure();
    await expect(planner.tool.execute({ id: '1' })).rejects.toThrow();
    planner.observe(record(true));
    await expect(planner.tool.execute({ id: '2' })).rejects.toThrow();
    await planner.tool.execute({ id: '1' });
    expect(planner.goals.map((goal) => goal.status)).toEqual(['completed', 'active']);
  });
  it('runs every Claude step and the final synthesis on the chosen assistant', async () => {
    const planner = new GoalPlanner(input(), async () => '["Read"]');
    expect(planner.model).toBe('claude-opus-5-5');
    planner.beginSynthesis(); expect(planner.model).toBe('claude-opus-5-5');
    planner.requestReplan(); expect(planner.synthesis).toBe(false);
  });
  it('stops after repeated failed replans rather than looping indefinitely', async () => {
    const planner = new GoalPlanner(input(), async () => '["Read"]');
    for (let i = 0; i < 4; i++) { planner.requestReplan(); await planner.ensure(); }
    planner.requestReplan(); await expect(planner.ensure()).rejects.toThrow('repeated failures');
  });
});
