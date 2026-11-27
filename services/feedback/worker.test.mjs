import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import worker, { validate } from './src/worker.mjs';

const require = createRequire(import.meta.url);
const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

// D1, backed by real SQLite where this Node has it, so the SQL itself is
// exercised; a small in-memory stand-in otherwise (CI runs Node 20).
function sqliteD1() {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  const prepare = (sql) => {
    let args = [];
    const stmt = db.prepare(sql.replace(/\?(\d+)/g, ':p$1'));
    const named = () => Object.fromEntries(args.map((value, i) => [`p${i + 1}`, value]));
    const api = {
      bind: (...values) => { args = values; return api; },
      first: async () => stmt.get(named()) ?? null,
      run: async () => { stmt.run(named()); return { success: true }; },
      all: async () => ({ results: stmt.all(named()) }),
    };
    return api;
  };
  return { prepare, rows: () => db.prepare('SELECT * FROM feedback ORDER BY updated_at').all() };
}

function memoryD1() {
  const feedback = new Map();
  const limits = new Map();
  const prepare = (sql) => {
    let a = [];
    const api = {
      bind: (...values) => { a = values; return api; },
      first: async () => {
        const [bucket, day] = a;
        const row = limits.get(bucket);
        const count = row && row.day === day ? row.count + 1 : 1;
        limits.set(bucket, { day, count });
        return { count };
      },
      run: async () => {
        if (sql.startsWith('DELETE')) feedback.delete(a[0]);
        else {
          const [item, kind, rating, comment, version, platform, at] = a;
          feedback.set(item, { item, kind, rating, comment, version, platform, created_at: feedback.get(item)?.created_at ?? at, updated_at: at });
        }
        return { success: true };
      },
      all: async () => ({ results: [...feedback.values()].sort((x, y) => y.updated_at.localeCompare(x.updated_at)) }),
    };
    return api;
  };
  return { prepare, rows: () => [...feedback.values()] };
}

let hasSqlite = true;
try { require('node:sqlite'); } catch { hasSqlite = false; }
if (process.env.FEEDBACK_TEST_MEMORY) hasSqlite = false;
const makeDb = () => (hasSqlite ? sqliteD1() : memoryD1());

const ITEM = 'a'.repeat(64);
const good = (extra = {}) => ({ item: ITEM, kind: 'reply', rating: 'down', comment: 'The deadline was wrong.', version: '0.2.106', platform: 'darwin', ...extra });

async function post(env, body, { ip = '203.0.113.7', now = Date.UTC(2026, 10, 27, 12), headers = {} } = {}) {
  const request = new Request('https://feedback.example/v1/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return worker.fetch(request, env, {}, now);
}

test('stores a rating with its comment, and a new rating of the same item replaces it', async () => {
  const DB = makeDb();
  const env = { DB };
  assert.equal((await post(env, good())).status, 200);
  assert.equal((await post(env, good({ rating: 'up', comment: '' }), { now: Date.UTC(2026, 10, 27, 13) })).status, 200);
  const rows = DB.rows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rating, 'up');
  assert.equal(rows[0].comment, '');
  assert.equal(rows[0].created_at, '2026-11-27T12:00:00.000Z');
  assert.equal(rows[0].updated_at, '2026-11-27T13:00:00.000Z');
});

test('a rating taken back is removed', async () => {
  const DB = makeDb();
  await post({ DB }, good());
  const response = await post({ DB }, good({ rating: null }));
  assert.equal(response.status, 200);
  assert.equal(DB.rows().length, 0);
});

test('nothing but the rating, comment, version and platform is kept', async () => {
  const DB = makeDb();
  await post({ DB }, { ...good(), email: 'someone@example.com', reply: 'Private text' });
  assert.deepEqual(Object.keys(DB.rows()[0]).sort(), ['comment', 'created_at', 'item', 'kind', 'platform', 'rating', 'updated_at', 'version']);
});

test('refuses malformed or oversized requests without touching the database', async () => {
  const DB = makeDb();
  for (const body of [
    good({ item: 'not-a-hash' }), good({ kind: 'other' }), good({ rating: 'meh' }), good({ version: 'latest' }),
    good({ platform: 'android' }), good({ comment: 'x'.repeat(2500) }), '[1,2]', 'not json',
  ]) {
    assert.equal((await post({ DB }, body)).status, 400, JSON.stringify(body).slice(0, 60));
  }
  assert.equal((await post({ DB }, JSON.stringify({ ...good(), pad: 'x'.repeat(5000) }))).status, 413);
  const wrongType = await worker.fetch(new Request('https://feedback.example/v1/feedback', { method: 'POST', body: JSON.stringify(good()) }), { DB });
  assert.equal(wrongType.status, 415);
  assert.equal((await worker.fetch(new Request('https://feedback.example/v1/feedback'), { DB })).status, 405);
  assert.equal(DB.rows().length, 0);
});

test('limits how much one address can send in a day', async () => {
  const DB = makeDb();
  const env = { DB, DAILY_IP_LIMIT: '3' };
  const statuses = [];
  for (let i = 0; i < 5; i += 1) statuses.push((await post(env, good({ item: String(i).repeat(64) }))).status);
  assert.deepEqual(statuses, [200, 200, 200, 429, 429]);
  assert.equal((await post(env, good({ item: 'b'.repeat(64) }), { ip: '198.51.100.9' })).status, 200);
  assert.equal((await post(env, good({ item: 'c'.repeat(64) }), { now: Date.UTC(2026, 10, 28, 1) })).status, 200);
});

test('caps the total accepted in a day', async () => {
  const DB = makeDb();
  const env = { DB, DAILY_GLOBAL_LIMIT: '2' };
  const statuses = [];
  for (let i = 0; i < 3; i += 1) statuses.push((await post(env, good({ item: String(i).repeat(64) }), { ip: `192.0.2.${i}` })).status);
  assert.deepEqual(statuses, [200, 200, 429]);
});

test('comments are kept as plain text', () => {
  assert.equal(validate(good({ comment: '  Fine\u0000 work\nthanks  ' })).comment, 'Fine work\nthanks');
});

test('the export needs the admin token', async () => {
  const DB = makeDb();
  await post({ DB }, good({ comment: 'Say "why"' }));
  const get = (auth) => worker.fetch(new Request('https://feedback.example/v1/feedback/export', { headers: auth ? { authorization: auth } : {} }), { DB, ADMIN_TOKEN: 'secret-token' });
  assert.equal((await get()).status, 401);
  assert.equal((await get('Bearer wrong')).status, 401);
  const ok = await get('Bearer secret-token');
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /"down","Say ""why""","0\.2\.106","darwin"/);
  const none = await worker.fetch(new Request('https://feedback.example/v1/feedback/export', { headers: { authorization: 'Bearer ' } }), { DB });
  assert.equal(none.status, 401);
});

test('health check', async () => {
  const response = await worker.fetch(new Request('https://feedback.example/health'), {});
  assert.deepEqual(await response.json(), { ok: true, service: 'bullebrowser-feedback' });
});
