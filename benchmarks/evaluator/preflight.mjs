import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Anthropic workload identity federation from GitHub Actions: the job's OIDC
// token is exchanged for short-lived Claude access, so no key is stored.
const FEDERATION_IDS = ['ANTHROPIC_FEDERATION_RULE_ID', 'ANTHROPIC_ORGANIZATION_ID', 'ANTHROPIC_SERVICE_ACCOUNT_ID'];
const GITHUB_TOKEN_REQUEST = ['ACTIONS_ID_TOKEN_REQUEST_URL', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN'];
export const FEDERATION_AUDIENCE = 'https://api.anthropic.com';
const value = (env, name) => env[name]?.trim() || '';

/** Complete, partial (naming what is missing) or absent. */
export function federationSetup(env) {
  if (!FEDERATION_IDS.some((name) => value(env, name))) return { state: 'absent', missing: [] };
  const missing = [...FEDERATION_IDS, ...GITHUB_TOKEN_REQUEST].filter((name) => !value(env, name));
  return { state: missing.length ? 'partial' : 'complete', missing };
}

export function evaluatorReadiness(env) {
  const requested = env.BULLE_EVAL_PROVIDER || 'auto';
  const anthropicKey = !!value(env, 'ANTHROPIC_API_KEY');
  const federation = federationSetup(env);
  const available = { anthropic: anthropicKey || federation.state === 'complete', openai: !!value(env, 'OPENAI_API_KEY') };
  const provider = requested === 'auto' ? (available.anthropic ? 'anthropic' : available.openai ? 'openai' : null) : requested;
  const missing = [];
  if (!['auto', 'openai', 'anthropic'].includes(requested)) missing.push('BULLE_EVAL_PROVIDER must be auto, openai or anthropic.');
  else if (!provider) missing.push('Configure ANTHROPIC_API_KEY, Anthropic workload identity federation, or OPENAI_API_KEY in the evaluator secret manager or GitHub Actions.');
  else if (!available[provider]) missing.push(provider === 'openai'
    ? 'Configure OPENAI_API_KEY in the evaluator secret manager or GitHub Actions secrets.'
    : 'Configure ANTHROPIC_API_KEY or Anthropic workload identity federation in the evaluator secret manager or GitHub Actions.');
  if (federation.state === 'partial' && !anthropicKey && provider !== 'openai') {
    missing.push(`Anthropic workload identity federation is incomplete; missing ${federation.missing.join(', ')}. GitHub provides ACTIONS_ID_TOKEN_REQUEST_URL and ACTIONS_ID_TOKEN_REQUEST_TOKEN only to jobs granted id-token: write.`);
  }
  if (!/^[a-f0-9]{40}$/.test(env.BULLE_EVAL_REVISION || '')) missing.push('BULLE_EVAL_REVISION must identify the exact 40-character source commit.');
  const valid = ['anthropic', 'openai'].includes(provider);
  const credential = !valid || !available[provider] ? null : provider === 'anthropic' && !anthropicKey ? 'federation' : 'api_key';
  return { schemaVersion: 1, status: missing.length ? 'blocked' : 'ready', provider: valid ? provider : null, credential, revision: env.BULLE_EVAL_REVISION || null, checkedAt: new Date().toISOString(), missing, measured: false };
}

/**
 * Performs one real exchange so a rule that refuses this run fails here, before
 * the build, with a reason. Returns null on success. Never reports a token.
 */
export async function verifyFederation(env, fetchImpl = fetch) {
  let identity;
  try {
    const url = new URL(value(env, 'ACTIONS_ID_TOKEN_REQUEST_URL'));
    url.searchParams.set('audience', FEDERATION_AUDIENCE);
    const response = await fetchImpl(url, { headers: { authorization: `Bearer ${value(env, 'ACTIONS_ID_TOKEN_REQUEST_TOKEN')}` } });
    if (!response.ok) return `GitHub did not issue an identity token (HTTP ${response.status}).`;
    identity = (await response.json()).value;
  } catch { return 'GitHub did not issue an identity token.'; }
  if (typeof identity !== 'string' || !identity) return 'GitHub returned no identity token.';
  const workspace = value(env, 'ANTHROPIC_WORKSPACE_ID');
  let response;
  try {
    response = await fetchImpl(new URL('/v1/oauth/token', value(env, 'ANTHROPIC_BASE_URL') || 'https://api.anthropic.com'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'anthropic-beta': 'oauth-2025-04-20,oidc-federation-2026-04-01' },
      body: JSON.stringify({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: identity,
        federation_rule_id: value(env, 'ANTHROPIC_FEDERATION_RULE_ID'),
        organization_id: value(env, 'ANTHROPIC_ORGANIZATION_ID'),
        service_account_id: value(env, 'ANTHROPIC_SERVICE_ACCOUNT_ID'),
        ...(workspace ? { workspace_id: workspace } : {}),
      }),
    });
  } catch { return 'The Anthropic token endpoint could not be reached.'; }
  if (!response.ok) return `Anthropic refused the federated token exchange (HTTP ${response.status}). Check that this run matches the federation rule (repository, branch and audience); the Claude Console's workload identity history shows the reason.`;
  const body = await response.json().catch(() => ({}));
  return typeof body.access_token === 'string' && body.access_token ? null : 'Anthropic returned no access token.';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const destination = resolve(process.env.BULLE_EVAL_OUTPUT || 'benchmark-results');
  mkdirSync(destination, { recursive: true });
  const result = evaluatorReadiness(process.env);
  if (!result.missing.length && result.credential === 'federation') {
    const failure = await verifyFederation(process.env);
    if (failure) Object.assign(result, { status: 'blocked', missing: [failure] });
  }
  writeFileSync(resolve(destination, 'readiness.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  if (result.missing.length) { for (const reason of result.missing) console.error(reason); process.exitCode = 1; }
  else {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `provider=${result.provider}\n`);
    console.log(`Evaluator ready for ${result.provider}${result.credential === 'federation' ? ' through workload identity federation' : ''}. No benchmark score has been produced by preflight.`);
  }
}
