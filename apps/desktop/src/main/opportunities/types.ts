// What every official funding source must provide. An adapter talks to exactly
// one source, turns its records into Opportunity objects and decides nothing
// about status on its own: it reports what the source says and status.ts applies
// the same rule to every source.

import type {
  FundingSourceInfo,
  Opportunity,
  OpportunityDetail,
  OpportunityFilters,
} from '../../shared/funding.js';
import type { HttpClient } from './http.js';

export interface SourceContext {
  signal: AbortSignal;
  /** Epoch ms for "now"; passed in so results are testable. */
  now: number;
  http: HttpClient;
}

export interface SourceAdapter {
  readonly info: FundingSourceInfo;
  /**
   * Listings from the source for these filters. An adapter may pass filters
   * the source supports to the source, and must return everything else
   * unfiltered: the service applies every filter again on the device, so a
   * source that ignores a filter can never leak a non-matching listing.
   *
   * Must throw a FundingError('SOURCE_UNAVAILABLE', …) when the response is
   * not what the source documents, rather than return partial or guessed rows.
   */
  search(filters: OpportunityFilters, context: SourceContext): Promise<Opportunity[]>;
  /**
   * Re-reads one listing. `recordId` is the part of Opportunity.id after the
   * source id. Used for the detail view and to re-check saved listings.
   */
  detail(recordId: string, context: SourceContext): Promise<OpportunityDetail>;
}

/** Builds the stable listing id used everywhere outside the adapter. */
export function opportunityId(sourceId: string, recordId: string | number): string {
  return `${sourceId}:${recordId}`;
}

/** Splits a listing id back into its source and record parts. */
export function parseOpportunityId(id: string): { sourceId: string; recordId: string } | null {
  const at = id.indexOf(':');
  if (at <= 0 || at === id.length - 1) return null;
  return { sourceId: id.slice(0, at), recordId: id.slice(at + 1) };
}
