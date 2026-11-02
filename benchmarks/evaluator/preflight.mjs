import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const destination = resolve(process.env.BULLE_EVAL_OUTPUT || 'benchmark-results');
mkdirSync(destination, { recursive: true });
const provider = process.env.BULLE_EVAL_PROVIDER || 'anthropic';
const variable = provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
const missing = [];
if (!['openai', 'anthropic'].includes(provider)) missing.push('BULLE_EVAL_PROVIDER must be openai or anthropic.');
if (!process.env[variable]?.trim()) missing.push(`Configure ${variable} in the evaluator secret manager or GitHub Actions secrets.`);
if (!/^[a-f0-9]{40}$/.test(process.env.BULLE_EVAL_REVISION || '')) missing.push('BULLE_EVAL_REVISION must identify the exact 40-character source commit.');
const result = { schemaVersion: 1, status: missing.length ? 'blocked' : 'ready', revision: process.env.BULLE_EVAL_REVISION || null, checkedAt: new Date().toISOString(), missing, measured: false };
writeFileSync(resolve(destination, 'readiness.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
if (missing.length) { for (const reason of missing) console.error(reason); process.exitCode = 1; }
else console.log('Evaluator ready. No benchmark score has been produced by preflight.');
