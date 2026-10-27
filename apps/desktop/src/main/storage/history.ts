import { isBlockedDestination, sanitizeAssistantText } from '@bullebrowser/agent-core';
import type { HistoryEntry } from '../../shared/ipc.js';
import { createStore } from './store.js';

interface HistorySchema extends Record<string, unknown> {
  entries: HistoryEntry[];
}

const MAX_ENTRIES = 5_000;

class HistoryStore {
  private store = createStore<HistorySchema>('history', { entries: [] });

  list(limit = 200): HistoryEntry[] {
    const all = this.store.get('entries');
    return all.filter((entry) => !isBlockedDestination(entry.url)).slice(0, limit).map((entry) => ({ ...entry, title: sanitizeAssistantText(entry.title) }));
  }

  record(entry: HistoryEntry): void {
    if (!entry.url || entry.url.startsWith('about:') || isBlockedDestination(entry.url)) return;
    const all = this.store.get('entries');
    all.unshift(entry);
    this.store.set('entries', all.slice(0, MAX_ENTRIES));
  }

  clear(): void {
    this.store.set('entries', []);
  }
}

export const historyStore = new HistoryStore();
