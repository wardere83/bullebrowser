// Turns a thrown provider error into something a person can act on.
//
// Kept free of electron imports so it can be unit-tested directly: these
// strings are the only thing a user sees when a run fails, so they are worth
// pinning down.

// Provider error strings are written by the vendor and name them ("...to access
// the Anthropic API"). Nothing client-facing may name a vendor, and these
// messages go straight into the chat, so scrub anything passed through.
export function scrubVendorNames(text: string): string {
  return text
    .replace(/\bthe Anthropic API\b/gi, 'the BulleBrowser Agentic AI service')
    .replace(/\bAnthropic(?: API)?\b/gi, 'BulleBrowser Agentic AI')
    .replace(/\bOpenAI(?: API)?\b/gi, 'BulleBrowser Agentic AI')
    .replace(/\bChatGPT\b/gi, 'BulleBrowser Agentic AI')
    .replace(/\bClaude\b/gi, 'BulleBrowser Agentic AI');
}

/**
 * The account behind the key has no credit left. Billing arrives as a 400
 * "invalid_request_error" or a 429, which it isn't: the request was fine.
 * The run then browses without the model instead of failing (see run.ts).
 */
export function isOutOfCredit(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  const code = (err as { code?: unknown })?.code;
  const raw = err instanceof Error ? err.message : '';
  return (
    status === 402 ||
    code === 'BILLING' ||
    /credit balance is too low|specified API usage limits|exceeded your current quota|insufficient_quota|insufficient (?:credit|quota|funds)|billing|payment required/i.test(
      raw,
    )
  );
}

export function describeAgentError(err: unknown): string {
  const status = (err as { status?: number })?.status;
  const raw = err instanceof Error ? err.message : '';

  // Normally handled by browsing without the model; never shown as a credit
  // problem in the chat.
  if (isOutOfCredit(err)) {
    return 'The AI service is unavailable right now. Please try again shortly.';
  }
  if (status === 400 && /prompt is too long|exceed|context/i.test(raw)) {
    return (
      'This task grew too large to continue — the pages read so far no longer ' +
      'fit in one conversation. Start a new chat and narrow the task (fewer ' +
      'pages, or ask for a specific fact rather than a full summary).'
    );
  }
  if (status === 400) return `The request was rejected (400). ${scrubVendorNames(raw)}`;
  if (status === 401) return 'Your API key was rejected (401). Check it in Settings.';
  if (status === 403) return 'Your API key does not have access to this assistant (403).';
  if (status === 429) return 'Rate limit reached (429). Wait a moment and try again.';
  if (status && status >= 500) {
    return `The AI service had an error (${status}). Please retry shortly.`;
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|network|timed out/i.test(raw)) {
    return 'Could not reach the AI service. Check your internet connection and try again.';
  }
  return scrubVendorNames(raw) || 'The agent run failed unexpectedly.';
}
