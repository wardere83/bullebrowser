// Small pieces of logic for the listings an organization has saved: finding
// one, counting them by status, and telling whether a note has been changed.

import {
  OPPORTUNITY_STATUS_LABELS,
  type OpportunityStatus,
  type SavedOpportunity,
} from '../../../shared/funding.js';
import { pluralize } from '../../lib/funding-client.js';
import { STATUS_GROUP_ORDER, groupByStatus, listInWords } from './results.js';

/** Saved listings by the id of the listing, for "is this one saved?". */
export function indexSaved(
  saved: readonly SavedOpportunity[] | undefined,
): Map<string, SavedOpportunity> {
  const index = new Map<string, SavedOpportunity>();
  for (const entry of saved ?? []) index.set(entry.opportunity.id, entry);
  return index;
}

export function countByStatus(
  saved: readonly SavedOpportunity[],
): Record<OpportunityStatus, number> {
  const counts: Record<OpportunityStatus, number> = { active: 0, expired: 0, unverified: 0 };
  for (const group of groupByStatus(saved, (entry) => entry.opportunity.status)) {
    counts[group.status] = group.items.length;
  }
  return counts;
}

/** "3 saved listings: 1 active, 1 unverified and 1 expired." */
export function savedSummary(saved: readonly SavedOpportunity[]): string {
  if (saved.length === 0) return 'No saved listings.';
  const counts = countByStatus(saved);
  const parts = STATUS_GROUP_ORDER.filter((status) => counts[status] > 0).map(
    (status) => `${counts[status]} ${OPPORTUNITY_STATUS_LABELS[status].toLowerCase()}`,
  );
  return `${pluralize(saved.length, 'saved listing')}: ${listInWords(parts)}.`;
}

/** True when what is typed differs from the note that is stored. */
export function noteIsChanged(stored: string, typed: string): boolean {
  return typed !== stored;
}

/**
 * True when the note that came back is shorter than the one that was sent:
 * main keeps a note to a fixed length, and a person should be told when theirs
 * was cut rather than find out later.
 */
export function noteWasShortened(sent: string, stored: string): boolean {
  return stored.length < sent.length && sent.startsWith(stored);
}
