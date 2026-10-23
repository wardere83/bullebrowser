import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_OPPORTUNITY_FILTERS, type Opportunity, type OpportunityFilters } from '../../shared/funding.js';
import { CACHE_LIFETIME_MS, FILTER_NAMES, ListingCache, cacheKey } from './cache.js';
import { refreshStatus, STALE_AFTER_MS } from './status.js';

const START = Date.UTC(2026, 9, 6, 12, 0, 0);
const MINUTE = 60 * 1000;

const filters = (patch: Partial<OpportunityFilters> = {}): OpportunityFilters => ({
  ...DEFAULT_OPPORTUNITY_FILTERS,
  ...patch,
});
const key = (patch: Partial<OpportunityFilters> = {}, sourceId = 'grants-gov'): string =>
  cacheKey(sourceId, filters(patch));
const listing = (id: string, patch: Partial<Opportunity> = {}): Opportunity =>
  ({ id, status: 'active', closeDate: '2026-11-15', fetchedAt: START, ...patch }) as Opportunity;

let now: number;
let cache: ListingCache;

beforeEach(() => {
  now = START;
  cache = new ListingCache(() => now);
});

describe('ListingCache', () => {
  it('lasts fifteen minutes', () => {
    expect(CACHE_LIFETIME_MS).toBe(15 * MINUTE);
  });

  it('returns what a source gave for a search until fifteen minutes have passed', () => {
    const listings = [listing('grants-gov:1'), listing('grants-gov:2')];
    expect(cache.get(key())).toBeNull();
    cache.set(key(), listings, START);

    now = START + 14 * MINUTE + 59_999;
    expect(cache.get(key())).toEqual({ opportunities: listings, fetchedAt: START });

    now = START + 15 * MINUTE;
    expect(cache.get(key())).toBeNull();
    // An expired search is dropped, not kept around.
    expect(cache.size).toBe(0);
    now = START + MINUTE;
    expect(cache.get(key())).toBeNull();
  });

  it('counts the fifteen minutes from when the source was read, not from when it was stored', () => {
    cache.set(key(), [listing('grants-gov:1')], START - 10 * MINUTE);
    now = START + 4 * MINUTE;
    expect(cache.get(key())).not.toBeNull();
    now = START + 5 * MINUTE;
    expect(cache.get(key())).toBeNull();
  });

  it('hands back the same listings with their original fetchedAt, so their status goes on ageing', () => {
    const original = listing('grants-gov:1', { closeDate: '2026-10-06' });
    cache.set(key(), [original], START);
    now = START + 10 * MINUTE;
    const read = cache.get(key())!;

    expect(read.fetchedAt).toBe(START);
    expect(read.opportunities[0]).toBe(original);
    expect(read.opportunities[0]!.fetchedAt).toBe(START);
    // Reading it from the cache did not make it any fresher.
    expect(refreshStatus(read.opportunities[0]!, START + STALE_AFTER_MS + 1, 'UTC')).toMatchObject({
      status: 'expired',
    });
    expect(refreshStatus(listing('grants-gov:2'), START + STALE_AFTER_MS + 1, 'UTC')).toMatchObject({
      status: 'unverified',
      unverifiedReason: 'stale',
    });
  });

  it('does not trust an entry once the clock has moved backwards', () => {
    cache.set(key(), [listing('grants-gov:1')], START);
    now = START - MINUTE;
    expect(cache.get(key())).toBeNull();
  });

  it('keeps each source and each search apart', () => {
    cache.set(key({ query: 'housing' }), [listing('grants-gov:1')], START);
    cache.set(key({ query: 'housing' }, 'ca-grants'), [listing('ca-grants:9')], START);

    expect(cache.get(key({ query: 'housing' }))!.opportunities[0]!.id).toBe('grants-gov:1');
    expect(cache.get(key({ query: 'housing' }, 'ca-grants'))!.opportunities[0]!.id).toBe('ca-grants:9');
    expect(cache.get(key({ query: 'health' }))).toBeNull();
    expect(cache.get(key({ query: 'housing', statuses: ['active', 'expired'] }))).toBeNull();
    expect(cache.get(key({ query: 'housing' }, 'ny-grants'))).toBeNull();
  });

  it('replaces an earlier answer to the same search', () => {
    cache.set(key(), [listing('grants-gov:1')], START);
    now = START + 5 * MINUTE;
    cache.set(key(), [listing('grants-gov:2')], now);
    expect(cache.size).toBe(1);
    expect(cache.get(key())).toMatchObject({
      fetchedAt: now,
      opportunities: [{ id: 'grants-gov:2' }],
    });
  });

  it('holds a bounded number of answers, letting go of the oldest', () => {
    for (let index = 0; index < 50; index += 1) {
      cache.set(key({ query: `search${index}` }), [listing(`grants-gov:${index}`)], START);
    }
    expect(cache.size).toBe(48);
    expect(cache.get(key({ query: 'search0' }))).toBeNull();
    expect(cache.get(key({ query: 'search1' }))).toBeNull();
    expect(cache.get(key({ query: 'search2' }))).not.toBeNull();
    expect(cache.get(key({ query: 'search49' }))).not.toBeNull();
  });

  it('holds a bounded number of listings, however few answers they came in', () => {
    const large = (count: number) => Array.from({ length: count }, () => listing('grants-gov:1'));
    cache.set(key({ query: 'first' }), large(9000), START);
    cache.set(key({ query: 'second' }), large(9000), START);
    expect(cache.size).toBe(2);
    cache.set(key({ query: 'third' }), large(9000), START);
    expect(cache.size).toBe(2);
    expect(cache.get(key({ query: 'first' }))).toBeNull();
    expect(cache.get(key({ query: 'second' }))).not.toBeNull();
    // An answer larger than the whole allowance is still remembered, alone.
    cache.set(key({ query: 'huge' }), large(30000), START);
    expect(cache.size).toBe(1);
    expect(cache.get(key({ query: 'huge' }))!.opportunities).toHaveLength(30000);
  });

  it('clears expired searches to make room before dropping fresh ones', () => {
    for (let index = 0; index < 48; index += 1) {
      cache.set(key({ query: `old${index}` }), [], START);
    }
    now = START + 20 * MINUTE;
    cache.set(key({ query: 'fresh' }), [listing('grants-gov:1')], now);
    expect(cache.size).toBe(1);
  });

  it('forgets everything when cleared', () => {
    cache.set(key(), [listing('grants-gov:1')], START);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get(key())).toBeNull();
  });
});

describe('cacheKey', () => {
  it('is the same for filters that mean the same search', () => {
    const one = filters({
      query: 'Youth  workforce-training',
      levels: ['federal', 'state'],
      place: { country: 'US', region: 'NJ', county: 'Essex', city: 'Newark' },
      applicantTypes: ['nonprofit', 'small_business'],
      categories: ['health', 'housing'],
      statuses: ['active', 'unverified'],
      sourceIds: ['grants-gov', 'ca-grants'],
    });
    const same = filters({
      query: '  training, WORKFORCE youth youth ',
      levels: ['state', 'federal', 'state'],
      place: { country: 'us', region: ' nj', county: 'ESSEX', city: 'newark ' },
      applicantTypes: ['small_business', 'nonprofit'],
      categories: ['housing', 'health'],
      statuses: ['unverified', 'active'],
      sourceIds: ['ca-grants', 'grants-gov'],
    });
    expect(cacheKey('grants-gov', same)).toBe(cacheKey('grants-gov', one));
    cache.set(cacheKey('grants-gov', one), [listing('grants-gov:1')], START);
    expect(cache.get(cacheKey('grants-gov', same))).not.toBeNull();
  });

  it.each<[string, Partial<OpportunityFilters>]>([
    ['query', { query: 'housing' }],
    ['levels', { levels: ['federal'] }],
    ['place', { place: { country: 'US', region: 'NJ', county: '', city: '' } }],
    ['applicantTypes', { applicantTypes: ['nonprofit'] }],
    ['categories', { categories: ['health'] }],
    ['kinds', { kinds: ['grant'] }],
    ['amountMin', { amountMin: 50000 }],
    ['amountMax', { amountMax: 50000 }],
    ['includeAmountNotStated', { includeAmountNotStated: false }],
    ['deadlineFrom', { deadlineFrom: '2026-11-01' }],
    ['deadlineTo', { deadlineTo: '2026-11-01' }],
    ['statuses', { statuses: ['active', 'expired'] }],
    ['sourceIds', { sourceIds: ['grants-gov'] }],
  ])('changes with %s, because a source may use any filter', (_name, patch) => {
    expect(cacheKey('grants-gov', filters(patch))).not.toBe(cacheKey('grants-gov', filters()));
  });

  it('leaves out the filters a source says it never reads', () => {
    const read = ['query', 'statuses'] as const;
    const base = cacheKey('grants-gov', filters({ query: 'housing' }), read);
    // The source's answer cannot depend on these, so one remembered answer serves them all.
    for (const patch of [
      { levels: ['state'] },
      { place: { country: 'US', region: 'NJ', county: 'Essex', city: 'Newark' } },
      { applicantTypes: ['nonprofit'] },
      { amountMin: 50000, amountMax: 90000, includeAmountNotStated: false },
      { deadlineTo: '2026-12-31' },
      { sourceIds: ['grants-gov'] },
    ] satisfies Partial<OpportunityFilters>[]) {
      expect(cacheKey('grants-gov', filters({ query: 'housing', ...patch }), read)).toBe(base);
    }
    expect(cacheKey('grants-gov', filters({ query: 'health' }), read)).not.toBe(base);
    expect(cacheKey('grants-gov', filters({ query: 'housing', statuses: [] }), read)).not.toBe(base);
    expect(cacheKey('ca-grants', filters({ query: 'housing' }), read)).not.toBe(base);
    // A source that reads nothing still has one answer of its own.
    expect(cacheKey('grants-gov', filters({ query: 'housing' }), [])).toBe(cacheKey('grants-gov', filters(), []));
  });

  it('knows every filter there is', () => {
    expect([...FILTER_NAMES].sort()).toEqual(Object.keys(DEFAULT_OPPORTUNITY_FILTERS).sort());
  });

  it('does not confuse a source id with the start of a search', () => {
    expect(cacheKey('a', filters({ query: 'bb cc' }))).not.toBe(cacheKey('a bb', filters({ query: 'cc' })));
    expect(cacheKey('grants-gov', filters({ amountMin: 5 }))).not.toBe(
      cacheKey('grants-gov', filters({ amountMax: 5 })),
    );
  });
});
