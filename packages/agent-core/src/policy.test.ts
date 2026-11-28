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

  it('blocks risky clicks outright, with no prompt', () => {
    const decision = policy.evaluateToolStep({
      id: '1',
      toolName: 'clickElement',
      input: { target: 'submit payment' },
      expected: 'clicked',
    });
    expect(decision.allowed).toBe(false);
    expect(decision.requiresConfirmation).toBe(false);
    expect(decision.reason).toMatch(/finds and reads funding only/);
  });

  it('judges a click by the element it really hits, not the selector', () => {
    const click = (facts?: { label: string; submitsForm: boolean }) =>
      policy.evaluateToolStep({
        id: '1',
        toolName: 'click',
        input: { target: '#btn-2', ...(facts ? { _facts: facts } : {}) },
        expected: '',
      }).allowed === false;
    // Research clicks always run, even when the page could not be inspected.
    expect(click()).toBe(false);
    expect(click({ label: 'Next page', submitsForm: false })).toBe(false);
    expect(click({ label: 'Search', submitsForm: false })).toBe(false);
    expect(click({ label: 'Remove filter', submitsForm: false })).toBe(false);
    expect(click({ label: 'Pay now', submitsForm: false })).toBe(true);
    expect(click({ label: 'Send message', submitsForm: false })).toBe(true);
    expect(click({ label: 'Delete account', submitsForm: false })).toBe(true);
    expect(click({ label: 'Continue', submitsForm: true })).toBe(true);
  });

  it('blocks Enter that submits a data form, but not a search box', () => {
    const enter = (submitsForm: boolean) =>
      policy.evaluateToolStep({
        id: '1',
        toolName: 'press_key',
        input: { key: 'Enter', _facts: { label: '', submitsForm } },
        expected: '',
      }).allowed === false;
    expect(enter(false)).toBe(false);
    expect(enter(true)).toBe(true);
  });

  it('blocks Space or Enter on a risky focused button', () => {
    const press = (key: string, label: string, activates: boolean) =>
      policy.evaluateToolStep({
        id: '1',
        toolName: 'press_key',
        input: { key, _facts: { label, submitsForm: false, activates } },
        expected: '',
      }).allowed === false;
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

    expect(redacted.apiKey).toBe('[REDACTED]');
    expect(redacted.token).toBe('[REDACTED]');
    expect(redacted.safe).toBe('ok');
  });

  it('never stops steps that only find information', () => {
    for (const target of ['#confirm', '.primary', '[data-action="x"]', 'Continue', 'Apply filters', 'Submit search']) {
      expect(policy.evaluateToolStep({ id: 'x', toolName: 'click', input: { target }, expected: '' })
        .allowed).toBe(true);
    }
    expect(policy.evaluateToolStep({ id: 'x', toolName: 'press_key', input: { key: 'Enter' }, expected: '' })
      .allowed).toBe(true);
    expect(policy.evaluateToolStep({ id: 'x', toolName: 'close_tab', input: { tabId: 't' }, expected: '' })
      .allowed).toBe(true);
  });

  it('blocks paying, sending, deleting, submitting an application or opening an account', () => {
    for (const target of ['submit payment', 'Place order', 'Delete account', 'Send', 'Sign up', 'Upload file', 'Create an account', 'Submit application', 'Submit my proposal']) {
      expect(policy.evaluateToolStep({ id: 'x', toolName: 'click', input: { target }, expected: '' })
        .allowed, target).toBe(false);
    }
    const upload = policy.evaluateToolStep({ id: 'x', toolName: 'upload_file', input: {}, expected: '' });
    expect(upload.allowed).toBe(false);
    for (const decision of [upload]) expect(decision.requiresConfirmation).toBe(false);
  });
});

it('redacts credential-bearing URLs and auth fields in audit copies without changing executable inputs', () => {
  const policy = new PrivacyPolicyEngine();
  const input = { url: 'https://user:password@agency.gov/grants?token=private&program=college', apiKey: 'private-key', authorization: 'private-header' };
  const copy = policy.redact(input);
  expect(JSON.stringify(copy)).not.toMatch(/password|private|user:/);
  expect(JSON.stringify(copy)).toContain('program=college');
  expect(input.url).toContain('token=private');
});
