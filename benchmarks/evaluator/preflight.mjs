import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function evaluatorReadiness(env) {
  const requested = env.BULLE_EVAL_PROVIDER || 'auto';
  const available = { anthropic: !!env.ANTHROPIC_API_KEY?.trim(), openai: !!env.OPENAI_API_KEY?.trim() };
  const provider = requested === 'auto' ? (available.anthropic ? 'anthropic' : available.openai ? 'openai' : null) : requested;
  const missing = [];
  if (!['auto', 'openai', 'anthropic'].includes(requested)) missing.push('BULLE_EVAL_PROVIDER must be auto, openai or anthropic.');
  else if (!provider) missing.push('Configure ANTHROPIC_API_KEY or OPENAI_API_KEY in the evaluator secret manager or GitHub Actions secrets.');
  else if (!available[provider]) missing.push(`Configure ${provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'} in the evaluator secret manager or GitHub Actions secrets.`);
  if (!/^[a-f0-9]{40}$/.test(env.BULLE_EVAL_REVISION || '')) missing.push('BULLE_EVAL_REVISION must identify the exact 40-character source commit.');
  return { schemaVersion: 1, status: missing.length ? 'blocked' : 'ready', provider: ['anthropic', 'openai'].includes(provider) ? provider : null, revision: env.BULLE_EVAL_REVISION || null, checkedAt: new Date().toISOString(), missing, measured: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const destination = resolve(process.env.BULLE_EVAL_OUTPUT || 'benchmark-results');
  mkdirSync(destination, { recursive: true });
  const result = evaluatorReadiness(process.env);
  writeFileSync(resolve(destination, 'readiness.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  if (result.missing.length) { for (const reason of result.missing) console.error(reason); process.exitCode = 1; }
  else {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `provider=${result.provider}\n`);
    console.log(`Evaluator ready for ${result.provider}. No benchmark score has been produced by preflight.`);
  }
}
