import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export const SUITES = ['webarena', 'visualwebarena', 'mind2web', 'bulle-funding'];
function validRate(value) { return Number.isFinite(value) && value >= 0 && value <= 1; }
/** Rates are fractions. Two percentage points is 0.02, not a relative 2%. */
export function benchmarkGate(candidate, baseline, { revision, now = Date.now() } = {}) {
  const failures = [];
  if (!candidate || !baseline) return ['Candidate and baseline evidence are required.'];
  if (!revision || candidate.revision !== revision) failures.push('Candidate evidence must match the exact release commit.');
  const age = now - Date.parse(candidate.completedAt);
  if (!Number.isFinite(age) || age < 0 || age > 36 * 3600000) failures.push('Candidate evidence is missing, future-dated, or older than 36 hours.');
  for (const suite of SUITES) {
    const current = candidate.suites?.[suite];
    const previous = baseline.suites?.[suite];
    if (!current || !previous) { failures.push(`${suite}: candidate and baseline are both required.`); continue; }
    if (!current.datasetRevision || current.datasetRevision !== previous.datasetRevision || !current.taskSetHash || current.taskSetHash !== previous.taskSetHash) failures.push(`${suite}: dataset revision and task set must match the baseline.`);
    if (!Number.isInteger(current.tasks) || current.tasks < 1 || current.tasks !== previous.tasks) failures.push(`${suite}: a nonempty identical task set is required.`);
    for (const key of ['successRate', 'hallucinationRate', 'citationAccuracy', 'unrecoverableFailureRate']) {
      if (!validRate(current[key]) || !validRate(previous[key])) failures.push(`${suite}: invalid or missing ${key}.`);
    }
    for (const key of ['stepsToSuccess', 'costPerTask']) if (!Number.isFinite(current[key]) || current[key] < 0) failures.push(`${suite}: invalid or missing ${key}.`);
    if (previous.successRate - current.successRate > 0.020000000001) failures.push(`${suite}: success rate regressed by more than two percentage points.`);
    if (suite === 'bulle-funding') {
      if (!Number.isInteger(current.auditedCitations) || current.auditedCitations < 1 || !['random-human-review', 'random-independent-review'].includes(current.auditMethod)) failures.push('bulle-funding: a random citation audit with recorded sample count is required.');
      if (current.citationAccuracy < 0.9) failures.push('bulle-funding: citation accuracy is below 90%.');
      if (current.unrecoverableFailureRate > 0.01) failures.push('bulle-funding: unrecoverable failures exceed 1%.');
    }
  }
  for (const [key, ceiling] of Object.entries({ warmFirstActionP95Ms: 1500, coldFirstActionP95Ms: 3000, planFirstPaintP95Ms: 300, toolDispatchP95Ms: 100, permissionSheetP95Ms: 200 })) {
    if (!Number.isFinite(candidate.latency?.[key]) || candidate.latency[key] < 0 || candidate.latency[key] > ceiling) failures.push(`${key}: missing or above ${ceiling} ms.`);
  }
  if (!Number.isInteger(candidate.actions?.total) || candidate.actions.total < 1 || candidate.actions.visibleBeforeMutation !== candidate.actions.total) failures.push('Every measured click/type/scroll must have a visible event before mutation (nonempty measurement required).');
  if (!Number.isInteger(candidate.recovery?.recoverableFailures) || candidate.recovery.recoverableFailures < 1 || candidate.recovery?.withRemediation !== candidate.recovery?.recoverableFailures) failures.push('Every recoverable failure must offer remediation; failure-path samples are required.');
  return failures;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [candidateFile, baselineFile, revision] = process.argv.slice(2);
    if (!candidateFile || !baselineFile || !revision) throw new Error('Usage: node scripts/agent-benchmark-gate.mjs candidate.json baseline.json exact-commit-sha');
    const failures = benchmarkGate(JSON.parse(readFileSync(candidateFile, 'utf8')), JSON.parse(readFileSync(baselineFile, 'utf8')), { revision });
    if (failures.length) { for (const failure of failures) console.error(failure); process.exitCode = 1; }
    else console.log('All agent benchmark evidence gates passed.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
