import { test } from 'node:test';
import assert from 'node:assert/strict';
import { benchmarkGate, SUITES } from './agent-benchmark-gate.mjs';
const now = Date.parse('2026-10-29T12:00:00Z');
function evidence() {
  return { revision: 'exact-sha', completedAt: new Date(now).toISOString(), suites: Object.fromEntries(SUITES.map((suite) => [suite, {
    datasetRevision: 'pinned', taskSetHash: 'same-100-tasks', tasks: 100, successRate: 0.95,
    hallucinationRate: 0, citationAccuracy: 0.95, unrecoverableFailureRate: 0.01,
    stepsToSuccess: 8, costPerTask: 0.02, auditedCitations: 100, auditMethod: 'random-human-review',
  }])), latency: { warmFirstActionP95Ms: 1500, coldFirstActionP95Ms: 3000, planFirstPaintP95Ms: 300, toolDispatchP95Ms: 100, permissionSheetP95Ms: 200 },
  actions: { total: 100, visibleBeforeMutation: 100 }, recovery: { recoverableFailures: 5, withRemediation: 5 } };
}
const options = { now, revision: 'exact-sha' };
test('allows exactly two points, rejects a larger loss on any individual suite', () => {
  const baseline = evidence(); const candidate = evidence();
  candidate.suites.mind2web.successRate = 0.93;
  assert.deepEqual(benchmarkGate(candidate, baseline, options), []);
  candidate.suites.mind2web.successRate = 0.929;
  assert.match(benchmarkGate(candidate, baseline, options).join(), /mind2web.*regressed/);
});
test('fails closed on absent, stale, mismatched or incomplete evidence', () => {
  assert.ok(benchmarkGate(null, null, options).length);
  for (const mutate of [
    (e) => { e.revision = 'other'; }, (e) => { e.completedAt = '2026-01-01'; },
    (e) => { delete e.suites.webarena; }, (e) => { e.suites.webarena.taskSetHash = 'different'; },
    (e) => { e.suites.webarena.successRate = Number.NaN; }, (e) => { delete e.latency; },
    (e) => { e.actions.visibleBeforeMutation = 99; }, (e) => { e.suites['bulle-funding'].citationAccuracy = 0.89; },
    (e) => { e.suites['bulle-funding'].unrecoverableFailureRate = 0.02; },
    (e) => { e.recovery.withRemediation = 0; },
  ]) { const candidate = evidence(); mutate(candidate); assert.ok(benchmarkGate(candidate, evidence(), options).length); }
});
