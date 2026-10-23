import { describe, expect, it, vi } from 'vitest';
vi.mock('./store.js', () => ({ createStore: (_name: string, defaults: Record<string, unknown>) => {
  const data = { ...defaults };
  return { get: (key: string) => data[key], set: (key: string, value: unknown) => { data[key] = value; } };
} }));
import { saveUpdateTabs, takeUpdateTabs } from './update-session.js';
describe('tabs across an explicit update', () => {
  it('restores source tabs and the selected option once', () => {
    saveUpdateTabs([{ url: 'https://agency.gov/grant-a', active: false }, { url: 'https://funder.org/grant-b', active: true }]);
    expect(takeUpdateTabs()).toEqual({ urls: ['https://agency.gov/grant-a', 'https://funder.org/grant-b'], activeIndex: 1 });
    expect(takeUpdateTabs()).toBeNull();
  });
  it('filters unsafe stored URLs while preserving the selected safe tab', () => {
    saveUpdateTabs([{ url: 'javascript:alert(1)', active: false }, { url: 'https://agency.gov/', active: true }]);
    expect(takeUpdateTabs()).toEqual({ urls: ['https://agency.gov/'], activeIndex: 0 });
  });
});
