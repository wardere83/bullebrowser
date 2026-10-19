import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./store.js', () => ({ createStore: (_name: string, defaults: Record<string, unknown>) => {
  const data = { ...defaults };
  return { get: (key: string) => data[key], set: (key: string, value: unknown) => { data[key] = value; } };
} }));
import { recordPreparedUpdate, reconcilePreparedUpdate } from './update-receipt.js';
beforeEach(() => { recordPreparedUpdate('0.2.65', '0.2.64', '/Applications/BulleBrowser.app'); });
describe('verified activation receipts', () => {
  it('does not confuse a completed download with an installed update', () => {
    expect(reconcilePreparedUpdate('0.2.64', '/Applications/BulleBrowser.app')).toContain('did not activate');
    expect(reconcilePreparedUpdate('0.2.64', '/Applications/BulleBrowser.app')).toContain('still v0.2.64');
  });
  it('detects opening an old copy from another location', () => {
    expect(reconcilePreparedUpdate('0.2.64', '/Downloads/BulleBrowser.app')).toContain('different copy');
  });
  it('clears the receipt only when the running version proves activation', () => {
    expect(reconcilePreparedUpdate('0.2.65', '/Applications/BulleBrowser.app')).toBeNull();
    expect(reconcilePreparedUpdate('0.2.64', '/Applications/BulleBrowser.app')).toBeNull();
  });
  it('accepts a newer installed version without reporting a failed older update', () => {
    expect(reconcilePreparedUpdate('0.2.66', '/Applications/BulleBrowser.app')).toBeNull();
  });
});
