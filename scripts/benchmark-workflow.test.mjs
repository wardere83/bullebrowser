import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const yaml = readFileSync(new URL('../.github/workflows/agent-benchmark.yml', import.meta.url), 'utf8');
const block = yaml.split('        run: |\n')[1].split('\n  evaluate:')[0];
const script = block.split('\n').map((line) => line.startsWith('          ') ? line.slice(10) : line).join('\n');
for (const value of ['', '  \n\t ', '{invalid']) {
  test(`benchmark publication fails for ${value ? 'invalid or blank' : 'missing'} configuration`, () => {
    const result = spawnSync('bash', ['-e', '-c', script], { env: { ...process.env, AGENT_EVAL_CONFIG: value }, encoding: 'utf8' });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout, /configured=false|Publication is not gated/);
  });
}
