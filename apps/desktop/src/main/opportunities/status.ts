// The one rule that decides whether a listing may be called active.
//
// A source's own "open" flag is not enough: on the day this was written,
// official feeds listed opportunities as open whose deadlines had passed, that
// had closed hours earlier, or whose own text said they were archived. So a
// listing is active only when the source reports it open AND the app read a
// deadline that has not passed (or the source says it is ongoing) AND that was
// read recently. Everything else is expired or unverified, with the reason.

import type { Opportunity, OpportunityStatus, UnverifiedReason } from '../../shared/funding.js';

/** A result older than this is no longer shown as active without a re-check. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** A deadline further out than this is treated as a placeholder, not a date. */
const IMPLAUSIBLE_YEARS_AHEAD = 5;

export interface StatusInput {
  /** What the source itself reports about the listing. */
  sourceState: 'open' | 'forecast' | 'closed' | 'unknown';
  /** ISO date (YYYY-MM-DD) the adapter parsed, in the source's time zone. */
  closeDate: string | null;
  /** The source explicitly says there is no closing date (rolling, continuous). */
  ongoing: boolean;
  hasOfficialUrl: boolean;
  /** Wording from the source that contradicts its open flag, if any. */
  contradiction: string;
  /**
   * true  — the listing's own record was re-read and agrees.
   * false — re-reading it failed.
   * null  — the source has no separate record to re-read.
   */
  detailChecked: boolean | null;
  fetchedAt: number;
  now: number;
  /** IANA zone the source's dates are in, e.g. "America/New_York". */
  timeZone: string;
}

export interface StatusResult {
  status: OpportunityStatus;
  statusReason: string;
  unverifiedReason: UnverifiedReason | null;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date (YYYY-MM-DD) in a time zone. Falls back to UTC for a bad zone. */
export function todayIn(timeZone: string, now: number): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(now));
    const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
    const value = `${pick('year')}-${pick('month')}-${pick('day')}`;
    if (ISO_DATE_RE.test(value)) return value;
  } catch {
    // An unknown zone name: use UTC below.
  }
  return new Date(now).toISOString().slice(0, 10);
}

/** A real calendar date in YYYY-MM-DD form, or null. */
export function normalizeIsoDate(value: string | null | undefined): string | null {
  if (!value || !ISO_DATE_RE.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  const real =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? value : null;
}

export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatChecked(fetchedAt: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(fetchedAt));
}

const unverified = (reason: UnverifiedReason, statusReason: string): StatusResult => ({
  status: 'unverified',
  statusReason,
  unverifiedReason: reason,
});

export function evaluateStatus(input: StatusInput): StatusResult {
  const closeDate = normalizeIsoDate(input.closeDate);
  const today = todayIn(input.timeZone, input.now);

  // A passed deadline or a closed flag settles it, whatever else the source says.
  if (input.sourceState === 'closed') {
    return { status: 'expired', statusReason: 'The source lists this as closed.', unverifiedReason: null };
  }
  if (closeDate && closeDate < today) {
    return {
      status: 'expired',
      statusReason: `The deadline passed on ${formatDate(closeDate)}.`,
      unverifiedReason: null,
    };
  }

  if (!input.hasOfficialUrl) {
    return unverified('no_official_link', 'There is no link to an official listing to check this against.');
  }
  if (input.sourceState === 'forecast') {
    return unverified('forecast', "Forecast: not open yet, and its dates are the funder's estimates.");
  }
  if (input.sourceState !== 'open') {
    return unverified('detail_unavailable', 'The source does not say whether this is open.');
  }
  if (input.contradiction) {
    return unverified(
      'source_contradiction',
      `The source lists this as open, but its own text says: "${input.contradiction.slice(0, 160)}"`,
    );
  }
  if (input.detailChecked === false) {
    return unverified('detail_unavailable', 'The listing could not be re-read from the source to confirm it.');
  }
  if (input.closeDate && !closeDate) {
    return unverified('implausible_deadline', 'The deadline the source gives could not be read as a date.');
  }
  if (closeDate) {
    const limit = `${Number(today.slice(0, 4)) + IMPLAUSIBLE_YEARS_AHEAD}${today.slice(4)}`;
    if (closeDate > limit) {
      return unverified(
        'implausible_deadline',
        `The source gives a deadline of ${formatDate(closeDate)}, which looks like a placeholder.`,
      );
    }
  } else if (!input.ongoing) {
    return unverified('no_deadline', 'The source lists this as open but gives no deadline.');
  }
  if (input.now - input.fetchedAt > STALE_AFTER_MS) {
    return unverified('stale', `Last checked ${formatChecked(input.fetchedAt)}. Check again to confirm it is still open.`);
  }

  return {
    status: 'active',
    statusReason: closeDate
      ? `Open at the source as of ${formatChecked(input.fetchedAt)}. Closes ${formatDate(closeDate)}.`
      : `Open at the source as of ${formatChecked(input.fetchedAt)}, with no closing date.`,
    unverifiedReason: null,
  };
}

/**
 * Re-evaluates a stored listing at display time. Time alone can only make a
 * listing less certain: an active one expires when its deadline passes and
 * becomes unverified once the check is stale. It never turns something active.
 */
export function refreshStatus(opportunity: Opportunity, now: number, timeZone: string): Opportunity {
  const closeDate = normalizeIsoDate(opportunity.closeDate);
  if (opportunity.status !== 'expired' && closeDate && closeDate < todayIn(timeZone, now)) {
    return {
      ...opportunity,
      status: 'expired',
      statusReason: `The deadline passed on ${formatDate(closeDate)}.`,
      unverifiedReason: null,
    };
  }
  if (opportunity.status === 'active' && now - opportunity.fetchedAt > STALE_AFTER_MS) {
    return {
      ...opportunity,
      status: 'unverified',
      statusReason: `Last checked ${formatChecked(opportunity.fetchedAt)}. Check again to confirm it is still open.`,
      unverifiedReason: 'stale',
    };
  }
  return opportunity;
}
