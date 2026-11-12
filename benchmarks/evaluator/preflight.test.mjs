import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluatorReadiness, federationSetup, verifyFederation, FEDERATION_AUDIENCE } from './preflight.mjs';
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
  assert.match(workflow, /vars\.BULLE_EVAL_PROVIDER/);  // Claude access through workload identity federation needs GitHub's OIDC token.
  assert.match(workflow, /id-token: write/);
  for (const name of ['ANTHROPIC_FEDERATION_RULE_ID: fdrl_', 'ANTHROPIC_ORGANIZATION_ID: ', 'ANTHROPIC_SERVICE_ACCOUNT_ID: svac_', 'ANTHROPIC_WORKSPACE_ID: wrkspc_']) assert.ok(workflow.includes(name), name);
});

const federation = {
  ANTHROPIC_FEDERATION_RULE_ID: 'fdrl_test', ANTHROPIC_ORGANIZATION_ID: '00000000-0000-0000-0000-000000000000', ANTHROPIC_SERVICE_ACCOUNT_ID: 'svac_test',
  ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.actions.example/request?api-version=2.0', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-placeholder',
};
test('workload identity federation counts as an Anthropic credential, after a saved key', () => {
  const ready = evaluatorReadiness({ ...input, ...federation });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.provider, 'anthropic');
  assert.equal(ready.credential, 'federation');
  assert.equal(evaluatorReadiness({ ...input, ...federation, ANTHROPIC_API_KEY: 'test-placeholder' }).credential, 'api_key');
  assert.equal(evaluatorReadiness({ ...input, ...federation, BULLE_EVAL_PROVIDER: 'openai' }).status, 'blocked');
  assert.equal(federationSetup({}).state, 'absent');
});
test('incomplete federation names what is missing instead of silently using another provider', () => {
  const { ACTIONS_ID_TOKEN_REQUEST_URL: _url, ACTIONS_ID_TOKEN_REQUEST_TOKEN: _token, ...withoutGithub } = federation;
  assert.deepEqual(federationSetup(withoutGithub).missing, ['ACTIONS_ID_TOKEN_REQUEST_URL', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN']);
  const blocked = evaluatorReadiness({ ...input, ...withoutGithub });
  assert.equal(blocked.status, 'blocked');
  assert.match(blocked.missing.join(' '), /id-token: write/);
  // An explicit OpenAI run is unaffected by unrelated Anthropic settings.
  assert.equal(evaluatorReadiness({ ...input, ...withoutGithub, BULLE_EVAL_PROVIDER: 'openai', OPENAI_API_KEY: 'test-placeholder' }).status, 'ready');
});
function exchangeNetwork(tokenStatus = 200) {
  const exchanges = [];
  const fetchImpl = async (target, init = {}) => {
    const url = new URL(target);
    if (url.hostname === 'token.actions.example') {
      assert.equal(url.searchParams.get('audience'), FEDERATION_AUDIENCE);
      assert.equal(url.searchParams.get('api-version'), '2.0');
      assert.equal(init.headers.authorization, 'Bearer request-placeholder');
      return Response.json({ value: 'github-jwt-placeholder' });
    }
    assert.equal(url.href, 'https://api.anthropic.com/v1/oauth/token');
    assert.match(init.headers['anthropic-beta'], /oidc-federation-2026-04-01/);
    exchanges.push(JSON.parse(init.body));
    return tokenStatus === 200 ? Response.json({ access_token: 'sk-ant-oat01-placeholder', expires_in: 600 }) : Response.json({ type: 'error' }, { status: tokenStatus });
  };
  return { fetchImpl, exchanges };
}
test('federation preflight performs one real-shaped exchange and never reports the token', async () => {
  const { fetchImpl, exchanges } = exchangeNetwork();
  assert.equal(await verifyFederation({ ...federation, ANTHROPIC_WORKSPACE_ID: 'wrkspc_test' }, fetchImpl), null);
  assert.deepEqual(exchanges, [{ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: 'github-jwt-placeholder',
    federation_rule_id: 'fdrl_test', organization_id: '00000000-0000-0000-0000-000000000000', service_account_id: 'svac_test', workspace_id: 'wrkspc_test' }]);
  const refused = await verifyFederation(federation, exchangeNetwork(401).fetchImpl);
  assert.match(refused, /refused the federated token exchange \(HTTP 401\)/);
  assert.doesNotMatch(refused, /placeholder/);
  assert.match(await verifyFederation(federation, async () => new Response('denied', { status: 403 })), /GitHub did not issue an identity token \(HTTP 403\)/);
  assert.match(await verifyFederation(federation, async () => { throw new Error('offline'); }), /GitHub did not issue an identity token\./);
});
test('CLI blocks a federated run whose exchange cannot complete', () => {
  const dir = mkdtempSync(join(tmpdir(), 'funding-preflight-'));
  try {
    const run = spawnSync(process.execPath, [fileURLToPath(new URL('./preflight.mjs', import.meta.url))], { encoding: 'utf8',
      env: { ...input, ...federation, ACTIONS_ID_TOKEN_REQUEST_URL: 'http://127.0.0.1:9/request', BULLE_EVAL_OUTPUT: dir } });
    assert.equal(run.status, 1, run.stdout);
    const readiness = JSON.parse(readFileSync(join(dir, 'readiness.json'), 'utf8'));
    assert.equal(readiness.status, 'blocked');
    assert.equal(readiness.credential, 'federation');
    assert.doesNotMatch(run.stdout + run.stderr + JSON.stringify(readiness), /request-placeholder/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
