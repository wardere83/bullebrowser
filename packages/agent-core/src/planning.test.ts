import { describe, expect, it, vi } from 'vitest';
import { GoalPlanner, parseGoals } from './planning.js';
import type { AgentInput } from './types.js';
import type { ToolCallRecord } from './agent-loop.js';

const input = () => ({ model: 'claude-opus-4-7', onStep: vi.fn() }) as unknown as AgentInput;
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
  it('requires a tool observation before completing the active goal', async () => {
    const planner = new GoalPlanner(input(), async () => '["Read","Verify"]');
    await planner.ensure();
    await expect(planner.tool.execute({ id: '1' })).rejects.toThrow();
    planner.observe(record(true));
    await expect(planner.tool.execute({ id: '2' })).rejects.toThrow();
    await planner.tool.execute({ id: '1' });
    expect(planner.goals.map((goal) => goal.status)).toEqual(['completed', 'active']);
  });
  it('uses a fast executor and promotes final synthesis to the large model', async () => {
    const planner = new GoalPlanner(input(), async () => '["Read"]');
    expect(planner.model).toBe('claude-haiku-4-5-20251001');
    planner.beginSynthesis(); expect(planner.model).toBe('claude-opus-4-7');
    planner.requestReplan(); expect(planner.synthesis).toBe(false);
  });
  it('stops after repeated failed replans rather than looping indefinitely', async () => {
    const planner = new GoalPlanner(input(), async () => '["Read"]');
    for (let i = 0; i < 4; i++) { planner.requestReplan(); await planner.ensure(); }
    planner.requestReplan(); await expect(planner.ensure()).rejects.toThrow('repeated failures');
  });
});
