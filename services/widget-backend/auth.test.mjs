import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyIdentity, ownsSession, canUseAccountApi } from './auth.mjs';

const secret = 'test-only-secret-with-at-least-32-characters';
const now = 1700000000000;
function signed(claims, algorithm = 'HS256') {
  const h = Buffer.from(JSON.stringify({ alg: algorithm })).toString('base64url');
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${h}.${p}.${createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`;
}
const claims = { sub: 'user-1', aud: 'bullebrowser-widget', exp: now / 1000 + 300 };
test('requires a valid signed, short-lived identity; never fails open', () => {
  assert.equal(verifyIdentity(signed(claims), secret, now)?.sub, 'user-1');
  for (const token of ['', 'shared-widget-token', signed({ ...claims, exp: now / 1000 }),
    signed({ ...claims, exp: now / 1000 + 3600 }), signed({ ...claims, aud: 'other' }),
    signed({ ...claims, sub: '' }), signed(claims, 'none'), signed(claims) + 'tampered']) {
    assert.equal(verifyIdentity(token, secret, now), null);
  }
  assert.equal(verifyIdentity(signed(claims), '', now), null);
});
test('sessions belong to one authenticated user', () => {
  assert.equal(ownsSession({ owner: 'user-1' }, claims), true);
  assert.equal(ownsSession({ owner: 'user-2' }, claims), false);
  assert.equal(ownsSession(null, claims), false);
});
test('account-wide CRM tools require explicit administrator authorization', () => {
  assert.equal(!!canUseAccountApi(claims), false);
  assert.equal(!!canUseAccountApi({ ...claims, role: 'admin' }), false);
  assert.equal(!!canUseAccountApi({ ...claims, role: 'member', permissions: ['eeo:account'] }), false);
  assert.equal(canUseAccountApi({ ...claims, role: 'admin', permissions: ['eeo:account'] }), true);
});
