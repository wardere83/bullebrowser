import { afterEach, describe, expect, it, vi } from 'vitest';
import { presentationPause } from './presentation.js';
afterEach(() => vi.useRealTimers());
describe('visible browser action tempo', () => {
  it('holds an action long enough to follow and stops immediately on cancellation', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let completed = false;
    const pause = presentationPause(650, controller.signal).then(() => { completed = true; });
    await vi.advanceTimersByTimeAsync(600);
    expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(50);
    await pause;
    expect(completed).toBe(true);
    const stopped = presentationPause(900, controller.signal);
    const rejected = expect(stopped).rejects.toThrow('cancelled');
    controller.abort();
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
});
