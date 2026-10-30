import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configurationErrors, runBenchmarks } from './run-agent-benchmarks.mjs';
import { SUITES } from './agent-benchmark-gate.mjs';

// Contract fixtures only. Never publish these as measured benchmark evidence.
const revision = 'a'.repeat(40);
const suite = { datasetRevision: 'unit-fixture', taskSetHash: 'unit-fixture', tasks: 100, successRate: 0.95,
  hallucinationRate: 0, citationAccuracy: 0.95, unrecoverableFailureRate: 0, stepsToSuccess: 4, costPerTask: 0.01,
  auditedCitations: 100, auditMethod: 'random-human-review' };
const telemetry = { latency: { warmFirstActionP95Ms: 1, coldFirstActionP95Ms: 1, planFirstPaintP95Ms: 1, toolDispatchP95Ms: 1, permissionSheetP95Ms: 1 },
  actions: { total: 100, visibleBeforeMutation: 100 }, recovery: { recoverableFailures: 1, withRemediation: 1 } };
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'bulle-eval-contract-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const baseline = join(root, 'baseline.json');
  await writeFile(baseline, JSON.stringify({ suites: Object.fromEntries(SUITES.map((name) => [name, suite])) }));
  const adapter = join(root, 'adapter.mjs');
  await writeFile(adapter, `import {writeFileSync} from 'node:fs'; const a=process.argv; writeFileSync(a[a.indexOf('--output')+1], JSON.stringify({revision:a[a.indexOf('--revision')+1],completedAt:new Date().toISOString(),suite:${JSON.stringify(suite)},...${JSON.stringify(telemetry)}}));`);
  const config = { baseline, adapters: Object.fromEntries([...SUITES, 'browser-telemetry'].map((name) => [name, { command: [process.execPath, adapter] }])) };
  return { config, repository: root, revision, output: join(root, 'candidate.json'), adapter };
}
test('configuration rejects missing adapters and shell command strings', () => {
  assert.equal(configurationErrors({}).length, 6);
  assert.ok(configurationErrors({ baseline: 'baseline.json', adapters: { webarena: { command: 'node fake.js' } } }).some((x) => x.startsWith('webarena:')));
});
test('runs every adapter, validates results, and writes structured evidence', async (t) => {
  const input = await fixture(t);
  const result = await runBenchmarks(input);
  assert.deepEqual(Object.keys(result.suites), SUITES);
  assert.equal(JSON.parse(await readFile(input.output)).validation.passed, true);
});
test('preflight produces no measured result', async (t) => {
  const input = await fixture(t);
  assert.equal((await runBenchmarks({ ...input, preflight: true })).measured, false);
  await assert.rejects(readFile(input.output), /ENOENT/);
});
test('does not reuse an old file when an evaluator fails to write output', async (t) => {
  const input = await fixture(t);
  await writeFile(input.adapter, '// No output');
  await writeFile(`${input.output}.webarena.json`, JSON.stringify({ revision, completedAt: new Date().toISOString(), suite }));
  await assert.rejects(runBenchmarks(input), /ENOENT/);
});
test('rejects an evaluator returning a different revision', async (t) => {
  const input = await fixture(t);
  await writeFile(input.adapter, `import {writeFileSync} from 'node:fs'; const a=process.argv; writeFileSync(a[a.indexOf('--output')+1], JSON.stringify({revision:'wrong'}));`);
  await assert.rejects(runBenchmarks(input), /different revision/);
});
test('persists threshold failures without reporting a pass', async (t) => {
  const input = await fixture(t);
  const source = await readFile(input.adapter, 'utf8');
  await writeFile(input.adapter, source.replace('"successRate":0.95', '"successRate":0.5'));
  await assert.rejects(runBenchmarks(input), /regressed/);
  assert.equal(JSON.parse(await readFile(input.output)).validation.passed, false);
});
