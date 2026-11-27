// BulleBrowser feedback receiver.
//
// The desktop app sends the thumbs up or down a user gives a chat reply or a
// strategy playbook, with the optional comment they typed. Nothing else is
// collected: no account, no reply text, no browsing data. The rated item is
// identified by a one-way hash the app makes, so a changed rating replaces the
// old one, and the address a request came from is only kept as a salted hash
// that changes daily, for abuse limits.
//
// POST /v1/feedback          { item, kind, rating, comment, version, platform }
//                            rating null removes an earlier rating
// GET  /v1/feedback/export   CSV of every rating; needs the ADMIN_TOKEN secret
// GET  /health

const MAX_BODY = 4096;
const MAX_COMMENT = 1000;
const KINDS = new Set(['reply', 'strategy']);
const PLATFORMS = new Set(['darwin', 'win32', 'linux']);

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...extra } });

const today = (now) => new Date(now).toISOString().slice(0, 10);

async function sha256(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Plain text only: control characters (other than line breaks) are dropped.
const cleanComment = (text) => text.replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, MAX_COMMENT);

export function validate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { item, kind, rating, comment = '', version, platform } = body;
  if (typeof item !== 'string' || !/^[a-f0-9]{32,64}$/.test(item)) return null;
  if (!KINDS.has(kind)) return null;
  if (rating !== 'up' && rating !== 'down' && rating !== null) return null;
  if (typeof comment !== 'string' || comment.length > MAX_COMMENT * 2) return null;
  if (typeof version !== 'string' || !/^\d{1,4}\.\d{1,4}\.\d{1,6}$/.test(version)) return null;
  if (!PLATFORMS.has(platform)) return null;
  return { item, kind, rating, comment: cleanComment(comment), version, platform };
}

// Counts one request against a daily bucket and returns the new count.
async function bump(db, bucket, day) {
  const row = await db
    .prepare(
      `INSERT INTO limits (bucket, day, count) VALUES (?1, ?2, 1)
       ON CONFLICT(bucket) DO UPDATE SET count = CASE WHEN day = ?2 THEN count + 1 ELSE 1 END, day = ?2
       RETURNING count`,
    )
    .bind(bucket, day)
    .first();
  return Number(row?.count ?? 1);
}

async function overLimit(request, env, day) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const ipKey = `ip:${(await sha256(`${day}|${env.LIMIT_SALT || 'bullebrowser'}|${ip}`)).slice(0, 32)}`;
  if ((await bump(env.DB, ipKey, day)) > Number(env.DAILY_IP_LIMIT || 60)) return true;
  if ((await bump(env.DB, 'all', day)) > Number(env.DAILY_GLOBAL_LIMIT || 5000)) return true;
  return false;
}

async function receive(request, env, now) {
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
    return json({ error: 'expected_json' }, 415);
  }
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BODY) return json({ error: 'too_large' }, 413);
  const raw = await request.text();
  if (raw.length > MAX_BODY) return json({ error: 'too_large' }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: 'invalid' }, 400); }
  const entry = validate(body);
  if (!entry) return json({ error: 'invalid' }, 400);

  const day = today(now);
  if (await overLimit(request, env, day)) return json({ error: 'rate_limited' }, 429, { 'retry-after': '3600' });

  if (entry.rating === null) {
    await env.DB.prepare('DELETE FROM feedback WHERE item = ?1').bind(entry.item).run();
    return json({ ok: true, removed: true });
  }
  const at = new Date(now).toISOString();
  await env.DB
    .prepare(
      `INSERT INTO feedback (item, kind, rating, comment, version, platform, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
       ON CONFLICT(item) DO UPDATE SET kind = ?2, rating = ?3, comment = ?4, version = ?5, platform = ?6, updated_at = ?7`,
    )
    .bind(entry.item, entry.kind, entry.rating, entry.comment, entry.version, entry.platform, at)
    .run();
  return json({ ok: true });
}

const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

async function constantTimeEqual(a, b) {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

async function exportCsv(request, env) {
  const token = env.ADMIN_TOKEN || '';
  const given = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token || !given || !(await constantTimeEqual(given, token))) return json({ error: 'unauthorized' }, 401);
  const { results } = await env.DB
    .prepare('SELECT updated_at, kind, rating, comment, version, platform FROM feedback ORDER BY updated_at DESC')
    .all();
  const lines = ['updated_at,kind,rating,comment,version,platform', ...results.map((r) =>
    [r.updated_at, r.kind, r.rating, r.comment, r.version, r.platform].map(csvCell).join(','))];
  return new Response(lines.join('\n'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store' } });
}

export default {
  async fetch(request, env, _ctx, now = Date.now()) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ ok: true, service: 'bullebrowser-feedback' });
    if (url.pathname === '/v1/feedback') {
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
      try {
        return await receive(request, env, now);
      } catch {
        return json({ error: 'unavailable' }, 503);
      }
    }
    if (url.pathname === '/v1/feedback/export' && request.method === 'GET') return exportCsv(request, env);
    return json({ error: 'not_found' }, 404);
  },
};
