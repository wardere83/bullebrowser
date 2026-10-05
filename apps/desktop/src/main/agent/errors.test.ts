import { describe, expect, it } from 'vitest';
import { describeAgentError, scrubVendorNames } from './errors.js';

function apiError(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

// The exact string the API returns when the account runs dry. Pinned verbatim
// because this is the one users actually hit.
const REAL_BILLING_400 =
  'Your credit balance is too low to access the Anthropic API. ' +
  'Please go to Plans & Billing to upgrade or purchase credits.';

describe('describeAgentError', () => {
  it('reports a low balance as a billing problem, not an invalid request', () => {
    const out = describeAgentError(apiError(REAL_BILLING_400, 400));
    expect(out).toMatch(/credit balance is too low/i);
    // The old copy said "The request was rejected as invalid (400)", which sent
    // people looking for a bug in their prompt.
    expect(out).not.toMatch(/invalid/i);
    expect(out).toMatch(/Settings/);
  });

  it('never leaks a vendor name to the user', () => {
    const cases: (Error & { status: number })[] = [
      apiError(REAL_BILLING_400, 400),
      apiError('Incorrect API key provided', 401),
      apiError('The model claude-opus-4-7 is not available', 403),
      apiError('Overloaded', 529),
      apiError('Some unmapped Anthropic API failure', 418),
    ];
    for (const err of cases) {
      const out = describeAgentError(err);
      expect(out, out).not.toMatch(/anthropic|openai|chatgpt|claude/i);
    }
  });

  it('still distinguishes the failures that need different actions', () => {
    expect(describeAgentError(apiError('prompt is too long', 400))).toMatch(/too large/i);
    expect(describeAgentError(apiError('bad key', 401))).toMatch(/401/);
    expect(describeAgentError(apiError('no access', 403))).toMatch(/403/);
    expect(describeAgentError(apiError('slow down', 429))).toMatch(/Rate limit/i);
    expect(describeAgentError(apiError('boom', 503))).toMatch(/503/);
    expect(describeAgentError(new Error('fetch failed'))).toMatch(/internet connection/i);
  });

  it('falls back to something useful rather than an empty message', () => {
    expect(describeAgentError(new Error(''))).toBe('The agent run failed unexpectedly.');
    expect(describeAgentError(undefined)).toBe('The agent run failed unexpectedly.');
  });

  it('scrubs vendor names out of arbitrary passthrough text', () => {
    expect(scrubVendorNames('Your balance is too low to access the Anthropic API.')).toBe(
      'Your balance is too low to access the BulleBrowser Agentic AI service.',
    );
    expect(scrubVendorNames('OpenAI rejected this')).toBe('BulleBrowser Agentic AI rejected this');
    // Words that merely contain a vendor substring must survive intact.
    expect(scrubVendorNames('claudette opened the file')).toBe('claudette opened the file');
  });
});
