import { createHash } from 'node:crypto';

export const normalize = (value) => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
export const datasetHash = (dataset) => createHash('sha256').update(JSON.stringify(dataset)).digest('hex');

/**
 * The JSON the agent returned. The app's agent cites its sources, so a reply
 * can surround the JSON with a sentence, a code fence and a "Source:" line.
 * Content is still scored strictly below; only the wrapper is tolerated, and
 * `strictFormat` records whether the reply was bare JSON. Throws if none.
 */
export function extractAnswerJson(answer) {
  const text = String(answer ?? '').trim();
  const candidates = [text, ...[...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((match) => match[1])];
  const start = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
  for (const [index, candidate] of candidates.entries()) {
    try {
      const value = JSON.parse(candidate.trim());
      if (value && typeof value === 'object') return { value, strictFormat: index === 0 };
    } catch { /* try the next candidate */ }
  }
  throw new Error('No JSON value in the answer.');
}

/** Closed-answer scoring: only an actual read receipt can support a citation. */
export function scoreTask(task, program, answer, receipts, status) {
  let parsed;
  let strictFormat;
  try { ({ value: parsed, strictFormat } = extractAnswerJson(answer)); }
  catch { return { id: task.id, success: false, formatError: true, facts: [], missingKeys: task.keys, reason: 'Final answer contained no JSON facts.' }; }
  // A bare list of facts is the same content as { facts: [...] }.
  const facts = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.facts) ? parsed.facts : [];
  const scored = facts.map((fact) => {
    const known = typeof fact?.key === 'string' && Object.hasOwn(program.facts, fact.key);
    const correct = known && normalize(fact.value) === normalize(program.facts[fact.key]);
    const receipt = receipts.find((source) => source.url === fact.url && typeof source.text === 'string');
    const quote = typeof fact.quote === 'string' ? fact.quote.trim() : '';
    const cited = !!receipt && quote.length >= 12 && normalize(receipt.text).includes(normalize(quote)) && normalize(quote).includes(normalize(fact.value)) && correct;
    return { key: fact?.key ?? null, value: fact?.value ?? null, url: fact?.url ?? null, quote, correct: !!correct, cited };
  });
  const missingKeys = task.keys.filter((key) => !scored.some((fact) => fact.key === key && fact.correct && fact.cited));
  const outline = Array.isArray(parsed) ? undefined : parsed.outline;
  const outlineValid = !task.outline || (Array.isArray(outline) && outline.length >= 3 && outline.every((section) => typeof section === 'string' && section.trim()));
  return { id: task.id, success: status === 'completed' && !missingKeys.length && scored.length >= task.keys.length && scored.every((fact) => fact.correct && fact.cited) && outlineValid, facts: scored, missingKeys, outlineValid, strictFormat, status };
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
