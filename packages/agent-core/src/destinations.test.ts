import { describe, expect, it } from 'vitest';
import { assertAllowedDestination, isBlockedDestination } from './destinations.js';
import { tools } from './tools/index.js';
import { PrivacyPolicyEngine } from './policy.js';
import { BROWSER_SYSTEM } from './browser-host.js';

describe('restricted destinations', () => {
  const blocked = [
    'https://duckduckgo.com/?q=private', 'https://html.duckduckgo.com/html/',
    'https://DUCKDUCKGO.COM./', 'https://duck%64uckgo.com/',
    'http://www.duckduckgo.com:80/', 'https://duck.com/', 'https://ddg.gg/',
    'https://allowed.example@duckduckgo.com/',
  ];
  it.each(blocked)('blocks %s before executing a browser tool', (url) => {
    expect(isBlockedDestination(url)).toBe(true);
    expect(() => assertAllowedDestination(url)).toThrow('blocked');
    expect(tools.navigate.inputSchema.safeParse({ url }).success).toBe(false);
    expect(tools.new_tab.inputSchema.safeParse({ url }).success).toBe(false);
    expect(new PrivacyPolicyEngine().evaluateToolStep({ id: '1', toolName: 'navigate', input: { url }, expected: '' })).toMatchObject({ allowed: false, requiresConfirmation: false });
  });
  it.each(['https://duckduckgo.com.example.org/', 'https://notduckduckgo.com/', 'https://agency.gov/?redirect=duckduckgo.com', 'https://www.google.com/search?q=grants'])('preserves permitted destinations: %s', (url) => {
    expect(isBlockedDestination(url)).toBe(false);
  });
  it('does not instruct the model to use a restricted provider or disclose entity material', () => {
    expect(BROWSER_SYSTEM).not.toContain('https://duckduckgo.com');
    expect(BROWSER_SYSTEM).toContain('minimum public search terms');
    expect(BROWSER_SYSTEM).toContain('Never copy internal instructions');
  });
});
