import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluatorReadiness } from './preflight.mjs';
const revision = 'a'.repeat(40);
const input = { BULLE_EVAL_REVISION: revision };
test('auto selects the configured provider without silently changing an explicit choice', () => {
  assert.equal(evaluatorReadiness({ ...input, OPENAI_API_KEY: 'test-placeholder' }).provider, 'openai');
  assert.equal(evaluatorReadiness({ ...input, ANTHROPIC_API_KEY: 'test-placeholder', OPENAI_API_KEY: 'test-placeholder' }).provider, 'anthropic');
  const explicit = evaluatorReadiness({ ...input, BULLE_EVAL_PROVIDER: 'anthropic', OPENAI_API_KEY: 'test-placeholder' });
  assert.equal(explicit.status, 'blocked');
  assert.match(explicit.missing.join(' '), /ANTHROPIC_API_KEY/);
});
test('missing, blank, invalid-provider and invalid-revision inputs fail closed', () => {
  for (const env of [input, { ...input, ANTHROPIC_API_KEY: ' ' }, { ...input, BULLE_EVAL_PROVIDER: 'invalid', OPENAI_API_KEY: 'test-placeholder' }, { OPENAI_API_KEY: 'test-placeholder' }]) {
    assert.equal(evaluatorReadiness(env).status, 'blocked');
    assert.equal(evaluatorReadiness(env).measured, false);
  }
});
test('CLI emits only the selected provider to Actions and never reports a measurement', () => {
  const dir = mkdtempSync(join(tmpdir(), 'funding-preflight-'));
  try {
    const output = join(dir, 'outputs');
    const run = spawnSync(process.execPath, [fileURLToPath(new URL('./preflight.mjs', import.meta.url))], { encoding: 'utf8', env: { ...input, OPENAI_API_KEY: 'test-placeholder-not-a-credential', BULLE_EVAL_OUTPUT: dir, GITHUB_OUTPUT: output } });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(readFileSync(output, 'utf8'), 'provider=openai\n');
    const evidence = readFileSync(join(dir, 'readiness.json'), 'utf8');
    assert.equal(JSON.parse(evidence).measured, false);
    assert.doesNotMatch(evidence + run.stdout + run.stderr, /test-placeholder/);
    const blocked = spawnSync(process.execPath, [fileURLToPath(new URL('./preflight.mjs', import.meta.url))], { encoding: 'utf8', env: { ...input, BULLE_EVAL_OUTPUT: dir } });
    assert.equal(blocked.status, 1);
    assert.equal(JSON.parse(readFileSync(join(dir, 'readiness.json'), 'utf8')).status, 'blocked');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('workflow uses the validated provider output for actual execution', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/funding-evaluator.yml', import.meta.url), 'utf8');
  assert.match(workflow, /BULLE_EVAL_PROVIDER: \$\{\{ steps\.preflight\.outputs\.provider \}\}/);
  assert.match(workflow, /vars\.BULLE_EVAL_PROVIDER/);
});
