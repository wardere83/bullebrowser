// Saved sign-ins. Each password is encrypted by the OS credential service
// (safeStorage: the macOS Keychain) before it is written. Only the main
// process decrypts one, and only to fill it into the exact site it was saved
// for. Nothing here is ever given to the AI agent.

import { randomUUID } from 'node:crypto';
import { safeStorage } from 'electron';
import { createStore } from '../storage/store.js';

export interface SavedLogin {
  id: string;
  origin: string;
  username: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
}

interface StoredLogin extends SavedLogin {
  secret: string;
}

interface PasswordSchema extends Record<string, unknown> {
  logins: StoredLogin[];
  /** Sites the person said never to save for. */
  neverSave: string[];
}

const store = createStore<PasswordSchema>('passwords', { logins: [], neverSave: [] });

/**
 * The site a login belongs to: an https origin (plain http only on this
 * machine). Anything else — file:, data:, an http site — is never saved to
 * or filled.
 */
export function loginOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') return parsed.origin;
    if (parsed.protocol === 'http:' && /^(?:localhost|127\.0\.0\.1|\[::1\])$/.test(parsed.hostname)) return parsed.origin;
  } catch { /* not a URL */ }
  return null;
}

function encrypt(plain: string): string {
  if (!safeStorage.isEncryptionAvailable() ||
      (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
    throw new Error('Secure password storage is unavailable on this computer.');
  }
  return `v2:${safeStorage.encryptString(plain).toString('base64')}`;
}

function decrypt(stored: string): string | null {
  if (!stored.startsWith('v2:')) return null;
  try { return safeStorage.decryptString(Buffer.from(stored.slice(3), 'base64')); }
  catch { return null; }
}

const visible = ({ secret: _secret, ...login }: StoredLogin): SavedLogin => login;

export const passwordStore = {
  /** Every saved login, without its password. */
  list(): SavedLogin[] {
    return store.get('logins').map(visible).sort((a, b) => a.origin.localeCompare(b.origin) || a.username.localeCompare(b.username));
  },

  /** The logins saved for one site, without passwords. */
  forOrigin(origin: string): Array<{ id: string; username: string }> {
    return store.get('logins')
      .filter((login) => login.origin === origin)
      .sort((a, b) => (b.lastUsedAt ?? b.updatedAt) - (a.lastUsedAt ?? a.updatedAt))
      .map(({ id, username }) => ({ id, username }));
  },

  /** Whether this exact login and password are already saved. */
  has(origin: string, username: string, password: string): boolean {
    const login = store.get('logins').find((entry) => entry.origin === origin && entry.username === username);
    return !!login && decrypt(login.secret) === password;
  },

  /** Save or update a login. */
  save(origin: string, username: string, password: string): 'saved' | 'updated' | 'unchanged' {
    if (!loginOrigin(origin) || !password) throw new Error('This sign-in cannot be saved.');
    const logins = store.get('logins');
    const now = Date.now();
    const existing = logins.find((login) => login.origin === origin && login.username === username);
    if (existing && decrypt(existing.secret) === password) return 'unchanged';
    const secret = encrypt(password);
    if (existing) {
      store.set('logins', logins.map((login) => (login.id === existing.id ? { ...login, secret, updatedAt: now } : login)));
      return 'updated';
    }
    store.set('logins', [...logins, { id: randomUUID(), origin, username, secret, createdAt: now, updatedAt: now }]);
    store.set('neverSave', store.get('neverSave').filter((site) => site !== origin));
    return 'saved';
  },

  /** A login's password, only for the site it was saved for. */
  passwordFor(id: string, origin: string): { username: string; password: string } | null {
    const login = store.get('logins').find((entry) => entry.id === id);
    if (!login || login.origin !== origin) return null;
    const password = decrypt(login.secret);
    if (password === null) return null;
    store.set('logins', store.get('logins').map((entry) => (entry.id === id ? { ...entry, lastUsedAt: Date.now() } : entry)));
    return { username: login.username, password };
  },

  remove(id: string): void {
    store.set('logins', store.get('logins').filter((login) => login.id !== id));
  },

  isNeverSaved(origin: string): boolean {
    return store.get('neverSave').includes(origin);
  },

  neverSaveFor(origin: string): void {
    if (!this.isNeverSaved(origin)) store.set('neverSave', [...store.get('neverSave'), origin]);
  },

  /**
   * Import an exported password file: Apple Passwords (Title, URL, Username,
   * Password…), Chrome (name, url, username, password…) or Firefox (url,
   * username, password…). Rows without a usable https site or a password
   * are skipped.
   */
  importCsv(text: string): { imported: number; skipped: number } {
    const rows = parseCsv(text);
    const header = (rows.shift() ?? []).map((cell) => cell.trim().toLowerCase());
    const column = (...names: string[]) => header.findIndex((cell) => names.includes(cell));
    const url = column('url', 'website', 'login_uri', 'origin');
    const user = column('username', 'login', 'login_username', 'user name', 'email');
    const pass = column('password', 'login_password');
    if (url < 0 || pass < 0) throw new Error('This file is not a password export: it needs URL and Password columns.');
    let imported = 0;
    let skipped = 0;
    for (const row of rows) {
      if (row.every((cell) => !cell.trim())) continue;
      const origin = loginOrigin((row[url] ?? '').trim());
      const password = row[pass] ?? '';
      if (!origin || !password) { skipped += 1; continue; }
      this.save(origin, (user >= 0 ? row[user] ?? '' : '').trim(), password);
      imported += 1;
    }
    return { imported, skipped };
  },
};

/** RFC 4180 CSV: quoted fields, doubled quotes, newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]!;
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
