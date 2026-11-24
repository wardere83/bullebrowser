// BulleBrowser beta gateway — the vendor-funded, keyless path.
//
// Staff run the desktop app with NO API key of their own. The app calls this
// Worker instead of Anthropic/OpenAI directly; the Worker holds the real keys
// (as Cloudflare secrets, never in the client) and proxies the request. Each
// install gets a metered free allowance; once it's used up the Worker returns
// 402 and the app falls back to bring-your-own-key.
//
// Why a server and not an embedded key: BulleBrowser is distributed from a
// public releases page, so any key shipped inside the app is extractable by
// anyone. Keeping the key here — behind metering and spend caps — is the only
// way to offer a keyless beta without publishing the key.
//
// Setup (see README.md):
//   wrangler kv namespace create METER      # put the id in wrangler.toml
//   wrangler secret put ANTHROPIC_API_KEY
//   wrangler secret put OPENAI_API_KEY
//   wrangler deploy
//
// Request contract from the app:
//   POST /v1/anthropic/v1/messages            (Anthropic SDK baseURL = <gw>/v1/anthropic)
//   POST /v1/openai/v1/chat/completions        (OpenAI chat)
//   POST /v1/openai/v1/audio/transcriptions    (Whisper voice)
//   headers: x-bulle-install: <per-install uuid>, x-bulle-turn: <per-prompt id>

const PROVIDERS = {
  anthropic: {
    base: 'https://api.anthropic.com',
    keyEnv: 'ANTHROPIC_API_KEY',
    applyAuth(headers, key) {
      headers.set('x-api-key', key);
      if (!headers.get('anthropic-version')) headers.set('anthropic-version', '2023-06-01');
    },
  },
  openai: {
    base: 'https://api.openai.com',
    keyEnv: 'OPENAI_API_KEY',
    applyAuth(headers, key) {
      headers.set('authorization', `Bearer ${key}`);
    },
  },
};

// The only upstream calls the app makes. Everything else on these accounts
// (files, batches, fine-tuning, admin endpoints, other methods) stays closed,
// because the gateway would otherwise lend its keys to any request.
const ROUTES = new Set([
  'anthropic:v1/messages',
  'openai:v1/chat/completions',
  'openai:v1/audio/transcriptions',
]);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const day = () => new Date().toISOString().slice(0, 10); // yyyy-mm-dd (UTC)
const month = () => new Date().toISOString().slice(0, 7); // yyyy-mm

async function bump(env, key, ttlSeconds) {
  const next = parseInt((await env.METER.get(key)) || '0', 10) + 1;
  await env.METER.put(key, String(next), ttlSeconds ? { expirationTtl: ttlSeconds } : undefined);
  return next;
}

// One user prompt ("turn") drives many model calls; only the first call of a
// new turn spends an allowance unit. Distinct turn ids are de-duplicated for
// 24h so a long agent run never double-counts.
// A request without a turn id is counted as a prompt of its own, so leaving
// the header out cannot skip metering.
async function consumeQuota(env, install, turn, limit) {
  const seenKey = turn ? `seen:${install}:${turn}` : '';
  if (seenKey && (await env.METER.get(seenKey))) return { ok: true };
  const used = parseInt((await env.METER.get(`count:${install}`)) || '0', 10);
  if (used >= limit) return { ok: false, reason: 'trial_exhausted' };
  if (seenKey) await env.METER.put(seenKey, '1', { expirationTtl: 60 * 60 * 24 });
  await env.METER.put(`count:${install}`, String(used + 1));
  return { ok: true };
}

// Backstops so a public download can never drain the account: a per-IP daily
// cap and a global monthly request cap.
async function backstop(env, request) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if ((await bump(env, `ip:${ip}:${day()}`, 60 * 60 * 26)) > parseInt(env.DAILY_IP_LIMIT || '200', 10)) {
    return { error: 'rate_limited', status: 429 };
  }
  if ((await bump(env, `global:${month()}`, 60 * 60 * 24 * 40)) > parseInt(env.MONTHLY_GLOBAL_LIMIT || '5000', 10)) {
    return { error: 'capacity', status: 402 };
  }
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ ok: true, service: 'bullebrowser-gateway' });

    const match = url.pathname.match(/^\/v1\/(anthropic|openai)\/(.+)$/);
    if (!match) return json({ error: 'not_found' }, 404);
    const provider = PROVIDERS[match[1]];
    const upstreamPath = match[2];
    if (request.method !== 'POST' || !ROUTES.has(`${match[1]}:${upstreamPath}`)) return json({ error: 'not_found' }, 404);
    const key = env[provider.keyEnv];
    if (!key) return json({ error: 'gateway_unconfigured' }, 503);

    const install = request.headers.get('x-bulle-install') || 'anon';
    const turn = request.headers.get('x-bulle-turn') || '';
    const limit = parseInt(env.FREE_PROMPTS || '15', 10);

    const quota = await consumeQuota(env, install, turn, limit);
    if (!quota.ok) return json({ error: quota.reason, limit }, 402);

    const capped = await backstop(env, request);
    if (capped) return json({ error: capped.error }, capped.status);

    const target = `${provider.base}/${upstreamPath}${url.search}`;
    const headers = new Headers(request.headers);
    for (const h of ['host', 'authorization', 'x-api-key', 'x-bulle-install', 'x-bulle-turn', 'cf-connecting-ip']) {
      headers.delete(h);
    }
    provider.applyAuth(headers, key);

    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    });
    const outHeaders = new Headers(upstream.headers);
    outHeaders.delete('content-encoding');
    return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
  },
};
