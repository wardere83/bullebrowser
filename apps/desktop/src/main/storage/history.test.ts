import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryEntry } from '../../shared/ipc.js';

const disk = vi.hoisted(() => ({
  entries: [] as HistoryEntry[],
  create: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
}));
vi.mock('./store.js', () => ({
  createStore: () => {
    disk.create();
    return { get: disk.get, set: disk.set };
  },
}));

const entry = (id: number): HistoryEntry => ({
  url: `https://example.com/${id}`, title: `Page ${id}`, visitedAt: id,
});
const fullDisk = () => Object.assign(new Error('private path and visited URL'), { code: 'ENOSPC' });

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  disk.entries = [entry(1)];
  disk.get.mockImplementation(() => disk.entries);
  disk.set.mockImplementation((_key, entries: HistoryEntry[]) => { disk.entries = entries; });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('history storage failure recovery', () => {
  it('contains ENOSPC without changing existing history or logging private values', async () => {
    const { historyStore } = await import('./history.js');
    const previous = disk.entries;
    disk.set.mockImplementation(() => { throw fullDisk(); });
    expect(() => historyStore.record(entry(2))).not.toThrow();
    expect(disk.entries).toBe(previous);
    expect(historyStore.list()).toEqual([entry(1)]);
    expect(console.warn).toHaveBeenCalledOnce();
    expect(vi.mocked(console.warn).mock.calls[0]?.[0]).toContain('ENOSPC');
    expect(vi.mocked(console.warn).mock.calls[0]?.[0]).not.toContain('private path');
  });

  it('backs off repeated writes and automatically recovers when space is available', async () => {
    const { historyStore } = await import('./history.js');
    disk.set.mockImplementationOnce(() => { throw fullDisk(); });
    historyStore.record(entry(2));
    for (let i = 3; i < 100; i++) historyStore.record(entry(i));
    expect(disk.set).toHaveBeenCalledOnce();
    expect(console.warn).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(30_000);
    historyStore.record(entry(100));
    expect(historyStore.list()).toEqual([entry(100), entry(1)]);
    historyStore.record(entry(101));
    expect(disk.set).toHaveBeenCalledTimes(3);
  });

  it('survives a first-launch initialization write failure and retries initialization', async () => {
    disk.create.mockImplementationOnce(() => { throw fullDisk(); });
    const { historyStore } = await import('./history.js');
    expect(disk.create).not.toHaveBeenCalled();
    expect(() => historyStore.record(entry(2))).not.toThrow();
    vi.advanceTimersByTime(30_000);
    historyStore.record(entry(3));
    expect(disk.create).toHaveBeenCalledTimes(2);
    expect(historyStore.list()).toEqual([entry(3), entry(1)]);
  });

  it('contains read failures without replacing the file and can read it again', async () => {
    const { historyStore } = await import('./history.js');
    disk.get.mockImplementationOnce(() => { throw Object.assign(new Error('read failed'), { code: 'EIO' }); });
    expect(historyStore.list()).toEqual([]);
    expect(disk.set).not.toHaveBeenCalled();
    expect(historyStore.list()).toEqual([entry(1)]);
  });

  it('also contains permission failures and bounds repeated warning messages', async () => {
    const { historyStore } = await import('./history.js');
    disk.get.mockImplementation(() => { throw Object.assign(new Error('private'), { code: 'EACCES' }); });
    expect(() => historyStore.record(entry(2))).not.toThrow();
    historyStore.list();
    historyStore.list();
    expect(console.warn).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(30_000);
    historyStore.record(entry(3));
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it('preserves the existing retention limit and newest-first ordering', async () => {
    const { historyStore } = await import('./history.js');
    disk.entries = Array.from({ length: 5_000 }, (_, i) => entry(i));
    historyStore.record(entry(6_000));
    expect(disk.entries).toHaveLength(5_000);
    expect(historyStore.list(2)).toEqual([entry(6_000), entry(0)]);
  });

  it('never writes blank, internal or restricted destinations', async () => {
    const { historyStore } = await import('./history.js');
    for (const url of ['', 'about:blank', 'https://duckduckgo.com/']) {
      historyStore.record({ ...entry(1), url });
    }
    expect(disk.create).not.toHaveBeenCalled();
    expect(disk.set).not.toHaveBeenCalled();
  });

  it('reports explicit clear failure, preserves entries and permits clearing during backoff', async () => {
    const { historyStore } = await import('./history.js');
    disk.set.mockImplementationOnce(() => { throw fullDisk(); });
    expect(() => historyStore.clear()).toThrow('private path');
    expect(historyStore.list()).toEqual([entry(1)]);
    disk.set.mockImplementationOnce(() => { throw fullDisk(); });
    historyStore.record(entry(2));
    historyStore.clear();
    expect(historyStore.list()).toEqual([]);
    historyStore.record(entry(3));
    expect(historyStore.list()).toEqual([entry(3)]);
  });
});
