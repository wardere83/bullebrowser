import { isBlockedDestination, sanitizeAssistantText } from '@bullebrowser/agent-core';
import type { HistoryEntry } from '../../shared/ipc.js';
import { createStore } from './store.js';

interface HistorySchema extends Record<string, unknown> {
  entries: HistoryEntry[];
}

const MAX_ENTRIES = 5_000;
const RETRY_DELAY_MS = 30_000;

class HistoryStore {
  // Creating a store can itself write defaults on a first launch. Keep that
  // inside the same error boundary as navigation writes, not at module load.
  private store?: ReturnType<typeof createStore<HistorySchema>>;
  private retryWriteAt = 0;
  private nextWarningAt = 0;

  private getStore() {
    return this.store ??= createStore<HistorySchema>('history', { entries: [] });
  }

  private warn(error: unknown): void {
    if (Date.now() < this.nextWarningAt) return;
    this.nextWarningAt = Date.now() + RETRY_DELAY_MS;
    const code = (error as NodeJS.ErrnoException | null)?.code;
    // Never log the error message: it can contain local paths or visited URLs.
    console.warn(`[history] Local history storage is unavailable (${typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? code : 'storage error'}). Browsing can continue; check free disk space and file permissions.`);
  }

  list(limit = 200): HistoryEntry[] {
    try {
      const all = this.getStore().get('entries');
      return all.filter((entry) => !isBlockedDestination(entry.url)).slice(0, limit).map((entry) => ({ ...entry, title: sanitizeAssistantText(entry.title) }));
    } catch (error) {
      this.warn(error);
      return [];
    }
  }

  record(entry: HistoryEntry): void {
    if (!entry.url || entry.url.startsWith('about:') || isBlockedDestination(entry.url)) return;
    if (Date.now() < this.retryWriteAt) return;
    try {
      const store = this.getStore();
      const all = store.get('entries');
      store.set('entries', [entry, ...all].slice(0, MAX_ENTRIES));
      this.retryWriteAt = 0;
    } catch (error) {
      // History is optional. A failed atomic write must never escape a native
      // did-navigate listener or trigger a write/retry storm on a full disk.
      this.retryWriteAt = Date.now() + RETRY_DELAY_MS;
      this.warn(error);
    }
  }

  clear(): void {
    // Explicit deletion must report failure through IPC, not claim success.
    this.getStore().set('entries', []);
    this.retryWriteAt = 0;
  }
}

export const historyStore = new HistoryStore();
