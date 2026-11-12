import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Clears the previous run's per-task records before the first worker starts.
// funding.spec.ts appends to this file because workers restart after failures.
export default function globalSetup(): void {
  const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const output = resolve(process.env.BULLE_EVAL_OUTPUT || resolve(repository, 'benchmark-results'));
  rmSync(resolve(output, 'funding-results.jsonl'), { force: true });
}
