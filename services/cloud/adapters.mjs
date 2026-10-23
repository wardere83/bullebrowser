import { createHmac, timingSafeEqual } from 'node:crypto';

export function stripeEvent(raw, signature, secret, now = Date.now()) {
  if (!secret || typeof signature !== 'string') throw new Error('Invalid webhook');
  const parts = signature.split(',').map((x) => x.split('='));
  const timestamp = parts.find(([key]) => key === 't')?.[1];
  if (!timestamp || !/^\d+$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300) throw new Error('Expired webhook');
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest();
  const valid = parts.filter(([key]) => key === 'v1').some(([, value]) => {
    if (!/^[a-f0-9]{64}$/.test(value ?? '')) return false;
    return timingSafeEqual(expected, Buffer.from(value, 'hex'));
  });
  if (!valid) throw new Error('Invalid webhook signature');
  return JSON.parse(raw.toString('utf8'));
}

export function cloudAdapters(env, request = fetch) {
  const root = env.SUPABASE_URL?.replace(/\/$/, '');
  if (!root || new URL(root).protocol !== 'https:' || !env.SUPABASE_SERVICE_ROLE_KEY || !env.SUPABASE_ANON_KEY) throw new Error('Cloud authentication is not configured');
  const fetchJson = async (url, init) => {
    const response = await request(url, { ...init, signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok) throw new Error('Upstream service rejected request');
    return response.json();
  };
  return {
    async identity(authorization) {
      if (!/^Bearer \S+$/.test(authorization ?? '')) throw new Error('Sign in required');
      const user = await fetchJson(`${root}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: authorization } });
      if (!user.id || !user.email || !user.email_confirmed_at || user.is_anonymous) throw new Error('Verified email required');
      return { id: user.id, email: user.email };
    },
    rpc(name, args) {
      return fetchJson(`${root}/rest/v1/rpc/${name}`, {
        method: 'POST', headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
    },
    async stripe(path, fields) {
      if (!env.STRIPE_SECRET_KEY) throw new Error('Billing is not configured');
      return fetchJson(`https://api.stripe.com/v1/${path}`, {
        method: fields ? 'POST' : 'GET', headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        ...(fields ? { body: new URLSearchParams(fields) } : {}),
      });
    },
  };
}
