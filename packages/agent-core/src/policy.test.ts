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

  it('judges a click by the element it really hits, not the selector', () => {
    const click = (facts?: { label: string; submitsForm: boolean }) =>
      policy.evaluateToolStep({
        id: '1',
        toolName: 'click',
        input: { target: '#btn-2', ...(facts ? { _facts: facts } : {}) },
        expected: '',
      }).requiresConfirmation;
    expect(click()).toBe(false);
    expect(click({ label: 'Next page', submitsForm: false })).toBe(false);
    expect(click({ label: 'Delete account', submitsForm: false })).toBe(true);
    expect(click({ label: 'Continue', submitsForm: true })).toBe(true);
  });

  it('asks before Enter submits a data form, but not a search box', () => {
    const enter = (submitsForm: boolean) =>
      policy.evaluateToolStep({
        id: '1',
        toolName: 'press_key',
        input: { key: 'Enter', _facts: { label: '', submitsForm } },
        expected: '',
      }).requiresConfirmation;
    expect(enter(false)).toBe(false);
    expect(enter(true)).toBe(true);
  });

  it('asks before Space or Enter presses a risky focused button', () => {
    const press = (key: string, label: string, activates: boolean) =>
      policy.evaluateToolStep({
        id: '1',
        toolName: 'press_key',
        input: { key, _facts: { label, submitsForm: false, activates } },
        expected: '',
      }).requiresConfirmation;
    expect(press('Space', 'Delete account', true)).toBe(true);
    expect(press('Enter', 'Delete account', true)).toBe(true);
    expect(press('Enter', 'Send to', false)).toBe(false);
    expect(press('Space', 'Next', true)).toBe(false);
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
});
