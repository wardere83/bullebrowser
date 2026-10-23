// Reference backend for the BulleBrowser embed widget (apps/web/public/widget.js).
//
// WHY THIS EXISTS: an API key must never live in page JavaScript, so the model
// loop runs here, on a server you host. The widget executes the agent's tool
// calls against the CRM page (in the user's own logged-in session) and streams
// results back. This file is a runnable reference — adapt auth, storage, and
// hosting to your infrastructure. It has no framework dependencies beyond
// @bullebrowser/agent-core and Node's built-in http.
//
//   ANTHROPIC_API_KEY=sk-ant-… node services/widget-backend/server.mjs
//
// Endpoints (the contract the widget speaks):
//   POST /start        { sessionId, prompt, url, title }  -> begins a run
//   GET  /stream?sessionId=…   Server-Sent Events: activity | tool_call | text | done | error
//   POST /tool-result  { sessionId, id, result | error }  -> resumes the run
//
// The agent's tools run in the browser, so this server's ToolRuntime is a
// PROXY: each tool call is pushed to the widget over the SSE stream, and the
// method awaits the matching /tool-result before returning.

import http from 'node:http';
import { runAgent } from '@bullebrowser/agent-core';
import { eeoTools } from './eeo-tools.mjs';
import { verifyIdentity, ownsSession, canUseAccountApi } from './auth.mjs';

const PORT = process.env.PORT || 8787;
const MODEL = 'claude-opus-4-7';

// EEO Dashboard Secure API. The key is account-level (X-Public-ID / X-Secret-Key),
// so it stays here in env vars — never in the widget or the page. If either is
// unset, the agent runs browse-only.
const EEO = {
  baseUrl: process.env.EEO_BASE_URL || 'https://projects.bulleconsulting.com/secure-api/',
  publicId: process.env.EEO_PUBLIC_ID,
  secretKey: process.env.EEO_SECRET_KEY,
};
const API_TOOLS = EEO.publicId && EEO.secretKey ? eeoTools(EEO) : [];

// Teach the agent your CRM. Replace this with the guide produced by exploring
// Bulle Cloud (sections, key pages, how to find/create/update records, exact
// button and menu labels). The better this is, the less the agent has to
// rediscover each time.
const CRM_SYSTEM = [
  'You are the BulleBrowser assistant embedded in the EEO Dashboard, a cloud',
  'project-management CRM. You help users with contacts, companies, projects,',
  'marketing audiences, and worlds.',
  '',
  'Prefer the EEO API tools (eeo_*) for anything data-related — they are fast and',
  'reliable. Before creating or updating a record, call the matching *_fields tool',
  '(e.g. eeo_contact_fields) so you use valid field names, including custom fields.',
  'Creating or changing data asks the user to confirm first; respect their answer.',
  'For anything the API does not cover, you may operate the page directly (click,',
  'type, read) — never leave the EEO Dashboard origin.',
  '',
  'When done, give a short, clear answer and say what you did (or would do).',
  'Never reveal API keys or internal identifiers the user would not recognize.',
  '',
  '## CRM guide',
  '(optional: paste any extra notes about your districts, worlds, and workflows here)',
].join('\n');

/** @typedef {{ res: import('node:http').ServerResponse, pending: Map<string,{resolve:Function,reject:Function}>, seq: number, aborted: boolean }} Session */
/** @type {Map<string, Session>} */
const sessions = new Map();

function send(session, event) {
  if (session.res.writableEnded) return;
  session.res.write(`data: ${JSON.stringify(event)}\n\n`);
}

// One tool call: push it to the widget, await the browser's result.
function callBrowserTool(session, name, input) {
  const id = `t${session.seq++}`;
  return new Promise((resolve, reject) => {
    session.pending.set(id, { resolve, reject });
    send(session, { type: 'tool_call', id, name, input });
    // Safety timeout so a lost page can't hang the run forever.
    setTimeout(() => {
      if (session.pending.has(id)) {
        session.pending.delete(id);
        reject(new Error(`The page did not respond to ${name} in time.`));
      }
    }, 30_000);
  });
}

// A ToolRuntime whose page-level tools proxy to the browser, and whose
// tab-level tools degrade to the single embedded page.
function makeRuntime(session) {
  const tab = () => ({ id: 'page', title: '', url: '', active: true });
  const call = (name, input) => callBrowserTool(session, name, input);
  return {
    navigate: (_i, url) => call('navigate', { url }),
    readPage: () => call('read_page', {}),
    click: (_i, target) => call('click', { target }),
    type: (_i, target, text) => call('type', { target, text }),
    extract: (_i, schema) => call('extract', { schema }),
    scroll: (_i, options) => call('scroll', options),
    pressKey: (_i, key) => call('press_key', { key }),
    waitFor: (_i, condition) => call('wait_for', condition),
    getSelection: () => call('getSelection', {}),
    listLinks: async () => (await call('listLinks', {})).links ?? [],
    queryDom: (_i, selector) => call('queryDom', { selector }),
    screenshot: async () => {
      throw new Error('Screenshots are not available in the embedded widget.');
    },
    newTab: async () => tab(),
    switchTab: async () => tab(),
    listTabs: async () => [tab()],
    closeTab: async () => ({ closed: false }),
    goBack: () => call('go_back', {}),
    goForward: () => call('go_forward', {}),
    reload: () => call('reload', {}),
    confirmDestructive: async (message) => {
      const result = await call('confirm_action', { message });
      return result?.approved === true;
    },
  };
}

async function start(session, prompt, url, title) {
  const controller = new AbortController();
  session.abort = () => controller.abort();
  try {
    const answer = await runAgent({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: MODEL,
      systemPrompt: `${CRM_SYSTEM}\n\nThe user is currently on: ${title} — ${url}`,
      history: [],
      userMessage: prompt,
      extraTools: canUseAccountApi(session.identity) ? API_TOOLS : [],
      context: { activeTabId: 'page', signal: controller.signal, runtime: makeRuntime(session) },
      onStep: (step) => {
        if (step.type === 'tool_call' && step.detail) send(session, { type: 'activity', text: step.detail });
        else if (step.type === 'thinking' && step.detail) send(session, { type: 'activity', text: step.detail });
        else if (step.type === 'text' && step.detail) send(session, { type: 'text', text: step.detail });
      },
    });
    if (answer) send(session, { type: 'text', text: answer });
    send(session, { type: 'done' });
  } catch (err) {
    send(session, { type: 'error', message: err?.message || 'The assistant hit an error.' });
  } finally {
    session.res.end();
    sessions.delete(session.id);
  }
}

function body(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(b || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

// Only these origins may call the backend. Set ALLOWED_ORIGINS to a
// comma-separated list (your CRM, and any dashboard that embeds the widget).
// With credentials, CORS cannot use "*", so we echo the caller only if it's on
// the list. Empty list = reflect any origin (dev only — lock this down).
const ALLOWED = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// CRM-server-issued user identities only. No static shared-token fallback.
const WIDGET_AUTH_SECRET = process.env.WIDGET_AUTH_SECRET || '';
function authed(req, u, payload) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const token = u.searchParams.get('token') || (payload && payload.token) || bearer;
  return verifyIdentity(token, WIDGET_AUTH_SECRET);
}

http
  .createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin && (ALLOWED.length === 0 || ALLOWED.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'content-type');
    }
    if (req.method === 'OPTIONS') return res.writeHead(204).end();

    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/health' && req.method === 'GET') return res.writeHead(200).end('ok');

    if (u.pathname === '/stream') {
      // The endpoint wields an account-level key, so a caller must present the
      // widget token. EventSource can't send headers, so the token rides in the
      // query. See authed().
      const identity = authed(req, u);
      if (!identity) return res.writeHead(401).end('unauthorized');
      const id = u.searchParams.get('sessionId');
      if (!id || id.length > 128 || sessions.has(id)) return res.writeHead(409).end('invalid or existing session');
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      const expires = setTimeout(() => {
        const session = sessions.get(id);
        session?.abort();
        res.end();
        sessions.delete(id);
      }, Math.max(0, identity.exp * 1000 - Date.now()));
      sessions.set(id, { id, owner: identity.sub, identity, res, pending: new Map(), seq: 0, abort: () => {} });
      req.on('close', () => {
        clearTimeout(expires);
        const s = sessions.get(id);
        if (s) s.abort();
        sessions.delete(id);
      });
      return;
    }

    if (u.pathname === '/start' && req.method === 'POST') {
      const payload = await body(req);
      const identity = authed(req, u, payload);
      if (!identity) return res.writeHead(401).end('unauthorized');
      const { sessionId, prompt, url, title } = payload;
      const session = sessions.get(sessionId);
      if (!ownsSession(session, identity)) return res.writeHead(403).end('forbidden');
      if (session.running) return res.writeHead(409).end('task already running');
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 20000) return res.writeHead(400).end('invalid prompt');
      session.running = true;
      session.identity = identity;
      res.writeHead(200).end('ok');
      // Give the EventSource a tick to connect, then run.
      setTimeout(() => {
        const s = sessions.get(sessionId);
        if (s) void start(s, prompt, url, title);
      }, 150);
      return;
    }

    if (u.pathname === '/tool-result' && req.method === 'POST') {
      const payload = await body(req);
      const identity = authed(req, u, payload);
      if (!identity) return res.writeHead(401).end('unauthorized');
      const { sessionId, id, result, error } = payload;
      const s = sessions.get(sessionId);
      if (!ownsSession(s, identity)) return res.writeHead(403).end('forbidden');
      const p = s?.pending.get(id);
      if (p) {
        s.pending.delete(id);
        error ? p.reject(new Error(error)) : p.resolve(result);
      }
      res.writeHead(200).end('ok');
      return;
    }

    res.writeHead(404).end('not found');
  })
  .listen(PORT, () => console.log(`BulleBrowser widget backend on :${PORT}`));
