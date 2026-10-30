import { expect, it } from 'vitest';
import { taskReport, taskSources } from './task-report.js';
import type { AgentStepEvent } from './agent-events.js';
it('distinguishes opened pages from read evidence, preserves excerpts and redacts credential URLs', () => {
  const steps: AgentStepEvent[] = [
    { kind: 'tool_result', toolName: 'navigate', output: { url: 'https://agency.gov/unread' }, ts: 1 },
    { kind: 'tool_result', toolName: 'read_page', output: { url: 'https://agency.gov/grants?token=private#part', title: 'Grants', text: 'Eligible: colleges.' }, ts: 2 },
    { kind: 'tool_result', toolName: 'navigate', output: { url: 'javascript:alert(1)' }, ts: 3 },
    { kind: 'thinking', detail: 'Private reasoning', ts: 4 },
    { kind: 'text', text: 'Reviewed eligibility.', ts: 5 },
  ];
  expect(taskSources(steps)).toMatchObject([{ read: false }, { read: true, excerpt: 'Eligible: colleges.' }]);
  const report = taskReport(steps);
  expect(report).toContain('Reviewed eligibility.');
  expect(report).toContain('Eligible: colleges.');
  expect(report).not.toMatch(/private|Private reasoning|javascript:/);
});
it('exports consent decisions and tool audit JSON without letting page text terminate its code block', () => {
  const report = taskReport([], { consents: [{ kind: 'destructive', approved: false, at: 1 }], calls: [{
    callId: 'call', name: 'read_page', input: {}, ok: true, result: '```', attempts: 1, startedAt: 1, durationMs: 10,
  }] });
  expect(report).toContain('destructive: declined');
  expect(report.match(/^```/gm)).toHaveLength(2);
  const json = report.split('```json\n')[1]!.split('\n```')[0]!;
  expect(JSON.parse(json)[0].result).toBe('```');
});

it('exports a machine-readable timeline without private reasoning or raw result bodies', async () => {
  const { taskAuditJson } = await import('./task-report.js');
  const json = taskAuditJson([
    { kind: 'thinking', detail: 'private reasoning', ts: 1 },
    { kind: 'tool_result', toolName: 'getPageMetadata', callId: 'c1', output: { hidden: 'raw body' }, durationMs: 5, ts: 2 },
  ], { calls: [], consents: [{ kind: 'destructive', approved: false, at: 3 }] });
  const audit = JSON.parse(json);
  expect(audit.timeline).toEqual([{ at: 2, kind: 'tool_result', toolName: 'getPageMetadata', callId: 'c1', durationMs: 5 }]);
  expect(audit.consents[0].approved).toBe(false);
  expect(json).not.toMatch(/private reasoning|raw body/);
});
