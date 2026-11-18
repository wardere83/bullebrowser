import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gate, latestRun, reportProblems, runState } from './release-gate.mjs';

const sha = 'a'.repeat(40);
const passing = { revision: sha, status: 'measured', tasks: 8, expectedTasks: 8, successRate: 1, citationAccuracy: 1, validation: { passed: true } };
const run = (id, extra = {}) => ({ id, head_sha: sha, head_branch: 'main', status: 'completed', conclusion: 'success', created_at: `2026-11-17T12:0${id}:00Z`, html_url: `https://runs/${id}`, ...extra });

function harness(byWorkflow, report = passing) {
  let clock = 0;
  return {
    api: async (path) => ({ workflow_runs: byWorkflow[path.match(/workflows\/([^/]+)\/runs/)[1]]?.(clock) ?? [] }),
    download: async () => report,
    repository: 'owner/repo', sha,
    sleep: async (ms) => { clock += ms; },
    now: () => clock,
    timeoutMs: 70 * 60_000,
    appearMs: 15 * 60_000,
    log: () => {},
  };
}

test('uses the newest run of this commit on main', () => {
  assert.equal(latestRun([run(1), run(3), run(2), run(4, { head_branch: 'feature' }), run(5, { head_sha: 'b'.repeat(40) })], sha).id, 3);
});

test('a running, missing or unsuccessful run never passes', () => {
  assert.equal(runState(undefined), 'wait');
  assert.equal(runState(run(1, { status: 'in_progress', conclusion: null })), 'wait');
  assert.match(runState(run(1, { conclusion: 'failure' })), /ended failure/);
  assert.match(runState(run(1, { conclusion: 'skipped' })), /ended skipped/);
  assert.equal(runState(run(1)), 'pass');
});

test('the funding report must be a passing measurement of this commit', () => {
  assert.deepEqual(reportProblems(passing, sha), []);
  assert.match(reportProblems({ ...passing, revision: 'b'.repeat(40) }, sha).join(), /measured b/);
  assert.match(reportProblems({ ...passing, successRate: 0.875 }, sha).join(), /below 0.9/);
  assert.match(reportProblems({ ...passing, citationAccuracy: null }, sha).join(), /citation accuracy/);
  assert.match(reportProblems({ ...passing, tasks: 7 }, sha).join(), /Not every funding task/);
  assert.match(reportProblems({ ...passing, status: 'blocked' }, sha).join(), /not a measurement/);
  assert.match(reportProblems({ ...passing, validation: { passed: false } }, sha).join(), /own validation/);
  assert.match(reportProblems(null, sha).join(), /missing/);
});

test('waits for both runs, then passes on passing evidence', async () => {
  const later = (minutes) => (clock) => (clock >= minutes * 60_000 ? [run(1)] : [run(1, { status: 'in_progress', conclusion: null })]);
  await gate(harness({ 'funding-evaluator.yml': later(12), 'e2e.yml': later(3) }));
});

test('fails on a failed run, failing evidence, a missing run or a timeout', async () => {
  await assert.rejects(gate(harness({ 'funding-evaluator.yml': () => [run(1, { conclusion: 'failure' })], 'e2e.yml': () => [run(2)] })), /funding test did not pass/);
  await assert.rejects(gate(harness({ 'funding-evaluator.yml': () => [run(1)], 'e2e.yml': () => [run(2)] }, { ...passing, successRate: 0 })), /evidence does not pass/);
  await assert.rejects(gate(harness({ 'e2e.yml': () => [run(2)] })), /No funding test ran on main/);
  await assert.rejects(gate(harness({ 'funding-evaluator.yml': () => [run(1, { status: 'queued', conclusion: null })], 'e2e.yml': () => [run(2)] })), /Timed out waiting for funding test/);
});
