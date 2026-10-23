import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { PLANS, paidPlan, modelReservation } from './plans.mjs';
import { stripeEvent, cloudAdapters } from './adapters.mjs';

test('approved prices and search quotas are explicit and unknown plans denied', () => {
  assert.equal(PLANS.free.searches,10);
  assert.equal(paidPlan('individual').monthlyCents,1599);
  assert.equal(paidPlan('pro_plus').searches,1000);
  assert.equal(paidPlan('pro_max').monthlyCents,3099);
  assert.throws(() => paidPlan('__proto__'));
  assert.throws(() => paidPlan('free'));
});
test('webhook signatures cover exact raw bytes, expire and support rotated secrets', () => {
  const raw = Buffer.from('{"id":"evt_test"}');
  const now = 1000000;
  const signature = createHmac('sha256','secret').update('1000.').update(raw).digest('hex');
  assert.equal(stripeEvent(raw,`t=1000,v1=${'a'.repeat(64)},v1=${signature}`,'secret',now).id,'evt_test');
  assert.throws(() => stripeEvent(Buffer.from('{}'),`t=1000,v1=${signature}`,'secret',now));
  assert.throws(() => stripeEvent(raw,`t=1000,v1=${signature}`,'secret',now+400000));
  assert.throws(() => stripeEvent(raw,undefined,'secret',now));
});
test('authentication rejects local IDs, anonymous and unverified accounts', async () => {
  const env = { SUPABASE_URL:'https://auth.example.com', SUPABASE_ANON_KEY:'public', SUPABASE_SERVICE_ROLE_KEY:'private' };
  let calls = 0;
  const adapter = cloudAdapters(env, async () => { calls++; return new Response(JSON.stringify({id:'uuid', email:'a@example.com'})); });
  await assert.rejects(adapter.identity('local-install-id'));
  assert.equal(calls,0);
  await assert.rejects(adapter.identity('Bearer token'));
  const verified = cloudAdapters(env, async () => new Response(JSON.stringify({ id:'uuid', email:'a@example.com', email_confirmed_at:'2026-01-01' })));
  assert.equal((await verified.identity('Bearer token')).id,'uuid');
});
test('cost reservations reject negative, fractional token counts and overflow', () => {
  assert.equal(modelReservation({inputBytes:0,maxOutputTokens:100,inputRate:1,outputRate:2}),4296);
  assert.throws(() => modelReservation({inputBytes:-1,maxOutputTokens:1,inputRate:1,outputRate:1}));
  assert.throws(() => modelReservation({inputBytes:0.5,maxOutputTokens:1,inputRate:1,outputRate:1}));
  assert.throws(() => modelReservation({inputBytes:1e20,maxOutputTokens:1,inputRate:1,outputRate:1}));
});
