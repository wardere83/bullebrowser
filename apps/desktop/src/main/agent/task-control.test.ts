import { expect, it, vi } from 'vitest';
import { TaskControl } from './task-control.js';

it('allows exactly one queued tool per step, resumes remaining tools and aborts parked tools', async () => {
  const control = new TaskControl(); const abort = new AbortController();
  const executed = vi.fn(); control.command('pause');
  const one = control.beforeTool(abort.signal).then(executed);
  const two = control.beforeTool(abort.signal).then(executed);
  await Promise.resolve(); expect(executed).not.toHaveBeenCalled();
  control.command('step'); await one;
  expect(executed).toHaveBeenCalledTimes(1);
  control.command('resume'); await two;
  expect(executed).toHaveBeenCalledTimes(2);
  control.command('pause'); const parked = control.beforeTool(abort.signal);
  abort.abort(); await expect(parked).rejects.toThrow('cancelled');
});
it('keeps follow and replan independent of consent and consumes replan once', () => {
  const control = new TaskControl(); control.command('unfollow'); expect(control.follow).toBe(false);
  control.command('replan'); expect(control.takeReplan()).toBe(true); expect(control.takeReplan()).toBe(false);
  expect(control.follow).toBe(false);
});
