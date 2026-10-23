// What a search returned, put into words: how many listings, from which
// sources and when, which sources are missing and why, and the listings set
// out by status so that an active one is never mixed with the others.

import type {
  OpportunitySearchResult,
  OpportunityStatus,
  SourceRunReport,
} from '../../../shared/funding.js';
import { formatDateTime, pluralize } from '../../lib/funding-client.js';

/** "a", "a and b", "a, b and c". */
export function listInWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// ─────────────────────────────── listings by status ────────────────────────────

/** Active first, then what may still be open, then what is closed. */
export const STATUS_GROUP_ORDER: readonly OpportunityStatus[] = ['active', 'unverified', 'expired'];

export interface StatusGroup<T> {
  status: OpportunityStatus;
  items: T[];
}

/**
 * Items set out under their status, in the order above, each group keeping the
 * order the items arrived in. A status the app does not recognize is counted as
 * unverified: nothing is shown as active unless the source data says exactly that.
 */
export function groupByStatus<T>(
  items: readonly T[],
  statusOf: (item: T) => unknown,
): StatusGroup<T>[] {
  const groups = new Map<OpportunityStatus, T[]>();
  for (const item of items) {
    const stated = statusOf(item);
    const status: OpportunityStatus =
      stated === 'active' || stated === 'expired' ? stated : 'unverified';
    const group = groups.get(status);
    if (group) group.push(item);
    else groups.set(status, [item]);
  }
  return STATUS_GROUP_ORDER.flatMap((status) => {
    const found = groups.get(status);
    return found ? [{ status, items: found }] : [];
  });
}

// ──────────────────────────────── source reports ───────────────────────────────

export interface ReportSummary {
  /** Sources that answered. */
  read: SourceRunReport[];
  /** Sources that were asked and could not be read. */
  failed: SourceRunReport[];
  /** Sources that had nothing to add to this search and were not asked. */
  skipped: SourceRunReport[];
}

/**
 * Reports sorted by what happened. A report whose state the app does not
 * recognize counts as failed, so the results are called incomplete rather
 * than complete on a guess.
 */
export function summarizeReports(reports: readonly SourceRunReport[]): ReportSummary {
  const summary: ReportSummary = { read: [], failed: [], skipped: [] };
  for (const report of reports) {
    if (report.state === 'ok') summary.read.push(report);
    else if (report.state === 'skipped') summary.skipped.push(report);
    else summary.failed.push(report);
  }
  return summary;
}

export type ReportOutcome = 'read' | 'failed' | 'skipped';

export function reportOutcome(report: SourceRunReport): ReportOutcome {
  return report.state === 'ok' ? 'read' : report.state === 'skipped' ? 'skipped' : 'failed';
}

/** The words that go with each outcome, beside an icon of a different shape. */
export const REPORT_OUTCOME_LABELS: Record<ReportOutcome, string> = {
  read: 'Read',
  failed: 'Could not be read',
  skipped: 'Not searched',
};

/** One source's part of the search, in a sentence. */
export function reportSentence(report: SourceRunReport): string {
  const outcome = reportOutcome(report);
  if (outcome === 'read') {
    if (report.received === 0) return 'The source returned no listings.';
    const matching =
      report.matched === 0
        ? 'none match your filters'
        : report.matched === report.received
          ? report.received === 1
            ? 'it matches your filters'
            : 'all match your filters'
          : `${pluralize(report.matched, 'matches', 'match')} your filters`;
    return `${pluralize(report.received, 'listing')} read; ${matching}.`;
  }
  const message = report.message.trim();
  if (message) return message;
  return outcome === 'failed'
    ? 'This source could not be read.'
    : 'Not searched for these filters.';
}

/** "4 read, 1 could not be read, 1 not searched", leaving out what is zero. */
export function reportCounts(summary: ReportSummary): string {
  const parts = [
    summary.read.length > 0 ? `${summary.read.length} read` : '',
    summary.failed.length > 0 ? `${summary.failed.length} could not be read` : '',
    summary.skipped.length > 0 ? `${summary.skipped.length} not searched` : '',
  ].filter(Boolean);
  return parts.join(', ');
}

// ─────────────────────────────── the result in words ───────────────────────────

export function foundSentence(count: number): string {
  return count === 0 ? 'No listings found.' : `${pluralize(count, 'listing')} found.`;
}

/** Where the listings came from and when, or why there are none to show. */
export function readSentence(summary: ReportSummary, searchedAt: number): string {
  const when = formatDateTime(searchedAt);
  if (summary.read.length > 0) {
    return `Read from ${pluralize(summary.read.length, 'official source')} on ${when}.`;
  }
  if (summary.failed.length > 0) return `No official source could be read on ${when}.`;
  return 'No official source covers these filters, so none was searched.';
}

/** Names the sources whose listings are missing. Empty when every source asked was read. */
export function incompleteSentence(failed: readonly SourceRunReport[]): string {
  if (failed.length === 0) return '';
  const names = listInWords(failed.map((report) => report.sourceName));
  return failed.length === 1
    ? `${names} could not be read, so its listings are missing.`
    : `${names} could not be read, so their listings are missing.`;
}

/** Said when a truncated result arrives: what is shown is not everything that matched. */
export function truncatedSentence(shown: number): string {
  return `More listings matched than are listed here. These are the first ${shown}; add filters to narrow the search.`;
}

/** What is read out when a search finishes while focus is somewhere else. */
export function searchAnnouncement(result: OpportunitySearchResult): string {
  const summary = summarizeReports(result.reports);
  const parts = [foundSentence(result.opportunities.length)];
  if (summary.read.length > 0) {
    parts.push(`Read from ${pluralize(summary.read.length, 'official source')}.`);
  } else {
    parts.push(readSentence(summary, result.searchedAt));
  }
  if (summary.failed.length > 0) {
    parts.push(
      `The results are incomplete: ${pluralize(summary.failed.length, 'source')} could not be read.`,
    );
  }
  if (result.truncated) parts.push('More matched than are listed.');
  return parts.join(' ');
}

/** After this long, a status read in a search should not be relied on without searching again. */
export const RESULTS_AGE_AFTER_MS = 24 * 60 * 60 * 1000;

export function resultsAreOld(searchedAt: number, now: number): boolean {
  return now - searchedAt > RESULTS_AGE_AFTER_MS;
}
