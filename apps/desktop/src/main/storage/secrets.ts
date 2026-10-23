// API keys for the model providers.
//
// New values use the OS credential service through safeStorage. The v1
// machine-derived format is read only to migrate it; it is never written.
// The OS may ask for permission. We do not bypass that protection.

import { createDecipheriv, scryptSync } from 'node:crypto';
import { safeStorage } from 'electron';
import { homedir, hostname, userInfo } from 'node:os';
import { createStore } from './store.js';

export type ProviderId = 'anthropic' | 'openai' | 'brave';

interface SecretSchema extends Record<string, unknown> {
  // Legacy: a safeStorage-encrypted Anthropic key from before this change.
  apiKeyEncrypted: string | null;
  // Current: per-provider, encrypted by the scheme below.
  keys: Partial<Record<ProviderId, string>>;
}

const store = createStore<SecretSchema>('secrets', { apiKeyEncrypted: null, keys: {} });

// Stable per-machine/per-user derivation. Not a user secret — the point is to
// avoid a plaintext key sitting on disk, not to withstand a local attacker.
function derivedKey(): Buffer {
  return scryptSync(`${hostname()}::${userInfo().username}::${homedir()}`, 'bullebrowser.secrets.v1', 32);
}

function encrypt(plain: string): string {
  if (!safeStorage.isEncryptionAvailable() ||
      (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
    throw new Error('Secure credential storage is unavailable. Configure the OS credential store or use an environment variable.');
  }
  return `v2:${safeStorage.encryptString(plain).toString('base64')}`;
}

function decrypt(stored: string): string | null {
  if (stored.startsWith('v2:')) {
    try { return safeStorage.decryptString(Buffer.from(stored.slice(3), 'base64')); }
    catch { return null; }
  }
  if (!stored.startsWith('v1:')) return null;
  try {
    const raw = Buffer.from(stored.slice(3), 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const body = raw.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', derivedKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    // Wrong machine, tampered file, or a rotated derivation input.
    return null;
  }
}

// Each provider's key has a recognizable prefix; checking it catches the very
// common paste error of putting a key in the wrong provider's box.
const KEY_SHAPE: Record<ProviderId, { prefix: RegExp; label: string }> = {
  anthropic: { prefix: /^sk-ant-/, label: "a key starting with 'sk-ant-'" },
  // sk-ant- also starts with sk-, so exclude it explicitly — otherwise an
  // Anthropic key pasted into the OpenAI/voice box passes and then 401s later.
  openai: { prefix: /^sk-(?!ant-)/, label: "an OpenAI key (starts with 'sk-', not 'sk-ant-')" },
  brave: { prefix: /^\S+$/, label: 'a Brave Search API key without whitespace' },
};

function envKey(provider: ProviderId): string | null {
  const name = provider === 'brave' ? 'BRAVE_SEARCH_API_KEY' : provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function setApiKey(plain: string, provider: ProviderId = 'anthropic'): void {
  const trimmed = plain.trim();
  if (!trimmed) throw new Error('API key is empty.');
  const shape = KEY_SHAPE[provider];
  if (!shape.prefix.test(trimmed)) {
    throw new Error(`That doesn't look like ${shape.label}.`);
  }
  if (provider !== 'brave' && trimmed.length < 40) throw new Error('API key is too short to be valid.');
  store.set('keys', { ...store.get('keys'), [provider]: encrypt(trimmed) });
}

export function getApiKey(provider: ProviderId = 'anthropic'): string | null {
  const stored = store.get('keys')?.[provider];
  if (stored) {
    const plain = decrypt(stored);
    if (plain) {
      if (stored.startsWith('v1:')) {
        // Never silently retain the weak scheme when secure migration fails.
        store.set('keys', { ...store.get('keys'), [provider]: encrypt(plain) });
      }
      return plain;
    }
  }
  if (provider === 'anthropic' && store.get('apiKeyEncrypted')) {
    try {
      const legacy = safeStorage.decryptString(Buffer.from(store.get('apiKeyEncrypted')!, 'base64'));
      store.set('keys', { ...store.get('keys'), anthropic: encrypt(legacy) });
      store.set('apiKeyEncrypted', null);
      return legacy;
    } catch { /* Leave the original intact so recovery is possible. */ }
  }
  return envKey(provider);
}

export function hasApiKey(provider: ProviderId = 'anthropic'): boolean {
  return getApiKey(provider) !== null;
}

export function clearApiKey(provider: ProviderId = 'anthropic'): void {
  const keys = { ...store.get('keys') };
  delete keys[provider];
  store.set('keys', keys);
  if (provider === 'anthropic') store.set('apiKeyEncrypted', null);
}
