// Checks on what arrives from the main process, made once at the door.
//
// The bridge is typed, but a typed promise says nothing about what actually
// comes back, and the last search is kept for the whole visit: an answer the
// screen cannot draw would fail again every time the screen was opened. So an
// answer of the wrong shape is refused as a whole, and a single entry that
// cannot be shown is left out and counted. Nothing is filled in or corrected.

import type {
  FundingSourceInfo,
  OfficialPortal,
  Opportunity,
  OpportunityDetail,
  OpportunitySearchResult,
  SavedOpportunity,
  SourceRunReport,
} from '../../../shared/funding.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isName = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** A listing can be shown when it is identified and has a title. */
export function isListing(value: unknown): value is Opportunity {
  return isRecord(value) && isName(value.id) && isName(value.title);
}

function isReport(value: unknown): value is SourceRunReport {
  return (
    isRecord(value) &&
    isName(value.sourceId) &&
    isName(value.sourceName) &&
    typeof value.state === 'string' &&
    isCount(value.received) &&
    isCount(value.matched) &&
    typeof value.message === 'string'
  );
}

export interface ReadSearchResult {
  result: OpportunitySearchResult;
  /** Listings that arrived but could not be shown, and so are not in `result`. */
  unreadable: number;
}

/**
 * A search result the screen can draw, or null when the answer is not one.
 * Every source's report must be readable: a report that cannot be read might
 * be the one saying its source failed, and the results would then look
 * complete when they are not.
 */
export function readSearchResult(value: unknown): ReadSearchResult | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.opportunities) ||
    !Array.isArray(value.reports) ||
    typeof value.truncated !== 'boolean' ||
    !isCount(value.searchedAt)
  ) {
    return null;
  }
  const reports: unknown[] = value.reports;
  if (!reports.every(isReport)) return null;
  const arrived: unknown[] = value.opportunities;
  const opportunities = arrived.filter(isListing);
  return {
    result: {
      opportunities,
      reports,
      truncated: value.truncated,
      searchedAt: value.searchedAt,
    },
    unreadable: arrived.length - opportunities.length,
  };
}

/** The saved listings that can be shown, or null when the answer is not a list. */
export function readSavedList(value: unknown): SavedOpportunity[] | null {
  if (!Array.isArray(value)) return null;
  return (value as unknown[]).filter(
    (entry): entry is SavedOpportunity => isRecord(entry) && isListing(entry.opportunity),
  );
}

/** A listing's detail, or null when the answer does not hold the listing. */
export function readDetail(value: unknown): OpportunityDetail | null {
  if (!isRecord(value) || !isListing(value.opportunity)) return null;
  const facts: unknown[] = Array.isArray(value.facts) ? value.facts : [];
  const links: unknown[] = Array.isArray(value.links) ? value.links : [];
  return {
    opportunity: value.opportunity,
    description: typeof value.description === 'string' ? value.description : '',
    facts: facts.filter(
      (fact): fact is { label: string; value: string } =>
        isRecord(fact) && isName(fact.label) && typeof fact.value === 'string',
    ),
    links: links.filter(
      (link): link is { label: string; url: string } =>
        isRecord(link) && typeof link.label === 'string' && isName(link.url),
    ),
  };
}

/** The sources that can be named, or null when the answer is not a list. */
export function readSources(value: unknown): FundingSourceInfo[] | null {
  if (!Array.isArray(value)) return null;
  return (value as unknown[]).filter(
    (source): source is FundingSourceInfo =>
      isRecord(source) && isName(source.id) && isName(source.name),
  );
}

/** The official sites that can be linked to, or null when the answer is not a list. */
export function readPortals(value: unknown): OfficialPortal[] | null {
  if (!Array.isArray(value)) return null;
  return (value as unknown[]).filter(
    (portal): portal is OfficialPortal =>
      isRecord(portal) && isName(portal.id) && isName(portal.name) && isName(portal.level),
  );
}
