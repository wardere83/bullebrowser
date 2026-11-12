import { describe, expect, it } from 'vitest';
import { anthropicAuth, hasModelAccess } from './anthropic-auth.js';

const credentials = async () => ({ token: 'test-access', expiresAt: null });

describe('Claude authentication choice', () => {
  it('uses a saved key first and credentials only without one', () => {
    expect(anthropicAuth({ apiKey: 'test-key', anthropicCredentials: credentials })).toEqual({ apiKey: 'test-key' });
    expect(anthropicAuth({ anthropicCredentials: credentials })).toEqual({ apiKey: null, authToken: null, credentials });
    expect(anthropicAuth({})).toEqual({ apiKey: undefined });
  });

  it('counts credentials as access for Claude models only', () => {
    expect(hasModelAccess({ model: 'claude-opus-4-7', anthropicCredentials: credentials })).toBe(true);
    expect(hasModelAccess({ model: 'gpt-4o', anthropicCredentials: credentials })).toBe(false);
    expect(hasModelAccess({ model: 'gpt-4o', apiKey: 'test-key' })).toBe(true);
    expect(hasModelAccess({ model: 'claude-opus-4-7' })).toBe(false);
  });
});
