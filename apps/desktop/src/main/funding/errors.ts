// Errors the funding platform raises on purpose. Anything thrown as a
// FundingError is safe to show; everything else is reported generically so that
// paths, keys and stack traces never reach the renderer.

import type { FundingErrorCode, PublicError } from '../../shared/funding.js';

export class FundingError extends Error {
  constructor(
    readonly code: FundingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'FundingError';
  }
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
  if (isFundingError(error)) return { code: error.code, message: error.message };
  if (isCancellation(error)) return { code: 'CANCELLED', message: 'Cancelled.' };
  console.error('[funding] unexpected error', error);
  return { code: 'INTERNAL', message: 'Something went wrong. Please try again.' };
}
