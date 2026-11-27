import { describe, expect, it, vi } from 'vitest';

vi.mock('./store.js', () => ({
  createStore: <T extends Record<string, unknown>>(_name: string, defaults: T) => {
    const data: Record<string, unknown> = { ...defaults };
    return { get: (k: string) => data[k], set: (k: string, v: unknown) => { data[k] = v; } };
  },
}));

import { feedbackStore } from './feedback.js';

describe('feedback store', () => {
  it('saves, replaces and clears ratings on the device', () => {
    expect(feedbackStore.list()).toEqual([]);
    const saved = feedbackStore.set({ key: 'c:1', kind: 'reply', rating: 'up', comment: '', excerpt: 'Hi' }, '0.2.105', 10);
    expect(saved).toMatchObject({ key: 'c:1', rating: 'up', version: '0.2.105', at: 10 });
    feedbackStore.set({ key: 'c:1', kind: 'reply', rating: 'down', comment: 'Off topic' }, '0.2.105', 11);
    expect(feedbackStore.list()).toHaveLength(1);
    expect(feedbackStore.list()[0]).toMatchObject({ rating: 'down', comment: 'Off topic', excerpt: 'Hi' });
    expect(feedbackStore.set({ key: 'c:1', kind: 'reply', rating: null }, '0.2.105', 12)).toBeNull();
    feedbackStore.set({ key: 'c:2', kind: 'reply', rating: 'up' }, '0.2.105', 13);
    feedbackStore.clear();
    expect(feedbackStore.list()).toEqual([]);
  });

  it('queues removal of ratings the team already has when one is taken back or cleared', () => {
    feedbackStore.set({ key: 'k:1', kind: 'reply', rating: 'up' }, '0.2.106', 20);
    feedbackStore.set({ key: 'k:2', kind: 'strategy', rating: 'down' }, '0.2.106', 21);
    feedbackStore.set({ key: 'k:3', kind: 'reply', rating: 'down' }, '0.2.106', 22);
    feedbackStore.markSynced('k:1', 20);
    feedbackStore.markSynced('k:2', 21);
    feedbackStore.markSynced('k:2', 999);
    feedbackStore.set({ key: 'k:1', kind: 'reply', rating: null }, '0.2.106', 23);
    expect(feedbackStore.removals()).toEqual([{ key: 'k:1', kind: 'reply' }]);
    feedbackStore.clear();
    expect(feedbackStore.removals()).toEqual([{ key: 'k:1', kind: 'reply' }, { key: 'k:2', kind: 'strategy' }]);
    feedbackStore.removalDone('k:1');
    expect(feedbackStore.removals()).toEqual([{ key: 'k:2', kind: 'strategy' }]);
  });

  it('shares by default and remembers when sharing is turned off', () => {
    expect(feedbackStore.sharing()).toBe(true);
    feedbackStore.setSharing(false);
    expect(feedbackStore.sharing()).toBe(false);
  });
});
