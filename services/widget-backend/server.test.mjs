import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createHmac, randomBytes } from 'node:crypto';
const secret = randomBytes(48).toString('hex');
const previous = { WIDGET_AUTH_SECRET: process.env.WIDGET_AUTH_SECRET, ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS, NODE_ENV: process.env.NODE_ENV };
process.env.WIDGET_AUTH_SECRET = secret;
process.env.ALLOWED_ORIGINS = 'https://crm.example';
process.env.NODE_ENV = 'test';
const { createWidgetServer } = await import('./dist/server.mjs');
for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
function token(sub) {
  const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encoded({ alg: 'HS256' })}.${encoded({ sub, aud: 'bullebrowser-widget', exp: Math.floor(Date.now() / 1000) + 60 })}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}
class Response extends EventEmitter {
  headers = {}; statusCode = 200; writableEnded = false; headersSent = false; writableLength = 0;
  setHeader(name, value) { this.headers[name.toLowerCase()] = value; }
  writeHead(status, headers = {}) { this.statusCode = status; this.headersSent = true; for (const [key, value] of Object.entries(headers)) this.setHeader(key, value); return this; }
  write(value) { this.content = (this.content || '') + value; return true; }
  end(value = '') { this.write(value); this.writableEnded = true; this.emit('finish'); this.emit('close'); return this; }
}
async function request(url, { method = 'GET', body, identity, origin = 'https://crm.example' } = {}) {
  const server = createWidgetServer();
  const req = Object.assign(Readable.from(body === undefined ? [] : [body]), { method, url, headers: { origin, 'content-type': 'application/json', ...(identity ? { authorization: `Bearer ${token(identity)}` } : {}) }, socket: { remoteAddress: '127.0.0.1' } });
  const res = new Response();
  server.emit('request', req, res);
  await new Promise(resolve => setImmediate(resolve));
  return res;
}
test('rejects unauthorized streams and disallowed origins', async () => {
  assert.equal((await request('/stream?sessionId=unauthorized')).statusCode, 401);
  assert.equal((await request('/health', { origin: 'https://untrusted.example' })).statusCode, 403);
});
test('handles malformed JSON and unsupported routes without process failure', async () => {
  assert.equal((await request('/start', { method: 'POST', body: '{broken', identity: 'user' })).statusCode, 400);
  assert.equal((await request('/stream', { method: 'POST', identity: 'user' })).statusCode, 404);
  assert.equal((await request('/health')).statusCode, 200);
});
test('retains an SSE session after request completion and enforces ownership and cleanup', async () => {
  const stream = await request('/stream?sessionId=retained', { identity: 'owner' });
  try {
    assert.equal(stream.statusCode, 200);
    const duplicate = await request('/stream?sessionId=retained', { identity: 'owner' });
    assert.equal(duplicate.statusCode, 409);
    const payload = JSON.stringify({ sessionId: 'retained', prompt: 'Find a contact', title: 'Contacts', url: 'https://crm.example/contacts' });
    assert.equal((await request('/start', { method: 'POST', identity: 'other', body: payload })).statusCode, 403);
    assert.equal((await request('/tool-result', { method: 'POST', identity: 'owner', body: JSON.stringify({ sessionId: 'retained', id: 't1', result: {} }) })).statusCode, 409);
  } finally { stream.end(); }
  const reopened = await request('/stream?sessionId=retained', { identity: 'owner' });
  assert.equal(reopened.statusCode, 200);
  stream.emit('close'); // A late event from the old stream cannot delete the replacement.
  assert.equal((await request('/stream?sessionId=retained', { identity: 'owner' })).statusCode, 409);
  reopened.end();
});
test('limits live streams per identity and frees capacity on disconnect', async () => {
  const streams = [];
  try {
    for (let i = 0; i < 3; i++) streams.push(await request(`/stream?sessionId=cap${i}`, { identity: 'limited' }));
    assert.equal((await request('/stream?sessionId=cap3', { identity: 'limited' })).statusCode, 429);
    streams.pop().end();
    const next = await request('/stream?sessionId=cap3', { identity: 'limited' });
    assert.equal(next.statusCode, 200); streams.push(next);
  } finally { for (const stream of streams) stream.end(); }
});
