import { describe, expect, it, vi } from 'vitest';
import { createFeedbackSyncer, feedbackItem, syncFeedback, type FeedbackSyncStore } from './feedback-sync.js';
import type { FeedbackEntry } from '../shared/feedback.js';

const entry = (key: string, extra: Partial<FeedbackEntry> = {}): FeedbackEntry =>
  ({ key, kind: 'reply', rating: 'down', comment: 'Wrong date', excerpt: 'The private reply text', version: '0.2.106', at: 1, ...extra });

function memoryStore(entries: FeedbackEntry[], removals: { key: string; kind: 'reply' | 'strategy' }[] = [], share = true): FeedbackSyncStore & { entries: FeedbackEntry[]; pending: typeof removals } {
  const state = { entries: [...entries], pending: [...removals] };
  return {
    get entries() { return state.entries; },
    get pending() { return state.pending; },
    list: () => state.entries,
    removals: () => state.pending,
    sharing: () => share,
    markSynced: (key, at) => { state.entries = state.entries.map((e) => (e.key === key && e.at === at ? { ...e, synced: true } : e)); },
    removalDone: (key) => { state.pending = state.pending.filter((r) => r.key !== key); },
  };
}

const ok = () => vi.fn(async () => new Response('{"ok":true}', { status: 200 }));

describe('sending shared ratings', () => {
  it('sends the rating and comment, never the reply text or the raw item key', async () => {
    const fetchImpl = ok();
    const store = memoryStore([entry('conv-1:3')]);
    expect(await syncFeedback({ store, version: '0.2.106', platform: 'darwin', fetchImpl: fetchImpl as never, endpoint: 'https://feedback.test/v1/feedback' })).toBe(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://feedback.test/v1/feedback');
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({ item: feedbackItem('conv-1:3'), kind: 'reply', rating: 'down', comment: 'Wrong date', version: '0.2.106', platform: 'darwin' });
    expect(String(init.body)).not.toContain('private reply');
    expect(String(init.body)).not.toContain('conv-1');
    expect(store.entries[0]!.synced).toBe(true);
  });

  it('sends no ratings when sharing is off, but still takes back ones sent earlier', async () => {
    const fetchImpl = ok();
    expect(await syncFeedback({ store: memoryStore([entry('a')], [], false), version: '0.2.106', platform: 'linux', fetchImpl: fetchImpl as never })).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    const store = memoryStore([entry('a')], [{ key: 'old', kind: 'reply' }], false);
    expect(await syncFeedback({ store, version: '0.2.106', platform: 'linux', fetchImpl: fetchImpl as never })).toBe(1);
    expect(JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body)).rating).toBeNull();
  });

  it('keeps ratings queued when the receiver cannot be reached, and stops for the run', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('getaddrinfo ENOTFOUND'); });
    const store = memoryStore([entry('a'), entry('b')]);
    expect(await syncFeedback({ store, version: '0.2.106', platform: 'win32', fetchImpl: fetchImpl as never })).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(store.entries.every((e) => !e.synced)).toBe(true);
  });

  it('waits after a rate limit and drops a request the receiver refuses outright', async () => {
    const limited = vi.fn(async () => new Response('', { status: 429 }));
    const store = memoryStore([entry('a')]);
    await syncFeedback({ store, version: '0.2.106', platform: 'darwin', fetchImpl: limited as never });
    expect(store.entries[0]!.synced).toBeFalsy();
    const refused = vi.fn(async () => new Response('', { status: 400 }));
    await syncFeedback({ store, version: '0.2.106', platform: 'darwin', fetchImpl: refused as never });
    expect(store.entries[0]!.synced).toBe(true);
  });

  it('removes ratings the user took back, then skips ratings already sent', async () => {
    const fetchImpl = ok();
    const store = memoryStore([entry('a', { synced: true })], [{ key: 'gone', kind: 'strategy' }]);
    expect(await syncFeedback({ store, version: '0.2.106', platform: 'linux', fetchImpl: fetchImpl as never })).toBe(1);
    expect(JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toMatchObject({ item: feedbackItem('gone'), kind: 'strategy', rating: null });
    expect(store.pending).toEqual([]);
  });

  it('does not mark a rating sent if it changed while the request was out', async () => {
    const store = memoryStore([entry('a', { at: 1 })]);
    const fetchImpl = vi.fn(async () => {
      store.entries.splice(0, 1, entry('a', { at: 2, rating: 'up' }));
      return new Response('{}', { status: 200 });
    });
    await syncFeedback({ store, version: '0.2.106', platform: 'linux', fetchImpl: fetchImpl as never });
    expect(store.entries[0]!.synced).toBeFalsy();
  });

  it('runs one sync at a time and follows up on requests made meanwhile', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetchImpl = vi.fn(async () => { await gate; return new Response('{}', { status: 200 }); });
    const store = memoryStore([entry('a')]);
    const run = createFeedbackSyncer(() => ({ store, version: '0.2.106', platform: 'linux', fetchImpl: fetchImpl as never }));
    const first = run();
    void run();
    void run();
    release();
    await first;
    await run();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
