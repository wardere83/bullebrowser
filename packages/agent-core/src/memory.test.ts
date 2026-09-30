import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionMemoryStore } from './memory.js';

describe('memory safety', () => {
  it('does not persist sensitive keys', () => {
    const memory = new SessionMemoryStore();
    memory.put('password', 'secret');
    expect(memory.get('password')).toBeUndefined();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // A controlled clock: with a real 1ms TTL, a slow CI runner could cross the
  // millisecond between put and the first get, and the test failed at random.
  it('stores safe values and supports ttl', () => {
    vi.useFakeTimers();
    const memory = new SessionMemoryStore();
    memory.put('allowed_domain', 'example.com', 1000);
    expect(memory.get('allowed_domain')).toBe('example.com');
    vi.advanceTimersByTime(999);
    expect(memory.get('allowed_domain')).toBe('example.com');
    vi.advanceTimersByTime(1);
    expect(memory.get('allowed_domain')).toBeUndefined();
  });
});
