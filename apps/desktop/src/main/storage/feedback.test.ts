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
});
