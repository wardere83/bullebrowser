// Sends shared ratings to the BulleBrowser team's feedback receiver. Each
// request carries the rating, the comment the user typed, the app version and
// the operating system, and a one-way hash of the rated item so a change
// replaces the earlier rating. Failures are quiet: unsent ratings stay queued
// on the device and go out on a later try.

import { createHash } from 'node:crypto';
import { FEEDBACK_ENDPOINT, type FeedbackPayload } from '../shared/feedback.js';
import type { FeedbackEntry } from '../shared/feedback.js';
import type { FeedbackRemoval } from './storage/feedback.js';

export interface FeedbackSyncStore {
  list(): FeedbackEntry[];
  removals(): FeedbackRemoval[];
  sharing(): boolean;
  markSynced(key: string, at: number): void;
  removalDone(key: string): void;
}

export interface FeedbackSyncOptions {
  store: FeedbackSyncStore;
  version: string;
  platform: string;
  fetchImpl?: typeof fetch;
  endpoint?: string;
}

const MAX_PER_RUN = 25;
const TIMEOUT_MS = 10_000;

export const feedbackItem = (key: string) => createHash('sha256').update(`bullebrowser-feedback:${key}`).digest('hex');

const platformOf = (platform: string): FeedbackPayload['platform'] | null =>
  platform === 'darwin' || platform === 'win32' || platform === 'linux' ? platform : null;

const releaseVersion = (version: string) => (/^\d+\.\d+\.\d+$/.test(version) ? version : null);

type Outcome = 'done' | 'retry' | 'stop';

async function send(payload: FeedbackPayload, fetchImpl: typeof fetch, endpoint: string): Promise<Outcome> {
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.ok) return 'done';
    // The receiver refused this one for good; retrying would only repeat it.
    if (response.status === 400 || response.status === 413 || response.status === 415) return 'done';
    // Over the daily limit or unavailable: try again later, and stop this run.
    return 'stop';
  } catch {
    return 'stop';
  }
}

/** Sends what the team does not have yet. Returns how many requests went through. */
export async function syncFeedback({ store, version, platform, fetchImpl = fetch, endpoint = FEEDBACK_ENDPOINT }: FeedbackSyncOptions): Promise<number> {
  const os = platformOf(platform);
  if (!os) return 0;
  let sent = 0;
  for (const removal of store.removals().slice(0, MAX_PER_RUN)) {
    const outcome = await send({ item: feedbackItem(removal.key), kind: removal.kind, rating: null, comment: '', version: releaseVersion(version) ?? '0.0.0', platform: os }, fetchImpl, endpoint);
    if (outcome === 'stop') return sent;
    store.removalDone(removal.key);
    sent += 1;
  }
  // Removals go out even with sharing off: they only take back what was sent.
  if (!store.sharing()) return sent;
  const unsent = store.list().filter((entry) => !entry.synced).slice(0, MAX_PER_RUN - sent);
  for (const entry of unsent) {
    const entryVersion = releaseVersion(entry.version) ?? releaseVersion(version);
    if (!entryVersion) continue;
    const outcome = await send({ item: feedbackItem(entry.key), kind: entry.kind, rating: entry.rating, comment: entry.comment, version: entryVersion, platform: os }, fetchImpl, endpoint);
    if (outcome === 'stop') return sent;
    store.markSynced(entry.key, entry.at);
    sent += 1;
  }
  return sent;
}

/** Runs one sync at a time; a request made while one runs is folded into a follow-up run. */
export function createFeedbackSyncer(options: () => FeedbackSyncOptions) {
  let running: Promise<void> | null = null;
  let again = false;
  const run = (): Promise<void> => {
    if (running) { again = true; return running; }
    running = (async () => {
      do {
        again = false;
        await syncFeedback(options()).catch(() => 0);
      } while (again);
    })().finally(() => { running = null; });
    return running;
  };
  return run;
}
