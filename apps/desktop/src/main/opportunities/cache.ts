// A short memory of what each source returned for a search, so that repeating
// one — coming back to the results, a second click — does not ask the source
// again. It lives in memory only and is never written to disk. A listing read
// from it keeps the fetchedAt of the moment it came from the source, so
// status.ts goes on ageing it: a cache can make a result older, never fresher.

import type { Opportunity, OpportunityFilters } from '../../shared/funding.js';
import { queryTerms } from './normalize.js';

export const CACHE_LIFETIME_MS = 15 * 60 * 1000;

// One search is remembered once per source, and one source's answer can run to
// a few thousand listings, so both the answers and the listings are bounded.
const MAX_ENTRIES = 48;
const MAX_LISTINGS = 20_000;

export interface CachedListings {
  /** Exactly what the source's adapter returned. Shared, so treat as read-only. */
  opportunities: Opportunity[];
  /** When the source was read (epoch ms). */
  fetchedAt: number;
}

const fold = (value: string): string => value.normalize('NFKC').trim().toLowerCase();
const sorted = <T extends string>(values: readonly T[]): T[] => [...new Set(values)].sort();

export type FilterName = keyof OpportunityFilters;

// Each filter in the one form that every way of writing the same choice shares:
// the same options in another order, the same words in another case.
const SAME_CHOICE: { [Name in FilterName]: (filters: OpportunityFilters) => unknown } = {
  query: (filters) => sorted(queryTerms(filters.query)),
  levels: (filters) => sorted(filters.levels),
  place: ({ place }) => [fold(place.country), fold(place.region), fold(place.county), fold(place.city)],
  applicantTypes: (filters) => sorted(filters.applicantTypes),
  categories: (filters) => sorted(filters.categories),
  kinds: (filters) => sorted(filters.kinds),
  amountMin: (filters) => filters.amountMin,
  amountMax: (filters) => filters.amountMax,
  includeAmountNotStated: (filters) => filters.includeAmountNotStated,
  deadlineFrom: (filters) => filters.deadlineFrom,
  deadlineTo: (filters) => filters.deadlineTo,
  statuses: (filters) => sorted(filters.statuses),
  sourceIds: (filters) => sorted(filters.sourceIds),
};

export const FILTER_NAMES = Object.keys(SAME_CHOICE) as FilterName[];

/**
 * One key per source and search. Every filter is part of it, because a source
 * may read any of them, unless the source's adapter names the ones it reads:
 * a filter it never looks at cannot change its answer, so it is left out and
 * the remembered answer serves every value of it. The device applies that
 * filter to the answer either way.
 */
export function cacheKey(
  sourceId: string,
  filters: OpportunityFilters,
  read: readonly FilterName[] = FILTER_NAMES,
): string {
  return JSON.stringify([
    sourceId,
    ...FILTER_NAMES.map((name) => (read.includes(name) ? SAME_CHOICE[name](filters) : null)),
  ]);
}

export class ListingCache {
  private readonly entries = new Map<string, CachedListings>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly lifetimeMs: number = CACHE_LIFETIME_MS,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  /** `key` comes from cacheKey. */
  get(key: string): CachedListings | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (this.isFresh(entry)) return entry;
    this.entries.delete(key);
    return null;
  }

  set(key: string, opportunities: Opportunity[], fetchedAt: number): void {
    for (const [other, entry] of this.entries) {
      if (!this.isFresh(entry)) this.entries.delete(other);
    }
    // Deleting first moves a refreshed search to the back of the queue.
    this.entries.delete(key);
    this.entries.set(key, { opportunities, fetchedAt });

    let held = 0;
    for (const entry of this.entries.values()) held += entry.opportunities.length;
    for (const [oldest, entry] of this.entries) {
      // The newest answer is always kept, however large it is.
      if (oldest === key || (this.entries.size <= MAX_ENTRIES && held <= MAX_LISTINGS)) break;
      this.entries.delete(oldest);
      held -= entry.opportunities.length;
    }
  }

  clear(): void {
    this.entries.clear();
  }

  // A clock that has moved backwards makes the age negative; such an entry
  // cannot be trusted either.
  private isFresh(entry: CachedListings): boolean {
    const age = this.now() - entry.fetchedAt;
    return age >= 0 && age < this.lifetimeMs;
  }
}
