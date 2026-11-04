import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
test('architecture source map points to existing repository files', () => {
  const text = readFileSync(new URL('../docs/AGENT_ARCHITECTURE.md', import.meta.url), 'utf8');
  const paths = [...text.matchAll(/`((?:apps|packages|benchmarks)\/[^`]+)`/g)].map(match => match[1]);
  assert.ok(paths.length >= 10);
  for (const path of paths) assert.ok(existsSync(resolve(path)), path);
});
