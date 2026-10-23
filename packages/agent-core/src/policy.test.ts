import { describe, expect, it } from 'vitest';
import { PrivacyPolicyEngine } from './policy.js';

describe('policy decisions and redaction', () => {
  const policy = new PrivacyPolicyEngine();

  it('blocks typing into sensitive fields', () => {
    const decision = policy.evaluateToolStep({
      id: '1',
      toolName: 'typeIntoField',
      input: { target: 'password', text: 'x' },
      expected: 'typed',
    });
    expect(decision.allowed).toBe(false);
  });

  it('requires confirmation for risky clicks', () => {
    const decision = policy.evaluateToolStep({
      id: '1',
      toolName: 'clickElement',
      input: { target: 'submit payment' },
      expected: 'clicked',
    });
    expect(decision.requiresConfirmation).toBe(true);
  });

  it('redacts API key and sensitive keys from logs', () => {
    const redacted = policy.redact({
      apiKey: 'sk-test-1234567890abcdef',
      token: 'Bearer abc.def.ghi',
      safe: 'ok',
    }) as Record<string, unknown>;

    expect(redacted.apiKey).toBe('[REDACTED_API_KEY]');
    expect(redacted.token).toBe('[REDACTED]');
    expect(redacted.safe).toBe('ok');
  });

  it('cannot bypass confirmation with opaque selectors or Enter', () => {
    for (const target of ['#confirm', '.primary', '[data-action="x"]', 'Continue']) {
      expect(policy.evaluateToolStep({ id: 'x', toolName: 'click', input: { target }, expected: '' })
        .requiresConfirmation).toBe(true);
    }
    expect(policy.evaluateToolStep({ id: 'x', toolName: 'press_key', input: { key: 'Enter' }, expected: '' })
      .requiresConfirmation).toBe(true);
    expect(policy.evaluateToolStep({ id: 'x', toolName: 'press_key', input: { key: 'Tab' }, expected: '' })
      .requiresConfirmation).toBe(false);
  });
});
