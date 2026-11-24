import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './src/worker.mjs';

function kv() {
  const store = new Map();
  return { store, get: async (key) => store.get(key) ?? null, put: async (key, value) => { store.set(key, value); } };
}

async function call(path, { method = 'POST', headers = {}, env: overrides = {} } = {}) {
  const env = { METER: kv(), ANTHROPIC_API_KEY: 'sk-ant-test', OPENAI_API_KEY: 'sk-test', FREE_PROMPTS: '2', ...overrides };
  const upstream = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => { upstream.push({ url: String(url), method: init.method }); return new Response('{}', { status: 200 }); };
  try {
    const response = await worker.fetch(new Request(`https://gw.example${path}`, { method, headers: { 'x-bulle-install': 'install-1', 'x-bulle-turn': 'turn-1', ...headers }, body: method === 'POST' ? '{}' : undefined }), env);
    return { response, upstream, env };
  } finally { globalThis.fetch = original; }
}

test('proxies only the documented model endpoints', async () => {
  for (const path of ['/v1/anthropic/v1/messages', '/v1/openai/v1/chat/completions', '/v1/openai/v1/audio/transcriptions']) {
    const { response, upstream } = await call(path);
    assert.equal(response.status, 200, path);
    assert.equal(upstream.length, 1);
  }
  for (const [path, method] of [['/v1/openai/v1/files', 'GET'], ['/v1/openai/v1/fine_tuning/jobs', 'POST'], ['/v1/anthropic/v1/messages/batches', 'POST'], ['/v1/anthropic/v1/messages', 'GET'], ['/v1/openai/v1/models/gpt-4o', 'DELETE']]) {
    const { response, upstream, env } = await call(path, { method });
    assert.equal(response.status, 404, `${method} ${path}`);
    assert.equal(upstream.length, 0, `${method} ${path} reached the provider`);
    assert.equal(env.METER.store.size, 0, `${method} ${path} touched the meter`);
  }
});

test('a request without a turn id still spends the free allowance', async () => {
  const meter = kv();
  const statuses = [];
  for (let i = 0; i < 4; i++) {
    const { response } = await call('/v1/anthropic/v1/messages', { headers: { 'x-bulle-turn': '' }, env: { METER: meter } });
    statuses.push(response.status);
  }
  assert.deepEqual(statuses, [200, 200, 402, 402]);
});

test('calls within one turn are counted once', async () => {
  const meter = kv();
  const statuses = [];
  for (let i = 0; i < 4; i++) statuses.push((await call('/v1/anthropic/v1/messages', { env: { METER: meter } })).response.status);
  assert.deepEqual(statuses, [200, 200, 200, 200]);
  assert.equal(meter.store.get('count:install-1'), '1');
});
