// Ratings the user gives replies and strategy playbooks. They are kept on this
// device, and, unless the user turns sharing off in Settings, a copy of each
// rating and its comment goes to the BulleBrowser team (see feedback-sync.ts).

import { applyFeedback, type FeedbackEntry, type FeedbackInput, type FeedbackKind } from '../../shared/feedback.js';
import { createStore } from './store.js';

/** A rating the team already has that the user took back or cleared. */
export interface FeedbackRemoval {
  key: string;
  kind: FeedbackKind;
}

interface FeedbackSchema extends Record<string, unknown> {
  entries: FeedbackEntry[];
  removals: FeedbackRemoval[];
  share: boolean;
}

class FeedbackStore {
  private store = createStore<FeedbackSchema>('feedback', { entries: [], removals: [], share: true });

  list(): FeedbackEntry[] {
    const entries = this.store.get('entries');
    return Array.isArray(entries)
      ? entries.filter((entry) => entry && typeof entry.key === 'string' && (entry.rating === 'up' || entry.rating === 'down'))
      : [];
  }

  removals(): FeedbackRemoval[] {
    const removals = this.store.get('removals');
    return Array.isArray(removals) ? removals.filter((r) => r && typeof r.key === 'string') : [];
  }

  sharing(): boolean {
    return this.store.get('share') !== false;
  }

  setSharing(on: boolean): void {
    this.store.set('share', on);
  }

  set(input: FeedbackInput, version: string, now = Date.now()): FeedbackEntry | null {
    const previous = this.list().find((entry) => entry.key === input.key);
    const next = applyFeedback(this.list(), input, version, now);
    this.store.set('entries', next);
    const pending = this.removals().filter((r) => r.key !== input.key);
    if (input.rating === null && previous?.synced) pending.push({ key: previous.key, kind: previous.kind });
    this.store.set('removals', pending);
    return next.find((entry) => entry.key === input.key) ?? null;
  }

  /** Marks an entry as matching the team's copy, if it has not changed since it was sent. */
  markSynced(key: string, at: number): void {
    this.store.set('entries', this.list().map((entry) => (entry.key === key && entry.at === at ? { ...entry, synced: true } : entry)));
  }

  removalDone(key: string): void {
    this.store.set('removals', this.removals().filter((r) => r.key !== key));
  }

  /** Clears every rating here, and asks for the team's copies to be removed too. */
  clear(): void {
    const sent = this.list().filter((entry) => entry.synced).map((entry) => ({ key: entry.key, kind: entry.kind }));
    const known = new Set(this.removals().map((r) => r.key));
    this.store.set('removals', [...this.removals(), ...sent.filter((r) => !known.has(r.key))]);
    this.store.set('entries', []);
  }
}

export const feedbackStore = new FeedbackStore();
