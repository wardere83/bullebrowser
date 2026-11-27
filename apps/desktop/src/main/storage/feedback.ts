// Ratings the user gives replies and strategy playbooks. They stay on this
// device until the user emails them to the team or saves them as a file.

import { applyFeedback, type FeedbackEntry, type FeedbackInput } from '../../shared/feedback.js';
import { createStore } from './store.js';

interface FeedbackSchema extends Record<string, unknown> {
  entries: FeedbackEntry[];
}

class FeedbackStore {
  private store = createStore<FeedbackSchema>('feedback', { entries: [] });

  list(): FeedbackEntry[] {
    const entries = this.store.get('entries');
    return Array.isArray(entries)
      ? entries.filter((entry) => entry && typeof entry.key === 'string' && (entry.rating === 'up' || entry.rating === 'down'))
      : [];
  }

  set(input: FeedbackInput, version: string, now = Date.now()): FeedbackEntry | null {
    const next = applyFeedback(this.list(), input, version, now);
    this.store.set('entries', next);
    return next.find((entry) => entry.key === input.key) ?? null;
  }

  clear(): void {
    this.store.set('entries', []);
  }
}

export const feedbackStore = new FeedbackStore();
