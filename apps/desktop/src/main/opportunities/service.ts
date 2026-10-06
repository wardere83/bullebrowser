// One search across the official sources that can contribute to it.
//
// The service decides which sources to ask, asks them side by side, and then
// treats what comes back as unchecked: every filter is applied again on the
// device, every status is aged to the present moment, and each source is
// reported on separately. A source that fails, stalls or returns nonsense
// costs only its own listings. The rest of the search still answers, and the
// report says which source is missing and why.

import {
  GEO_LEVEL_LABELS,
  OPPORTUNITY_KIND_LABELS,
  type FundingSourceInfo,
  type Opportunity,
  type OpportunityDetail,
  type OpportunityFilters,
  type OpportunitySearchResult,
  type OpportunityStatus,
  type SourceRunReport,
} from '../../shared/funding.js';
import { FundingError, isFundingError } from '../funding/errors.js';
import { cacheKey, FILTER_NAMES, ListingCache, type FilterName } from './cache.js';
import {
  applyFilters,
  levelFrom,
  readFilters,
  SOURCE_ID_RE,
  sourceOutsidePlace,
  type OrganizationPlace,
} from './filters.js';
import type { HttpClient } from './http.js';
import { scoreMatch, type ProfileTerm } from './match.js';
import { normalizeIsoDate, refreshStatus, todayIn } from './status.js';
import { parseOpportunityId, type SourceAdapter, type SourceContext } from './types.js';

/** The most listings one search returns; `truncated` says when more matched. */
export const MAX_RESULTS = 200;

const SOURCES_AT_ONCE = 4;
const MAX_ID_LENGTH = 250;

/**
 * Two things an adapter may say about its source beyond the contract, as
 * properties beside `info`. Both are optional; a plain SourceAdapter works
 * without them.
 */
export interface SourceHints {
  /**
   * The IANA time zone the source's dates are in. Without it the service asks
   * only whether a deadline has passed everywhere on Earth, so ageing a
   * listing can never close one its source still counts as open.
   */
  readonly timeZone?: string;
  /**
   * The filters the adapter's answer depends on. Changing any other filter
   * then reuses the remembered answer instead of asking the source again.
   * Without it, every filter is taken to matter.
   */
  readonly filtersRead?: readonly FilterName[];
}

const LAST_TIME_ZONE = 'Etc/GMT+12';

function timeZoneOf(adapter: SourceAdapter & SourceHints): string {
  const zone: unknown = adapter.timeZone;
  if (typeof zone !== 'string' || !zone) return LAST_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    return LAST_TIME_ZONE;
  }
}

function filtersReadBy(adapter: SourceAdapter & SourceHints): readonly FilterName[] {
  const read: unknown = adapter.filtersRead;
  const usable = Array.isArray(read) && read.every((name) => FILTER_NAMES.includes(name as FilterName));
  return usable ? (read as FilterName[]) : FILTER_NAMES;
}

export interface OpportunitySearchInput {
  filters: OpportunityFilters;
  /** Where the organization is; decides which funders count as international. */
  organization: OrganizationPlace;
  /** Terms from the approved profile; empty when no profile is approved. */
  profileTerms: ProfileTerm[];
  signal: AbortSignal;
}

interface SourceOutcome {
  report: SourceRunReport;
  matched: Opportunity[];
}

const cancelled = () => new FundingError('CANCELLED', 'Cancelled.');
const invalidId = () => new FundingError('INVALID_INPUT', 'That listing reference is not valid.');
const NOT_CONFIRMED = 'The listing could not be re-read from the source to confirm it.';

const inWords = (items: string[]): string =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/** Why a source has nothing to add to this search, or '' when it should be asked. */
function skipReason(info: FundingSourceInfo, filters: OpportunityFilters, organization: OrganizationPlace): string {
  if (filters.sourceIds.length > 0 && !filters.sourceIds.includes(info.id)) {
    return 'Not chosen for this search.';
  }
  if (filters.kinds.length > 0 && !info.kinds.some((kind) => filters.kinds.includes(kind))) {
    const lists = info.kinds.map((kind) => `${OPPORTUNITY_KIND_LABELS[kind].toLowerCase()}s`);
    return `Not searched: it lists ${inWords(lists)} only.`;
  }
  const level = levelFrom(info.level, info.coverage.country, organization.country);
  if (filters.levels.length > 0 && !filters.levels.includes(level)) {
    const lists = GEO_LEVEL_LABELS[level].toLowerCase();
    const asked = inWords(filters.levels.map((chosen) => GEO_LEVEL_LABELS[chosen].toLowerCase()));
    return `Not searched: it lists ${lists} funding, and this search is limited to ${asked} funding.`;
  }
  if (sourceOutsidePlace(info, filters.place)) {
    return `Not searched: it covers ${info.jurisdiction || 'another place'} only.`;
  }
  return '';
}

/**
 * What a source returned, checked far enough that merging and ordering it with
 * other sources' listings cannot fail: it is a list, each listing is this
 * source's own and has a title, and none is counted twice.
 */
function readListings(value: unknown, info: FundingSourceInfo): Opportunity[] {
  const unreadable = () =>
    new FundingError('SOURCE_UNAVAILABLE', `${info.name} returned listings the app could not read.`);
  if (!Array.isArray(value)) throw unreadable();
  const byId = new Map<string, Opportunity>();
  for (const item of value as (Partial<Opportunity> | null)[]) {
    if (typeof item?.id !== 'string' || typeof item.title !== 'string') throw unreadable();
    if (item.sourceId !== info.id || parseOpportunityId(item.id)?.sourceId !== info.id) throw unreadable();
    if (!byId.has(item.id)) byId.set(item.id, item as Opportunity);
  }
  return [...byId.values()];
}

const STATUS_ORDER: Record<OpportunityStatus, number> = { active: 0, unverified: 1, expired: 2 };
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAway(closeDate: string | null, today: string): number {
  const date = normalizeIsoDate(closeDate);
  return date ? Math.abs(Date.parse(date) - Date.parse(today)) / DAY_MS : Infinity;
}

// Active first, then the closest match, then the nearest deadline, then title.
// Comparing two missing deadlines gives NaN, which falls through like a tie.
const inDisplayOrder =
  (today: string) =>
  (a: Opportunity, b: Opportunity): number =>
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
    (b.match?.score ?? -1) - (a.match?.score ?? -1) ||
    daysAway(a.closeDate, today) - daysAway(b.closeDate, today) ||
    a.title.localeCompare(b.title, 'en', { sensitivity: 'base', numeric: true }) ||
    a.id.localeCompare(b.id);

/** Runs `work` over `items`, never more than `limit` at a time. */
async function inTurns<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      await work(items[next++]!);
    }
  });
  await Promise.all(lanes);
}

/**
 * Rejects the moment the search is cancelled, without waiting for a source
 * that ignores the signal. The caller has already checked that it is not
 * cancelled yet.
 */
function untilCancelled<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(cancelled());
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export class OpportunityService {
  private readonly adapters: SourceAdapter[];
  private readonly http: HttpClient;
  private readonly now: () => number;
  private readonly cache: ListingCache;
  private readonly zones = new Map<string, string>();
  private readonly filtersRead = new Map<string, readonly FilterName[]>();

  constructor(deps: { adapters: SourceAdapter[]; http: HttpClient; now?: () => number }) {
    for (const adapter of deps.adapters) {
      const { id } = adapter.info;
      // Listing ids are "<source id>:<record id>" and filters name sources by
      // id, so an id must be plain, colon-free and used once.
      if (!SOURCE_ID_RE.test(id) || this.zones.has(id)) {
        throw new Error(`Funding source id "${id}" is repeated or is not a plain name.`);
      }
      this.zones.set(id, timeZoneOf(adapter));
      this.filtersRead.set(id, filtersReadBy(adapter));
    }
    this.adapters = [...deps.adapters];
    this.http = deps.http;
    this.now = deps.now ?? Date.now;
    this.cache = new ListingCache(this.now);
  }

  sources(): FundingSourceInfo[] {
    return this.adapters.map((adapter) => adapter.info);
  }

  /** The time zone to age a listing in (status.ts, refreshStatus), wherever it is kept. */
  timeZoneFor(opportunity: Opportunity): string {
    return this.zones.get(opportunity?.sourceId) ?? LAST_TIME_ZONE;
  }

  async search(input: OpportunitySearchInput): Promise<OpportunitySearchResult> {
    const filters = readFilters(input.filters);
    const { signal } = input;
    if (signal.aborted) throw cancelled();
    const searchedAt = this.now();
    const organization: OrganizationPlace = {
      country: String(input.organization?.country ?? ''),
      region: String(input.organization?.region ?? ''),
      county: String(input.organization?.county ?? ''),
      city: String(input.organization?.city ?? ''),
    };

    const outcomes = new Map<string, SourceOutcome>();
    const asked: SourceAdapter[] = [];
    for (const adapter of this.adapters) {
      const reason = skipReason(adapter.info, filters, organization);
      if (!reason) {
        asked.push(adapter);
        continue;
      }
      outcomes.set(adapter.info.id, {
        report: this.report(adapter.info, 'skipped', searchedAt, { message: reason }),
        matched: [],
      });
    }

    await untilCancelled(
      inTurns(asked, SOURCES_AT_ONCE, async (adapter) => {
        if (signal.aborted) return;
        outcomes.set(adapter.info.id, await this.ask(adapter, filters, organization, input));
      }),
      signal,
    );

    const found = new Map<string, Opportunity>();
    const reports: SourceRunReport[] = [];
    for (const adapter of this.adapters) {
      const outcome = outcomes.get(adapter.info.id);
      if (!outcome) continue;
      reports.push(outcome.report);
      for (const opportunity of outcome.matched) {
        if (!found.has(opportunity.id)) found.set(opportunity.id, opportunity);
      }
    }
    const ordered = [...found.values()].sort(inDisplayOrder(todayIn('UTC', searchedAt)));
    return {
      opportunities: ordered.slice(0, MAX_RESULTS),
      reports,
      truncated: ordered.length > MAX_RESULTS,
      searchedAt,
    };
  }

  async detail(opportunityId: string, signal: AbortSignal): Promise<OpportunityDetail> {
    const { adapter, recordId } = this.locate(opportunityId);
    if (signal.aborted) throw cancelled();
    try {
      const detail = await adapter.detail(recordId, this.context(signal, this.now()));
      if (detail?.opportunity?.id !== opportunityId) {
        throw new FundingError(
          'SOURCE_UNAVAILABLE',
          `${adapter.info.name} returned a different listing from the one asked for.`,
        );
      }
      return detail;
    } catch (error) {
      if (signal.aborted) throw cancelled();
      throw this.readable(error, adapter.info);
    }
  }

  /**
   * Re-reads one stored listing. When the source cannot be read the listing
   * comes back as it was stored, but never as active: a passed deadline still
   * makes it expired, and anything else is unverified until it can be read.
   */
  async recheck(opportunity: Opportunity, signal: AbortSignal): Promise<Opportunity> {
    if (typeof opportunity?.id !== 'string') throw invalidId();
    if (signal.aborted) throw cancelled();
    try {
      const detail = await this.detail(opportunity.id, signal);
      // The match was worked out against the profile, which a re-read does not change.
      return { ...detail.opportunity, match: opportunity.match ?? null };
    } catch (error) {
      if (signal.aborted) throw cancelled();
      const aged = refreshStatus(opportunity, this.now(), this.timeZoneFor(opportunity));
      if (aged.status === 'expired') return aged;
      const withdrawn = isFundingError(error) && error.code === 'NOT_FOUND' && this.knows(opportunity.id);
      return {
        ...opportunity,
        status: 'unverified',
        unverifiedReason: 'detail_unavailable',
        statusReason: withdrawn
          ? 'The source no longer has this listing, so it could not be confirmed.'
          : NOT_CONFIRMED,
      };
    }
  }

  private knows(opportunityId: string): boolean {
    const sourceId = parseOpportunityId(opportunityId)?.sourceId;
    return this.adapters.some((adapter) => adapter.info.id === sourceId);
  }

  private locate(opportunityId: string): { adapter: SourceAdapter; recordId: string } {
    if (typeof opportunityId !== 'string' || opportunityId.length > MAX_ID_LENGTH) throw invalidId();
    const parts = parseOpportunityId(opportunityId);
    if (!parts) throw invalidId();
    const adapter = this.adapters.find((candidate) => candidate.info.id === parts.sourceId);
    if (!adapter) {
      throw new FundingError('NOT_FOUND', 'That listing comes from a source this version of the app does not read.');
    }
    return { adapter, recordId: parts.recordId };
  }

  private context(signal: AbortSignal, now: number): SourceContext {
    return { signal, now, http: this.http };
  }

  private report(
    info: FundingSourceInfo,
    state: SourceRunReport['state'],
    startedAt: number,
    rest: Partial<SourceRunReport> = {},
  ): SourceRunReport {
    return {
      sourceId: info.id,
      sourceName: info.name,
      state,
      received: 0,
      matched: 0,
      fetchedAt: startedAt,
      durationMs: Math.max(0, this.now() - startedAt),
      message: '',
      ...rest,
    };
  }

  /** An error that is safe to show. Anything unexpected is logged and replaced by a plain sentence. */
  private readable(error: unknown, info: FundingSourceInfo): FundingError {
    if (isFundingError(error) && error.code !== 'CANCELLED') return error;
    if (!isFundingError(error)) console.error(`[funding] ${info.id} failed unexpectedly`, error);
    return new FundingError('SOURCE_UNAVAILABLE', `${info.name} could not be read. Try again in a moment.`);
  }

  /** One source's part of a search. Never throws: a failure becomes that source's report. */
  private async ask(
    adapter: SourceAdapter,
    filters: OpportunityFilters,
    organization: OrganizationPlace,
    input: OpportunitySearchInput,
  ): Promise<SourceOutcome> {
    const { info } = adapter;
    const startedAt = this.now();
    try {
      const key = cacheKey(info.id, filters, this.filtersRead.get(info.id));
      let read = this.cache.get(key);
      if (!read) {
        const listings = readListings(await adapter.search(filters, this.context(input.signal, startedAt)), info);
        read = { opportunities: listings, fetchedAt: startedAt };
        if (!input.signal.aborted) this.cache.set(key, listings, startedAt);
      }
      const now = this.now();
      const zone = this.zones.get(info.id) ?? LAST_TIME_ZONE;
      const aged = read.opportunities.map((opportunity) => refreshStatus(opportunity, now, zone));
      const matched = applyFilters(aged, filters, organization).map((opportunity) => ({
        ...opportunity,
        match: scoreMatch(opportunity, input.profileTerms),
      }));
      return {
        report: this.report(info, 'ok', startedAt, {
          received: read.opportunities.length,
          matched: matched.length,
          fetchedAt: read.fetchedAt,
        }),
        matched,
      };
    } catch (error) {
      // A cancelled search is rejected as a whole; what is returned here is discarded.
      const message = input.signal.aborted ? 'Cancelled.' : this.readable(error, info).message;
      return { report: this.report(info, 'failed', startedAt, { message }), matched: [] };
    }
  }
}
