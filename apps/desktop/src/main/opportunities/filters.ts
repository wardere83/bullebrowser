// Filtering on the device. Every filter is applied here to every listing,
// whatever its source already did with it, so a source that ignores a filter
// can never leak a listing that does not match.
//
// What each filter means (an empty list, an empty string or a null bound means
// "no restriction"):
//
//   levels          The listing's level as this organization sees it (see
//                   effectiveLevel) must be one of the chosen levels.
//   place           Narrows only listings at the tier it names. A region
//                   narrows state listings, and the county and city listings
//                   that sit inside some region; a county narrows county
//                   listings; a city narrows city listings. Codes and names
//                   are compared without regard to case, and the country only
//                   tells apart regions that share a code. A federal or
//                   multi-country listing is never removed by a place, and
//                   neither is a listing whose place cannot be compared.
//   applicantTypes  A listing that states who may apply must share at least one
//   categories      type with the filter, and likewise for categories. A
//                   listing that states none is kept: the app must not hide a
//                   listing on a guess, and the interface labels it "not stated".
//   kinds, sourceIds, statuses
//                   Plain membership. Statuses are compared as given, so the
//                   caller refreshes them first (status.ts, refreshStatus).
//   amount          The listing's stated range must overlap [amountMin,
//                   amountMax]. The range runs from its floor to its ceiling,
//                   or to the total available when it gives no ceiling. A
//                   listing that states no amount at all is kept only when
//                   includeAmountNotStated is set.
//   deadline        closeDate must fall within [deadlineFrom, deadlineTo]. Once
//                   either bound is set, a listing with no closeDate is removed.
//   query           Every term of the search entry must occur in the title,
//                   summary, funder or reference number.

import {
  APPLICANT_TYPE_LABELS,
  DEFAULT_OPPORTUNITY_FILTERS,
  FUNDING_CATEGORY_LABELS,
  GEO_LEVEL_LABELS,
  OPPORTUNITY_KIND_LABELS,
  OPPORTUNITY_STATUS_LABELS,
  type FundingSourceInfo,
  type GeoLevel,
  type Opportunity,
  type OpportunityFilters,
  type PlaceFilter,
} from '../../shared/funding.js';
import { FundingError } from '../funding/errors.js';
import { queryTerms } from './normalize.js';
import { normalizeIsoDate } from './status.js';

/** Where the organization doing the search is. */
export interface OrganizationPlace {
  country: string;
  region: string;
  county: string;
  city: string;
}

const fold = (value: string): string => value.normalize('NFKC').trim().toLowerCase();

/**
 * A funder's tier as an organization in `organizationCountry` sees it: anything
 * from another country, or from a body that belongs to no single country, is
 * international. An organization that has not said where it is cannot be told
 * what is foreign to it, so the tier is then left as the funder states it.
 */
export function levelFrom(level: GeoLevel, country: string, organizationCountry: string): GeoLevel {
  const theirs = fold(country);
  const ours = fold(organizationCountry);
  if (!theirs) return 'international';
  if (ours && ours !== theirs) return 'international';
  return level;
}

export function effectiveLevel(opportunity: Opportunity, organizationCountry: string): GeoLevel {
  return levelFrom(opportunity.level, opportunity.country, organizationCountry);
}

/** The ground a listing or a source covers, in the terms a place filter uses. */
interface Footprint {
  level: GeoLevel;
  country: string;
  region: string;
  /** The region's name, when it is known as well as its code. */
  regionName: string;
  county: string;
  city: string;
}

// A listing names only the place at its own tier, in `jurisdiction`.
const footprintOf = (opportunity: Opportunity): Footprint => ({
  level: opportunity.level,
  country: opportunity.country,
  region: opportunity.region,
  regionName: opportunity.level === 'state' ? opportunity.jurisdiction : '',
  county: opportunity.level === 'county' ? opportunity.jurisdiction : '',
  city: opportunity.level === 'city' ? opportunity.jurisdiction : '',
});

const PLACE_WORDS = new Set([
  'the',
  'of',
  'and',
  'city',
  'county',
  'parish',
  'borough',
  'town',
  'township',
  'village',
  'municipality',
  'state',
  'province',
  'commonwealth',
  'territory',
]);

/** A place name reduced to what identifies it: "County of Essex" and "Essex County, NJ" are the same. */
function placeKey(name: string): string {
  const words = fold(name.split(',')[0] ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const telling = words.filter((word) => !PLACE_WORDS.has(word));
  return (telling.length > 0 ? telling : words).join(' ');
}

const differentPlace = (wanted: string, stated: string): boolean => {
  const want = placeKey(wanted);
  const have = placeKey(stated);
  return Boolean(want && have && want !== have);
};

/**
 * True only when the region asked for is clearly not the one stated. A code is
 * compared with a code and a name with a name; "NJ" against "New Jersey" cannot
 * be settled here, and an unsettled comparison never removes anything.
 */
function differentRegion(wanted: string, stated: string[]): boolean {
  const want = placeKey(wanted);
  const have = stated.map(placeKey).filter(Boolean);
  if (!want || have.length === 0 || have.includes(want)) return false;
  const isCode = (key: string) => key.length <= 3;
  return have.some((key) => isCode(key) === isCode(want));
}

function outsidePlace(footprint: Footprint, place: PlaceFilter): boolean {
  if (footprint.level === 'federal' || footprint.level === 'international') return false;
  const wantedCountry = fold(place.country);
  const country = fold(footprint.country);
  if (wantedCountry && country && wantedCountry !== country) return true;
  if (differentRegion(place.region, [footprint.region, footprint.regionName])) return true;
  return differentPlace(place.county, footprint.county) || differentPlace(place.city, footprint.city);
}

/** True when a source only covers somewhere other than the place asked for. */
export function sourceOutsidePlace(info: FundingSourceInfo, place: PlaceFilter): boolean {
  return outsidePlace(
    {
      level: info.level,
      country: info.coverage.country,
      region: info.coverage.region,
      regionName: info.level === 'state' ? info.jurisdiction : '',
      county: info.coverage.county,
      city: info.coverage.city,
    },
    place,
  );
}

const shares = <T>(stated: readonly T[], wanted: readonly T[]): boolean =>
  wanted.length === 0 || stated.length === 0 || stated.some((value) => wanted.includes(value));

function amountAllows(opportunity: Opportunity, filters: OpportunityFilters): boolean {
  const floor = opportunity.awardFloor;
  // No single award can be larger than everything there is to award.
  const ceiling = opportunity.awardCeiling ?? opportunity.totalFunding;
  if (floor === null && ceiling === null) return filters.includeAmountNotStated;
  const low = Math.min(floor ?? 0, ceiling ?? Infinity);
  const high = Math.max(floor ?? 0, ceiling ?? Infinity);
  return (
    (filters.amountMax === null || low <= filters.amountMax) &&
    (filters.amountMin === null || high >= filters.amountMin)
  );
}

function deadlineAllows(closeDate: string | null, from: string | null, to: string | null): boolean {
  if (!from && !to) return true;
  const date = normalizeIsoDate(closeDate);
  if (!date) return false;
  return (!from || date >= from) && (!to || date <= to);
}

export function applyFilters(
  opportunities: Opportunity[],
  filters: OpportunityFilters,
  organization: OrganizationPlace,
): Opportunity[] {
  const terms = queryTerms(filters.query);
  const from = normalizeIsoDate(filters.deadlineFrom);
  const to = normalizeIsoDate(filters.deadlineTo);

  return opportunities.filter((opportunity) => {
    if (filters.levels.length > 0 && !filters.levels.includes(effectiveLevel(opportunity, organization.country))) {
      return false;
    }
    if (outsidePlace(footprintOf(opportunity), filters.place)) return false;
    if (!shares(opportunity.applicantTypes, filters.applicantTypes)) return false;
    if (!shares(opportunity.categories, filters.categories)) return false;
    if (filters.kinds.length > 0 && !filters.kinds.includes(opportunity.kind)) return false;
    if (filters.sourceIds.length > 0 && !filters.sourceIds.includes(opportunity.sourceId)) return false;
    if (filters.statuses.length > 0 && !filters.statuses.includes(opportunity.status)) return false;
    if (!amountAllows(opportunity, filters)) return false;
    if (!deadlineAllows(opportunity.closeDate, from, to)) return false;
    if (terms.length === 0) return true;
    const text = fold(`${opportunity.title} ${opportunity.summary} ${opportunity.funder} ${opportunity.number}`);
    return terms.every((term) => text.includes(term));
  });
}

const MAX_QUERY_LENGTH = 200;
const MAX_PLACE_LENGTH = 80;
const MAX_SOURCE_IDS = 50;
/**
 * What a source id may look like: the shape the saved-listings store accepts
 * before the colon of a listing id. The service holds its sources to it.
 */
export const SOURCE_ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/i;

const invalid = (message = 'Those search filters are not valid.') => new FundingError('INVALID_INPUT', message);

function text(value: unknown, max: number): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw invalid();
  return value
    .normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function members<T extends string>(value: unknown, known: Record<T, string>, fallback: readonly T[]): T[] {
  if (value === undefined || value === null) return [...fallback];
  if (!Array.isArray(value)) throw invalid();
  const isKnown = (item: unknown): item is T => typeof item === 'string' && Object.hasOwn(known, item);
  if (!value.every(isKnown)) throw invalid();
  return [...new Set(value)];
}

function amount(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw invalid('An award amount must be a number of zero or more.');
  }
  return value;
}

function date(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const iso = typeof value === 'string' ? normalizeIsoDate(value) : null;
  if (!iso) throw invalid('A deadline date could not be read. Choose the date again.');
  return iso;
}

function sourceIds(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_SOURCE_IDS) throw invalid();
  const isId = (item: unknown): item is string => typeof item === 'string' && SOURCE_ID_RE.test(item);
  if (!value.every(isId)) throw invalid();
  return [...new Set(value)];
}

/**
 * Filters as the contract defines them, from whatever arrived from the
 * interface. A field that is left out takes its default; one that is present
 * but wrong is refused rather than dropped, because silently dropping "active
 * only" would widen a search to listings the person asked not to see.
 */
export function readFilters(input: unknown): OpportunityFilters {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw invalid();
  const raw = input as Record<string, unknown>;
  const rawPlace = raw.place ?? {};
  if (typeof rawPlace !== 'object' || Array.isArray(rawPlace)) throw invalid();
  const place = rawPlace as Record<string, unknown>;
  const defaults = DEFAULT_OPPORTUNITY_FILTERS;
  if (raw.includeAmountNotStated !== undefined && typeof raw.includeAmountNotStated !== 'boolean') {
    throw invalid();
  }

  const filters: OpportunityFilters = {
    query: text(raw.query, MAX_QUERY_LENGTH),
    levels: members(raw.levels, GEO_LEVEL_LABELS, defaults.levels),
    place: {
      country: text(place.country, MAX_PLACE_LENGTH),
      region: text(place.region, MAX_PLACE_LENGTH),
      county: text(place.county, MAX_PLACE_LENGTH),
      city: text(place.city, MAX_PLACE_LENGTH),
    },
    applicantTypes: members(raw.applicantTypes, APPLICANT_TYPE_LABELS, defaults.applicantTypes),
    categories: members(raw.categories, FUNDING_CATEGORY_LABELS, defaults.categories),
    kinds: members(raw.kinds, OPPORTUNITY_KIND_LABELS, defaults.kinds),
    amountMin: amount(raw.amountMin),
    amountMax: amount(raw.amountMax),
    includeAmountNotStated: raw.includeAmountNotStated ?? defaults.includeAmountNotStated,
    deadlineFrom: date(raw.deadlineFrom),
    deadlineTo: date(raw.deadlineTo),
    statuses: members(raw.statuses, OPPORTUNITY_STATUS_LABELS, defaults.statuses),
    sourceIds: sourceIds(raw.sourceIds),
  };

  if (filters.amountMin !== null && filters.amountMax !== null && filters.amountMin > filters.amountMax) {
    throw invalid('The smallest award amount is larger than the largest. Swap them or clear one.');
  }
  if (filters.deadlineFrom && filters.deadlineTo && filters.deadlineFrom > filters.deadlineTo) {
    throw invalid('The deadline range ends before it starts. Swap the dates or clear one.');
  }
  return filters;
}
