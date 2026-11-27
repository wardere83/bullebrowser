// Session file store. Files the user uploads via the AI panel's "+" menu are
// copied into userData/session-files, tracked in an electron-store registry,
// and swept 8 days after upload. Text files carry an excerpt the agent reads as
// context; binary files (images, archives) still attach but with no inline text.
//
// Retention is enforced here, not by a timer: every list()/add() sweeps first,
// so an app that was closed past a file's expiry still drops it on next use.

import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { SessionFile } from '../../shared/ipc.js';
import { createStore } from './store.js';

export const RETENTION_MS = 8 * 24 * 60 * 60 * 1000; // 8 days

// Exactly the shape randomUUID() produces — see pathFor().
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Extensions we can hand the agent as inline text. Everything else attaches as
// an opaque blob (still uploaded, just no excerpt).
const TEXT_EXTS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.jsonl', '.yaml', '.yml',
  '.xml', '.html', '.htm', '.css', '.js', '.jsx', '.ts', '.tsx', '.py', '.rb',
  '.go', '.rs', '.java', '.c', '.h', '.cpp', '.sh', '.sql', '.log', '.ini',
  '.toml', '.env', '.text', '.rtf',
]);

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown',
  '.csv': 'text/csv', '.json': 'application/json', '.html': 'text/html',
};

// Cap the text we lift off any one file so a huge log can't blow the prompt.
const MAX_EXCERPT_CHARS = 12_000;

interface FilesSchema extends Record<string, unknown> {
  files: SessionFile[];
}

class SessionFileStore {
  private store = createStore<FilesSchema>('session-files', { files: [] });

  private dir(): string {
    const d = join(app.getPath('userData'), 'session-files');
    mkdirSync(d, { recursive: true });
    return d;
  }

  // Ids are the randomUUIDs we minted, and they are the ONLY thing that ever
  // reaches the filesystem here. Ids arrive over IPC from the renderer, so an
  // id like '../../…' would otherwise turn remove() into an arbitrary-file
  // delete. Anything that isn't a plain UUID is refused outright.
  private pathFor(id: string): string {
    if (!UUID_RE.test(id)) throw new Error(`Refusing to use an invalid file id: ${id}`);
    return join(this.dir(), id);
  }

  // Drop expired entries and their bytes. Returns the surviving list.
  private sweep(): SessionFile[] {
    const now = Date.now();
    const all = this.store.get('files');
    const live = all.filter((f) => f.expiresAt > now);
    if (live.length !== all.length) {
      for (const dead of all.filter((f) => f.expiresAt <= now)) {
        try {
          rmSync(this.pathFor(dead.id), { force: true });
        } catch {
          /* already gone */
        }
      }
      this.store.set('files', live);
    }
    return live;
  }

  list(): SessionFile[] {
    return [...this.sweep()].sort((a, b) => b.addedAt - a.addedAt);
  }

  // Copy each source path into the store. Skips silently on a per-file read
  // error so one unreadable file doesn't sink the whole selection.
  add(paths: string[]): SessionFile[] {
    const added: SessionFile[] = [];
    for (const src of paths) {
      try {
        const size = statSync(src).size;
        const id = randomUUID();
        copyFileSync(src, this.pathFor(id));
        const name = basename(src);
        // extname('.env') === '', so a dotfile would look extension-less and be
        // written off as binary. For those the whole name IS the extension.
        const ext = (extname(name) || (name.startsWith('.') ? name : '')).toLowerCase();
        const now = Date.now();
        const meta: SessionFile = {
          id,
          name,
          mime: MIME[ext] ?? 'application/octet-stream',
          sizeBytes: size,
          addedAt: now,
          expiresAt: now + RETENTION_MS,
          isText: TEXT_EXTS.has(ext),
        };
        this.store.set('files', [meta, ...this.store.get('files')]);
        added.push(meta);
      } catch {
        /* unreadable / vanished between pick and copy — skip it */
      }
    }
    return added;
  }

  get(id: string): SessionFile | null {
    return this.sweep().find((f) => f.id === id) ?? null;
  }

  remove(id: string): void {
    this.store.set(
      'files',
      this.store.get('files').filter((f) => f.id !== id),
    );
    try {
      rmSync(this.pathFor(id), { force: true });
    } catch {
      /* already gone */
    }
  }

  /** Where a stored PDF or Word file lives on disk, for the document reader. */
  documentFile(id: string): { path: string; name: string } | null {
    const meta = this.get(id);
    if (!meta || !/\.(pdf|docx)$/i.test(meta.name)) return null;
    return { path: this.pathFor(id), name: meta.name };
  }

  // Inline text for agent context, capped. Empty string for binary/missing.
  excerpt(id: string): string {
    const meta = this.get(id);
    if (!meta || !meta.isText) return '';
    try {
      const text = readFileSync(this.pathFor(id), 'utf-8');
      return text.length > MAX_EXCERPT_CHARS
        ? `${text.slice(0, MAX_EXCERPT_CHARS)}\n…[truncated]`
        : text;
    } catch {
      return '';
    }
  }
}

export const sessionFileStore = new SessionFileStore();
