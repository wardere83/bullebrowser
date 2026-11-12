import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SCORER_REVISION, regressionFailures, scoreTask, summarize } from './score.mjs';

const dataset = JSON.parse(readFileSync(new URL('./tasks.json', import.meta.url), 'utf8'));
const task = dataset.tasks[0];
const program = dataset.programs[0];
const url = 'http://127.0.0.1:1234/program/youth';
const answer = JSON.stringify({ facts: task.keys.map((key) => ({ key, value: program.facts[key], url, quote: `${key}: ${program.facts[key]}` })) });
const receipts = [{ url, text: task.keys.map((key) => `${key}: ${program.facts[key]}`).join('\n') }];

test('scores a completed answer only when correct facts have actual read receipts', () => {
  assert.equal(scoreTask(task, program, answer, receipts, 'completed').success, true);
  assert.equal(scoreTask(task, program, answer, [], 'completed').success, false);
  assert.equal(scoreTask(task, program, answer, [{ ...receipts[0], url: url + '/other' }], 'completed').success, false);
});
test('rejects invented facts and a quotation that the page did not contain', () => {
  const invented = JSON.parse(answer); invented.facts[0].value = 'Everyone worldwide';
  assert.equal(scoreTask(task, program, JSON.stringify(invented), receipts, 'completed').success, false);
  const altered = JSON.parse(answer); altered.facts[0].quote += ' and guaranteed awards';
  assert.equal(scoreTask(task, program, JSON.stringify(altered), receipts, 'completed').success, false);
});
test('missing facts, failed execution and malformed answers cannot pass', () => {
  assert.equal(scoreTask(task, program, '{"facts":[]}', receipts, 'completed').success, false);
  assert.equal(scoreTask(task, program, answer, receipts, 'failed').success, false);
  assert.equal(scoreTask(task, program, 'Done', receipts, 'completed').formatError, true);
});
test('a proposal task requires the requested outline', () => {
  const outlineTask = { ...task, outline: true };
  assert.equal(scoreTask(outlineTask, program, answer, receipts, 'completed').success, false);
  assert.equal(scoreTask(outlineTask, program, JSON.stringify({ ...JSON.parse(answer), outline: ['Need', 'Activities', 'Outcomes'] }), receipts, 'completed').success, true);
});
test('partial or unexecuted runs never produce a measured score or release approval', () => {
  const report = summarize([], dataset, 'a'.repeat(40));
  assert.equal(report.status, 'incomplete'); assert.equal(report.successRate, null); assert.equal(report.releaseApproved, false);
  assert.ok(regressionFailures(report).length);
});
test('the two-point regression boundary is exact and dataset changes cannot be compared', () => {
  const candidate = { status: 'measured', taskSetHash: 'same', datasetRevision: 'v1', tasks: 100, successRate: 0.95, citationAccuracy: 1 };
  const baseline = { ...candidate, successRate: 0.97 };
  assert.deepEqual(regressionFailures(candidate, baseline), []);
  assert.ok(regressionFailures({ ...candidate, successRate: 0.949 }, baseline).length);
  assert.ok(regressionFailures(candidate, { ...baseline, taskSetHash: 'different' }).length);
});
test('reads the JSON an agent wraps in prose, a code fence and a source line, still scoring content strictly', () => {
  const wrapped = `The listing is open.\n\n\`\`\`json\n${answer}\n\`\`\`\n\nSource: Youth fund listing — ${url}`;
  const scored = scoreTask(task, program, wrapped, receipts, 'completed');
  assert.equal(scored.success, true);
  assert.equal(scored.strictFormat, false);
  assert.equal(scoreTask(task, program, answer, receipts, 'completed').strictFormat, true);
  // A bare list of facts carries the same content.
  const list = JSON.stringify(JSON.parse(answer).facts);
  assert.equal(scoreTask(task, program, `\`\`\`json\n${list}\n\`\`\``, receipts, 'completed').success, true);
  // Wrapping never rescues wrong content or a missing receipt.
  const invented = JSON.parse(answer); invented.facts[0].value = 'Everyone worldwide';
  assert.equal(scoreTask(task, program, `\`\`\`json\n${JSON.stringify(invented)}\n\`\`\``, receipts, 'completed').success, false);
  assert.equal(scoreTask(task, program, wrapped, [], 'completed').success, false);
  assert.equal(scoreTask(task, program, 'No JSON here: {not valid}', receipts, 'completed').formatError, true);
});
test('finds bare JSON followed by a Markdown source link, including brackets inside strings', () => {
  const linked = `${answer}\n\nSource: [Youth fund listing](${url})`;
  assert.equal(scoreTask(task, program, linked, receipts, 'completed').success, true);
  const tricky = JSON.parse(answer); tricky.note = 'see [1] and {braces}';
  assert.equal(scoreTask(task, program, `Result: ${JSON.stringify(tricky)} — [source](${url})`, receipts, 'completed').success, true);
});
test('a baseline scored under different rules is never compared', () => {
  const results = dataset.tasks.map((item) => ({ id: item.id, executed: true, success: true, steps: 3, facts: [{ cited: true, correct: true }] }));
  const candidate = summarize(results, dataset, 'a'.repeat(40));
  assert.equal(candidate.scorerRevision, SCORER_REVISION);
  assert.deepEqual(regressionFailures(candidate, { ...candidate }), []);
  assert.match(regressionFailures(candidate, { ...candidate, scorerRevision: 1 }).join(' '), /different rules/);
});
test('a quotation must include the field label', () => {
  const unlabelled = JSON.parse(answer);
  for (const fact of unlabelled.facts) fact.quote = `${program.facts[fact.key]} for this program`;
  const receiptsWithout = [{ url, text: unlabelled.facts.map((fact) => fact.quote).join('\n') }];
  const scored = scoreTask(task, program, JSON.stringify(unlabelled), receiptsWithout, 'completed');
  assert.equal(scored.success, false);
  assert.ok(scored.facts.every((fact) => fact.correct && !fact.cited));
});
