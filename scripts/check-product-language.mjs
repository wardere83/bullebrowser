import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const restricted = String.fromCharCode(100, 117, 99, 107, 100, 117, 99, 107, 103, 111);
const files = process.argv.slice(2).length ? [] : execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
function walk(path) {
  if (statSync(path).isDirectory()) for (const child of readdirSync(path)) walk(join(path, child));
  else files.push(path);
}
for (const path of process.argv.slice(2)) walk(path);
const failures = files.filter((path) => readFileSync(path).toString('utf8').toLowerCase().includes(restricted));
if (failures.length) {
  console.error('Restricted provider naming remains in:', ...failures);
  process.exitCode = 1;
} else console.log(`Product language check passed for ${files.length} files.`);
