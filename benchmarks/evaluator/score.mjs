import { createHash } from 'node:crypto';

export const normalize = (value) => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
export const datasetHash = (dataset) => createHash('sha256').update(JSON.stringify(dataset)).digest('hex');

/** Closed-answer scoring: only an actual read receipt can support a citation. */
export function scoreTask(task, program, answer, receipts, status) {
  let parsed;
  try { parsed = JSON.parse(answer.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); }
  catch { return { id: task.id, success: false, formatError: true, facts: [], missingKeys: task.keys, reason: 'Final answer was not the required JSON object.' }; }
  const facts = Array.isArray(parsed?.facts) ? parsed.facts : [];
  const scored = facts.map((fact) => {
    const known = typeof fact?.key === 'string' && Object.hasOwn(program.facts, fact.key);
    const correct = known && normalize(fact.value) === normalize(program.facts[fact.key]);
    const receipt = receipts.find((source) => source.url === fact.url && typeof source.text === 'string');
    const quote = typeof fact.quote === 'string' ? fact.quote.trim() : '';
    const cited = !!receipt && quote.length >= 12 && normalize(receipt.text).includes(normalize(quote)) && normalize(quote).includes(normalize(fact.value)) && correct;
    return { key: fact?.key ?? null, value: fact?.value ?? null, url: fact?.url ?? null, quote, correct: !!correct, cited };
  });
  const missingKeys = task.keys.filter((key) => !scored.some((fact) => fact.key === key && fact.correct && fact.cited));
  const outlineValid = !task.outline || (Array.isArray(parsed.outline) && parsed.outline.length >= 3 && parsed.outline.every((section) => typeof section === 'string' && section.trim()));
  return { id: task.id, success: status === 'completed' && !missingKeys.length && scored.length >= task.keys.length && scored.every((fact) => fact.correct && fact.cited) && outlineValid, facts: scored, missingKeys, outlineValid, status };
}

export function summarize(results, dataset, revision) {
  const facts = results.flatMap((result) => result.facts ?? []);
  const successes = results.filter((result) => result.success);
  const measured = results.length === dataset.tasks.length && results.every((result) => result.executed === true);
  return {
    schemaVersion: 1, suite: 'bulle-funding-portals', datasetRevision: dataset.version, taskSetHash: datasetHash(dataset), revision,
    completedAt: new Date().toISOString(), status: measured ? 'measured' : 'incomplete', releaseApproved: false,
    tasks: results.length, expectedTasks: dataset.tasks.length,
    successRate: measured ? successes.length / results.length : null,
    citationAccuracy: measured && facts.length ? facts.filter((fact) => fact.cited).length / facts.length : null,
    unsupportedStructuredFactRate: measured && facts.length ? facts.filter((fact) => !fact.correct).length / facts.length : null,
    stepsToSuccess: successes.length ? successes.reduce((sum, result) => sum + result.steps, 0) / successes.length : null,
    costPerTask: null, costStatus: 'Provider billing not measured; no cost inferred from request count.',
    auditMethod: 'automatic-exact-source', auditStatus: 'Independent random citation review still required for release evidence.',
    limitations: ['Synthetic funding portal suite only.', 'No public benchmark or latency acceptance is implied.', 'Closed structured facts are scored; unrestricted prose hallucination rate is not measured.'],
    results,
  };
}

export function regressionFailures(candidate, baseline) {
  const errors = [];
  if (candidate.status !== 'measured') errors.push('A complete measured run is required.');
  if (baseline) {
    if (baseline.status !== 'measured' || baseline.taskSetHash !== candidate.taskSetHash || baseline.datasetRevision !== candidate.datasetRevision || baseline.tasks !== candidate.tasks) errors.push('Baseline must use the identical measured dataset/task set.');
    else if (baseline.successRate - candidate.successRate > 0.020000000001) errors.push('Task success regressed by more than two percentage points.');
  }
  if (candidate.successRate < 0.9 || candidate.successRate === null) errors.push('Internal task success is below 90%.');
  if (candidate.citationAccuracy < 0.9 || candidate.citationAccuracy === null) errors.push('Internal citation accuracy is below 90%.');
  return errors;
}
