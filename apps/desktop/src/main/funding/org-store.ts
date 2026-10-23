// Where an organization's material lives on disk, and the only code that turns
// an organization id into a path.
//
//   <userData>/organizations/<organizationId>/<area>/...
//
// Every organization has its own directory and nothing here can address two at
// once: a caller names one organization and gets paths inside it. Ids arrive
// over IPC, so anything that is not a UUID is refused before it reaches the
// filesystem, and every resolved path is checked to still be inside the
// organization's directory.

import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { FundingError } from './errors.js';

/** Exactly the shape randomUUID() produces. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SAFE_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function assertUuid(value: unknown, what = 'id'): string {
  if (!isUuid(value)) throw new FundingError('INVALID_INPUT', `That ${what} is not valid.`);
  return value;
}

export function organizationsRoot(): string {
  return join(app.getPath('userData'), 'organizations');
}

/**
 * A path inside one organization's directory. Segments are literal names chosen
 * by the app (or UUIDs); separators, dot segments and empty names are refused.
 */
export function orgPath(organizationId: string, ...segments: string[]): string {
  const root = join(organizationsRoot(), assertUuid(organizationId, 'organization'));
  for (const segment of segments) {
    if (!SAFE_SEGMENT_RE.test(segment) || segment.includes('..')) {
      throw new FundingError('INVALID_INPUT', 'That file reference is not valid.');
    }
  }
  const full = resolve(root, ...segments);
  if (full !== root && !full.startsWith(root + sep)) {
    throw new FundingError('INVALID_INPUT', 'That file reference is not valid.');
  }
  return full;
}

// Writes to the same file are queued so a slow write is never overtaken by a
// later one and two writers never interleave.
const writeQueues = new Map<string, Promise<void>>();

function enqueue(file: string, task: () => Promise<void>): Promise<void> {
  const previous = writeQueues.get(file) ?? Promise.resolve();
  const next = previous.then(task, task);
  const tracked = next.finally(() => {
    if (writeQueues.get(file) === tracked) writeQueues.delete(file);
  });
  writeQueues.set(file, tracked.catch(() => {}));
  return next;
}

/**
 * Reads a JSON file. A missing file yields the fallback. A file that cannot be
 * parsed is moved aside (never deleted) and the fallback is returned, so one
 * damaged file cannot take the app down or be silently overwritten.
 */
export async function readJson<T>(file: string, fallback: T): Promise<T> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    const aside = `${file}.unreadable-${Date.now()}`;
    await rename(file, aside).catch(() => {});
    console.error(`[funding] ${file} could not be read and was moved to ${aside}`);
    return fallback;
  }
}

/** Writes a JSON file atomically: a complete temporary file, then a rename. */
export function writeJson(file: string, value: unknown): Promise<void> {
  return enqueue(file, async () => {
    await mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.partial`;
    try {
      await writeFile(temporary, JSON.stringify(value), 'utf8');
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
  });
}

export async function copyInto(source: string, destination: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

export async function removePath(target: string): Promise<void> {
  await rm(target, { recursive: true, force: true });
}

/** Deletes everything an organization holds. */
export async function removeOrganizationData(organizationId: string): Promise<void> {
  await removePath(orgPath(organizationId));
}
