import { describe, expect, it, vi } from 'vitest';
vi.mock('./store.js', () => ({ createStore: (_name: string, defaults: Record<string, unknown>) => {
  const data = { ...defaults };
  return { get: (key: string) => data[key], set: (key: string, value: unknown) => { data[key] = value; } };
} }));
import { getSettings, setSettings } from './settings.js';
import { DEFAULT_SETTINGS } from '../../shared/ipc.js';

describe('homepage destination migration', () => {
  it('migrates all prohibited homepage forms and preserves an allowed custom homepage', () => {
    for (const homepageUrl of ['https://duckduckgo.com/?q=grants', 'https://html.duckduckgo.com/', 'https://DUCK.COM./', 'https://ddg.gg/']) {
      setSettings({ homepageUrl });
      expect(getSettings().homepageUrl).toBe(DEFAULT_SETTINGS.homepageUrl);
    }
    setSettings({ homepageUrl: 'https://agency.gov/' });
    expect(getSettings().homepageUrl).toBe('https://agency.gov/');
  });
});
