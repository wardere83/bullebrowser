import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../tabs/manager.js', () => ({ tabManager: { getView: vi.fn() } }));
import { CLICK_FN, TYPE_FN } from './runtime.js';

class Field {
  private content = '';
  get value() { return this.content; }
  set value(value: string) { this.content = value; }
  outerHTML = '<input>';
  isContentEditable = false;
  click = vi.fn();
  focus = vi.fn();
  scrollIntoView = vi.fn();
  dispatchEvent = vi.fn();
}
let field: Field;
let page: { __bbDeepQuery: () => Field; __bbCursor: ReturnType<typeof vi.fn>; __bbCancelledRun?: string };
beforeEach(() => {
  vi.useFakeTimers();
  field = new Field();
  page = { __bbDeepQuery: () => field, __bbCursor: vi.fn() };
  vi.stubGlobal('window', page);
  vi.stubGlobal('HTMLInputElement', Field);
  vi.stubGlobal('HTMLTextAreaElement', class {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('cancels the pending click before the dwell ends', async () => {
  const result = CLICK_FN('#confirm', 'run-1');
  const rejection = expect(result).rejects.toThrow('cancelled');
  page.__bbCancelledRun = 'run-1';
  await vi.advanceTimersByTimeAsync(500);
  await rejection;
  expect(field.click).not.toHaveBeenCalled();
});
it('stops typing without writing remaining characters', async () => {
  const result = TYPE_FN('#input', 'abcdef', 'run-1');
  const rejection = expect(result).rejects.toThrow('cancelled');
  await vi.advanceTimersByTimeAsync(30);
  expect(field.value).toBe('a');
  page.__bbCancelledRun = 'run-1';
  await vi.advanceTimersByTimeAsync(1000);
  await rejection;
  expect(field.value).toBe('a');
});
it('does not cancel a later run using the same document', async () => {
  page.__bbCancelledRun = 'old-run';
  const result = CLICK_FN('#link', 'new-run');
  await vi.advanceTimersByTimeAsync(500);
  await result;
  expect(field.click).toHaveBeenCalledOnce();
});
