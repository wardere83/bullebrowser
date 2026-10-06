// Errors the funding platform raises on purpose. Anything thrown as a
// FundingError is safe to show; everything else is reported generically so that
// paths, keys and stack traces never reach the renderer.

import type { FundingErrorCode, OrgConsents, PublicError } from '../../shared/funding.js';

export class FundingError extends Error {
  constructor(
    readonly code: FundingErrorCode,
    message: string,
    /** With CONSENT_REQUIRED: which acknowledgement is missing. */
    readonly consent?: keyof OrgConsents,
  ) {
    super(message);
    this.name = 'FundingError';
  }
}

/** Raised before anything leaves the device without the user's say-so. */
export function consentRequired(consent: keyof OrgConsents): FundingError {
  return new FundingError(
    'CONSENT_REQUIRED',
    consent === 'documentAnalysisAt'
      ? 'Confirm that excerpts of your documents may be sent to the connected assistant.'
      : 'Confirm that your search terms and filters may be sent to the official funding sources.',
    consent,
  );
}

export function isFundingError(error: unknown): error is FundingError {
  return error instanceof FundingError;
}

/** True for the abort raised when a person cancels a job. */
export function isCancellation(error: unknown): boolean {
  if (isFundingError(error)) return error.code === 'CANCELLED';
  const name = (error as { name?: string } | null)?.name ?? '';
  const message = error instanceof Error ? error.message : '';
  return name === 'AbortError' || name === 'APIUserAbortError' || /^cancell?ed$/i.test(message);
}

export function toPublicError(error: unknown): PublicError {
  if (isFundingError(error)) {
    return error.consent
      ? { code: error.code, message: error.message, consent: error.consent }
      : { code: error.code, message: error.message };
  }
  if (isCancellation(error)) return { code: 'CANCELLED', message: 'Cancelled.' };
  console.error('[funding] unexpected error', error);
  return { code: 'INTERNAL', message: 'Something went wrong. Please try again.' };
}
