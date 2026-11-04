import { randomUUID } from 'node:crypto';

export class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function readJson(req, limit = 128 * 1024) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw new RequestError(415, 'JSON content type required');
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) throw new RequestError(413, 'Request body too large');
  const chunks = [];
  let length = 0;
  try {
    for await (const chunk of req) {
      length += Buffer.byteLength(chunk);
      if (length > limit) throw new RequestError(413, 'Request body too large');
      chunks.push(Buffer.from(chunk));
    }
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(400, 'Interrupted request');
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new RequestError(400, 'Malformed JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestError(400, 'JSON object required');
  return value;
}

export function validId(value) { return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value); }
export function validateStart(value, origins) {
  if (!validId(value.sessionId)) throw new RequestError(400, 'Invalid session');
  if (typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 20000) throw new RequestError(400, 'Invalid prompt');
  if (typeof value.title !== 'string' || value.title.length > 1000) throw new RequestError(400, 'Invalid title');
  if (typeof value.url !== 'string') throw new RequestError(400, 'Invalid page URL');
  let url;
  try { url = new URL(value.url); } catch { throw new RequestError(400, 'Invalid page URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || value.url.length > 8192 || (origins.length && !origins.includes(url.origin))) throw new RequestError(400, 'Page origin is not allowed');
}
export function validateResult(value) {
  if (!validId(value.sessionId) || !validId(value.id)) throw new RequestError(400, 'Invalid tool result');
  const hasResult = Object.hasOwn(value, 'result');
  const hasError = Object.hasOwn(value, 'error');
  if (hasResult === hasError || (hasError && (typeof value.error !== 'string' || !value.error || value.error.length > 2000))) throw new RequestError(400, 'Provide a result or an error');
}

// Bound memory even when callers rotate identifiers. Do not trust forwarded IP headers.
export function createLimiter({ limit = 60, windowMs = 60000, capacity = 10000, now = Date.now } = {}) {
  const buckets = new Map();
  return (key) => {
    const time = now();
    for (const [id, entry] of buckets) if (entry.expires <= time) buckets.delete(id);
    let entry = buckets.get(key);
    if (!entry) {
      if (buckets.size >= capacity) return Math.ceil(windowMs / 1000);
      entry = { count: 0, expires: time + windowMs };
      buckets.set(key, entry);
    }
    entry.count += 1;
    return entry.count > limit ? Math.max(1, Math.ceil((entry.expires - time) / 1000)) : 0;
  };
}

export function serviceConfig(env = process.env) {
  const model = env.WIDGET_MODEL || 'claude-opus-4-7';
  if (!/^claude-[a-z0-9.-]{1,100}$/.test(model)) throw new Error('WIDGET_MODEL must be an Anthropic model identifier');
  const origins = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const origin of origins) {
    let parsed;
    try { parsed = new URL(origin); } catch { throw new Error('Invalid ALLOWED_ORIGINS'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) throw new Error('ALLOWED_ORIGINS must contain exact origins');
  }
  if (env.NODE_ENV === 'production' && (!origins.length || !env.ANTHROPIC_API_KEY?.trim() || (env.WIDGET_AUTH_SECRET?.length || 0) < 32)) throw new Error('Production requires approved origins, model credential, and a 32-character authentication secret');
  return { model, origins };
}

export function logRequest(logger, { method, pathname, status, startedAt, requestId = randomUUID() }) {
  // Deliberate allowlist: no token, URL query, prompt, model response, user ID, or exception text.
  logger(JSON.stringify({ event: 'widget.request', requestId, method: ['GET', 'POST', 'OPTIONS'].includes(method) ? method : 'other', route: ['/health', '/stream', '/start', '/tool-result'].includes(pathname) ? pathname : 'unknown', status, durationMs: Math.max(0, Date.now() - startedAt) }));
}

// Page metadata is reference data, never an extension of the trusted system prompt.
export function pageReference(title, url) { return { label: 'widget_page', text: `Page title: ${title}\nPage address: ${url}` }; }
