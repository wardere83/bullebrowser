import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { webSearchTool } from '../../packages/agent-core/src/search.ts';
import { cloudAdapters, stripeEvent } from './adapters.mjs';
import { PLANS } from './plans.mjs';

const env = process.env;
const enabled = env.CLOUD_ENABLED === 'true';
const billing = env.BILLING_ENABLED === 'true';
const adapters = enabled ? cloudAdapters(env) : null;
const prices = Object.fromEntries(['individual', 'pro_plus', 'pro_max'].map((name) => [name, env[`STRIPE_PRICE_${name.toUpperCase()}`]]));
const origin = env.PUBLIC_APP_ORIGIN;
if (billing && (!origin || new URL(origin).protocol !== 'https:' || !env.STRIPE_WEBHOOK_SECRET || Object.values(prices).some((p) => !p))) throw new Error('Billing configuration incomplete');

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256000) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

createServer(async (req, res) => {
  const json = (value, code = 200) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(value));
  };
  const path = new URL(req.url, 'http://local').pathname;
  if (path === '/health' && req.method === 'GET') return json({ ok: true, enabled, billing });
  if (!adapters) return json({ error: 'Service not activated' }, 503);
  try {
    if (path === '/billing/webhook' && req.method === 'POST') {
      if (!billing) return json({ error: 'Billing disabled' }, 503);
      const raw = await readBody(req);
      let event;
      try { event = stripeEvent(raw, req.headers['stripe-signature'], env.STRIPE_WEBHOOK_SECRET); }
      catch { return json({ error: 'Invalid signature' }, 400); }
      // Entitlements come from the current Stripe subscription, NOT client
      // metadata or a checkout success redirect. Replays are deduplicated in DB.
      if (['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed'].includes(event.type)) {
        // This RPC queues verified events for reconciliation; it never grants
        // paid access itself. A reconciler must retrieve current Stripe state.
        await adapters.rpc('bb_queue_billing_event', { event_id: event.id, event_type: event.type, payload: event.data.object });
      }
      return json({ received: true });
    }
    let user;
    try { user = await adapters.identity(req.headers.authorization); }
    catch { return json({ error: 'Sign in with a verified email account' }, 401); }
    if (path === '/usage' && req.method === 'GET') return json(await adapters.rpc('bb_usage', { account_id: user.id }));
    if (path === '/search' && req.method === 'POST') {
      const input = JSON.parse((await readBody(req)).toString());
      if (typeof input.query !== 'string' || !input.query.trim() || input.query.length > 400) return json({ error: 'Invalid search query' }, 400);
      if (!env.BRAVE_SEARCH_API_KEY) return json({ error: 'Search is not configured' }, 503);
      const id = randomUUID();
      const allowed = await adapters.rpc('bb_reserve_search', { account_id: user.id, request_id: id });
      if (!allowed.allowed) return json({ error: 'Search allowance reached', usage: allowed, upgrade: '/billing/checkout' }, 402);
      const controller = new AbortController();
      res.on('close', () => { if (!res.writableEnded) controller.abort(); });
      // Reservations remain charged on ambiguous provider failures: we cannot
      // know whether a timed-out request consumed upstream quota.
      const result = await webSearchTool({ apiKey: env.BRAVE_SEARCH_API_KEY, signal: controller.signal }).execute({ query: input.query, count: 5 });
      return json({ ...result, usage: allowed });
    }
    if (path === '/billing/checkout' && req.method === 'POST') {
      // Until entitlement reconciliation is implemented, do not take money.
      return json({ error: 'Subscriptions are not available yet', plans: PLANS }, 503);
    }
    if (path.startsWith('/models/') || path === '/billing/top-up') return json({ error: 'Hosted model credits are not activated' }, 503);
    return json({ error: 'Not found' }, 404);
  } catch {
    // No request bodies, provider responses, keys or tokens in logs/errors.
    return json({ error: 'Request could not complete. Retry later.' }, 503);
  }
}).listen(Number(env.PORT || 8788), '0.0.0.0');
