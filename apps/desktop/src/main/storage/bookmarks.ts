import { assertAllowedDestination, isBlockedDestination, sanitizeAssistantText } from '@bullebrowser/agent-core';
import { randomUUID } from 'node:crypto';
import type { Bookmark } from '../../shared/ipc.js';
import { createStore } from './store.js';

interface BookmarkSchema extends Record<string, unknown> {
  bookmarks: Bookmark[];
}

class BookmarkStore {
  private store = createStore<BookmarkSchema>('bookmarks', { bookmarks: [] });

  list(): Bookmark[] {
    return this.store.get('bookmarks').filter((bookmark) => !isBlockedDestination(bookmark.url)).map((bookmark) => ({ ...bookmark, title: sanitizeAssistantText(bookmark.title) }));
  }

  add(input: { url: string; title: string }): Bookmark {
    assertAllowedDestination(input.url);
    const all = this.store.get('bookmarks');
    if (all.some((b) => b.url === input.url)) {
      const existing = all.find((b) => b.url === input.url);
      if (existing) return existing;
    }
    const next: Bookmark = {
      id: randomUUID(),
      url: input.url,
      title: input.title,
      addedAt: Date.now(),
    };
    this.store.set('bookmarks', [next, ...all]);
    return next;
  }

  remove(id: string): void {
    this.store.set(
      'bookmarks',
      this.store.get('bookmarks').filter((b) => b.id !== id),
    );
  }
}

export const bookmarkStore = new BookmarkStore();
