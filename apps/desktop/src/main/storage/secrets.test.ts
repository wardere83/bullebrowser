import { beforeEach, expect, it, vi } from 'vitest';
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import { homedir, hostname, userInfo } from 'node:os';
const state = vi.hoisted(() => ({ data: { keys: {} as Record<string, string>, apiKeyEncrypted: null as string | null }, available: true }));
vi.mock('./store.js', () => ({ createStore: () => ({
  get: (key: keyof typeof state.data) => state.data[key],
  set: (key: keyof typeof state.data, value: never) => { state.data[key] = value; },
}) }));
vi.mock('electron', () => ({ safeStorage: {
  isEncryptionAvailable: () => state.available,
  getSelectedStorageBackend: () => 'gnome_libsecret',
  encryptString: (value: string) => Buffer.from(`secure:${value}`),
  decryptString: (value: Buffer) => {
    const text = value.toString();
    if (!text.startsWith('secure:')) throw new Error('unreadable');
    return text.slice(7);
  },
} }));
import { clearApiKey, getApiKey, setApiKey } from './secrets.js';
const key = 'sk-ant-test-key-with-more-than-forty-characters';
beforeEach(() => { state.data = { keys: {}, apiKeyEncrypted: null }; state.available = true; });
it('writes only OS-backed v2 credentials', () => {
  setApiKey(key);
  expect(state.data.keys.anthropic).toMatch(/^v2:/);
  expect(getApiKey()).toBe(key);
});
it('migrates the original safeStorage value without losing it', () => {
  state.data.apiKeyEncrypted = Buffer.from(`secure:${key}`).toString('base64');
  expect(getApiKey()).toBe(key);
  expect(state.data.apiKeyEncrypted).toBeNull();
  expect(state.data.keys.anthropic).toMatch(/^v2:/);
});
it('migrates machine-derived ciphertext to OS storage', () => {
  const iv = randomBytes(12);
  const derived = scryptSync(`${hostname()}::${userInfo().username}::${homedir()}`, 'bullebrowser.secrets.v1', 32);
  const cipher = createCipheriv('aes-256-gcm', derived, iv);
  const body = Buffer.concat([cipher.update(key), cipher.final()]);
  state.data.keys.anthropic = `v1:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')}`;
  expect(getApiKey()).toBe(key);
  expect(state.data.keys.anthropic).toMatch(/^v2:/);
});
it('refuses to save without secure storage', () => {
  state.available = false;
  expect(() => setApiKey(key)).toThrow('Secure credential storage is unavailable');
  expect(state.data.keys).toEqual({});
});
it('stores and removes a search key separately without changing model keys', () => {
  setApiKey(key);
  setApiKey('BSA-test-search-key', 'brave');
  expect(state.data.keys.brave).toMatch(/^v2:/);
  expect(getApiKey('brave')).toBe('BSA-test-search-key');
  expect(getApiKey()).toBe(key);
  clearApiKey('brave');
  expect(state.data.keys.brave).toBeUndefined();
  expect(getApiKey()).toBe(key);
});
