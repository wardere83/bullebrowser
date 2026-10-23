// The logic behind the search filters, kept apart from the form so it can be
// tested: what the form holds while someone is typing, the checks made before
// anything is sent to the official sources, and the short phrases that say
// what is chosen in a group that is folded away.

import {
  APPLICANT_TYPE_LABELS,
  DEFAULT_OPPORTUNITY_FILTERS,
  FUNDING_CATEGORY_LABELS,
  GEO_LEVEL_LABELS,
  OPPORTUNITY_KIND_LABELS,
  OPPORTUNITY_STATUS_LABELS,
  type ApplicantType,
  type FundingCategory,
  type GeoLevel,
  type OpportunityFilters,
  type OpportunityKind,
  type OpportunityStatus,
  type OrgLocation,
  type PlaceFilter,
} from '../../../shared/funding.js';
import { formatDate } from '../../lib/funding-client.js';
import { describeLocation } from '../organization.js';

// ─────────────────────────────────── choices ──────────────────────────────────

// Each list is in the order the contract's label table gives, which is the
// order the form shows and the order a chosen set is kept in.
export const LEVELS = Object.keys(GEO_LEVEL_LABELS) as GeoLevel[];
export const APPLICANT_TYPES = Object.keys(APPLICANT_TYPE_LABELS) as ApplicantType[];
export const CATEGORIES = Object.keys(FUNDING_CATEGORY_LABELS) as FundingCategory[];
export const KINDS = Object.keys(OPPORTUNITY_KIND_LABELS) as OpportunityKind[];
export const STATUSES = Object.keys(OPPORTUNITY_STATUS_LABELS) as OpportunityStatus[];

/** One line for each status, shown wherever a status is chosen or a group of listings is headed. */
export const STATUS_MEANINGS: Record<OpportunityStatus, string> = {
  active:
    'An official source reported it open with a deadline that has not passed, and BulleBrowser read that in this session.',
  expired: 'The source reports it closed, or its deadline has passed.',
  unverified:
    'BulleBrowser could not confirm it, for example a forecast, a missing deadline or a check that failed.',
};

/** What each kind of funding is. Some city and county sources list only the second. */
export const KIND_MEANINGS: Record<OpportunityKind, string> = {
  grant: 'Money awarded for a purpose, by competition or by formula.',
  contract_solicitation: 'A request for proposals or bids to deliver a service.',
};

/** The longest keyword entry and place name the sources are sent. */
export const MAX_QUERY_LENGTH = 200;
export const MAX_PLACE_LENGTH = 80;

// ──────────────────────────────────── draft ───────────────────────────────────

/** What the filter form holds. Amounts stay as typed until they are checked. */
export interface FilterDraft {
  query: string;
  levels: GeoLevel[];
  place: PlaceFilter;
  applicantTypes: ApplicantType[];
  categories: FundingCategory[];
  kinds: OpportunityKind[];
  amountMin: string;
  amountMax: string;
  includeAmountNotStated: boolean;
  /** An ISO date (YYYY-MM-DD), or empty for no bound. */
  deadlineFrom: string;
  deadlineTo: string;
  statuses: OpportunityStatus[];
  sourceIds: string[];
}

const asText = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The values of `chosen` that the form knows, once each, in the form's order. */
function known<T extends string>(chosen: unknown, order: readonly T[]): T[] {
  const values = Array.isArray(chosen) ? (chosen as unknown[]) : [];
  return order.filter((value) => values.includes(value));
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written YYYY-MM-DD. */
export function isIsoDate(value: unknown): boolean {
  const match = typeof value === 'string' ? ISO_DATE.exec(value) : null;
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** The place filter for an organization's location; every part empty when it has none. */
export function placeFromLocation(location: OrgLocation | null | undefined): PlaceFilter {
  return {
    country: asText(location?.country).trim(),
    region: asText(location?.region).trim(),
    county: asText(location?.county).trim(),
    city: asText(location?.city).trim(),
  };
}

export const EMPTY_PLACE: PlaceFilter = { country: '', region: '', county: '', city: '' };

export function isPlaceEmpty(place: PlaceFilter): boolean {
  return !place.country.trim() && !place.region.trim() && !place.county.trim() && !place.city.trim();
}

export function samePlace(a: PlaceFilter, b: PlaceFilter): boolean {
  const fold = (value: string) => value.trim().toLowerCase();
  return (
    fold(a.country) === fold(b.country) &&
    fold(a.region) === fold(b.region) &&
    fold(a.county) === fold(b.county) &&
    fold(a.city) === fold(b.city)
  );
}

/**
 * What the form shows for a set of filters. Anything the form does not know (a
 * level or a status it has no label for, an amount that is not a number) is
 * left out rather than shown as if it had been chosen: the filters can come
 * from a suggestion as well as from this form.
 */
export function draftFromFilters(filters: OpportunityFilters): FilterDraft {
  const amount = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? String(value) : '';
  return {
    query: asText(filters.query),
    levels: known(filters.levels, LEVELS),
    place: placeFromLocation(filters.place),
    applicantTypes: known(filters.applicantTypes, APPLICANT_TYPES),
    categories: known(filters.categories, CATEGORIES),
    kinds: known(filters.kinds, KINDS),
    amountMin: amount(filters.amountMin),
    amountMax: amount(filters.amountMax),
    includeAmountNotStated: filters.includeAmountNotStated !== false,
    deadlineFrom: isIsoDate(filters.deadlineFrom) ? asText(filters.deadlineFrom) : '',
    deadlineTo: isIsoDate(filters.deadlineTo) ? asText(filters.deadlineTo) : '',
    statuses: known(filters.statuses, STATUSES),
    sourceIds: [
      ...new Set(
        (Array.isArray(filters.sourceIds) ? filters.sourceIds : []).filter(
          (id): id is string => typeof id === 'string' && id !== '',
        ),
      ),
    ],
  };
}

/** The filters a search starts from: the contract's defaults with the organization's place. */
export function defaultDraft(location?: OrgLocation | null): FilterDraft {
  return draftFromFilters({
    ...DEFAULT_OPPORTUNITY_FILTERS,
    place: placeFromLocation(location),
  });
}

/**
 * The form after filters suggested from the approved profile are taken. A
 * suggestion says what the profile points to; it must not widen a search by
 * what it leaves empty. So an empty place keeps the place already chosen, and
 * an empty list of statuses keeps the statuses already chosen.
 */
export function applySuggestion(current: FilterDraft, suggested: OpportunityFilters): FilterDraft {
  const next = draftFromFilters(suggested);
  return {
    ...next,
    place: isPlaceEmpty(next.place) ? current.place : next.place,
    statuses: next.statuses.length > 0 ? next.statuses : current.statuses,
  };
}

/** The reasons that came with suggested filters, as sentences worth showing. */
export function readBasis(basis: unknown): string[] {
  if (!Array.isArray(basis)) return [];
  const lines = (basis as unknown[])
    .filter((line): line is string => typeof line === 'string')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return [...new Set(lines)];
}

/** `chosen` with `value` added or removed, kept in the form's order. */
export function withChoice<T extends string>(
  chosen: readonly T[],
  value: T,
  on: boolean,
  order: readonly T[],
): T[] {
  const next = new Set(chosen);
  if (on) next.add(value);
  else next.delete(value);
  // A value the order does not list (a source that is no longer offered) is
  // dropped the next time the set changes.
  return order.filter((item) => next.has(item));
}

// ─────────────────────────────────── checking ─────────────────────────────────

export type AmountReading = { ok: true; value: number | null } | { ok: false };

const AMOUNT = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/;

/**
 * An amount as typed: "25000", "25,000", "$25,000.50". Empty means no bound.
 * Anything else, a negative number included, is not an amount.
 */
export function parseAmount(typed: string): AmountReading {
  const compact = typed.replace(/\s+/g, '').replace(/^[$€£¥]/u, '');
  if (!compact) return typed.trim() ? { ok: false } : { ok: true, value: null };
  if (!AMOUNT.test(compact)) return { ok: false };
  const value = Number(compact.replace(/,/g, ''));
  return Number.isFinite(value) && value <= Number.MAX_SAFE_INTEGER
    ? { ok: true, value }
    : { ok: false };
}

/** The controls a check can point at, in the order they come in the form. */
export const CHECKED_FIELDS = [
  'statuses',
  'amountMin',
  'amountMax',
  'deadlineFrom',
  'deadlineTo',
] as const;

export type CheckedField = (typeof CHECKED_FIELDS)[number];
export type FilterErrors = Partial<Record<CheckedField, string>>;

export const AMOUNT_HELP = 'Enter an amount in digits, for example 25000, or leave it empty.';
export const DATE_HELP = 'Choose a full date, or clear this field.';
export const AMOUNTS_REVERSED =
  'The smallest amount is larger than the largest. Swap them or clear one.';
export const DATES_REVERSED = 'The deadline range ends before it starts. Swap the dates or clear one.';
export const NO_STATUS = 'Choose at least one status.';

export type DraftReading =
  | { ok: true; filters: OpportunityFilters }
  | { ok: false; errors: FilterErrors };

const tidy = (value: string, max: number) => value.replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Checks what the form holds. Returns the filters to send, or what is wrong
 * with each control in words that say how to fix it. Main checks again and has
 * the final say; this saves a round trip for what can be seen from the form.
 *
 * A status must be chosen. An empty list would mean "every status" to the
 * sources, and a search must never widen to expired and unverified listings
 * without the person having asked for them.
 */
export function readDraft(draft: FilterDraft): DraftReading {
  const errors: FilterErrors = {};

  if (draft.statuses.length === 0) errors.statuses = NO_STATUS;

  const min = parseAmount(draft.amountMin);
  const max = parseAmount(draft.amountMax);
  if (!min.ok) errors.amountMin = AMOUNT_HELP;
  if (!max.ok) errors.amountMax = AMOUNT_HELP;
  const amountMin = min.ok ? min.value : null;
  const amountMax = max.ok ? max.value : null;
  if (min.ok && max.ok && amountMin !== null && amountMax !== null && amountMin > amountMax) {
    errors.amountMin = AMOUNTS_REVERSED;
  }

  const from = draft.deadlineFrom.trim();
  const to = draft.deadlineTo.trim();
  if (from && !isIsoDate(from)) errors.deadlineFrom = DATE_HELP;
  if (to && !isIsoDate(to)) errors.deadlineTo = DATE_HELP;
  // ISO dates sort as text.
  if (!errors.deadlineFrom && !errors.deadlineTo && from && to && from > to) {
    errors.deadlineTo = DATES_REVERSED;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    filters: {
      query: tidy(draft.query, MAX_QUERY_LENGTH),
      levels: known(draft.levels, LEVELS),
      place: {
        country: tidy(draft.place.country, MAX_PLACE_LENGTH),
        region: tidy(draft.place.region, MAX_PLACE_LENGTH),
        county: tidy(draft.place.county, MAX_PLACE_LENGTH),
        city: tidy(draft.place.city, MAX_PLACE_LENGTH),
      },
      applicantTypes: known(draft.applicantTypes, APPLICANT_TYPES),
      categories: known(draft.categories, CATEGORIES),
      kinds: known(draft.kinds, KINDS),
      amountMin,
      amountMax,
      includeAmountNotStated: draft.includeAmountNotStated,
      deadlineFrom: from || null,
      deadlineTo: to || null,
      statuses: known(draft.statuses, STATUSES),
      sourceIds: [...new Set(draft.sourceIds)],
    },
  };
}

/** The first control with something wrong, in the order of the form. */
export function firstError(errors: FilterErrors): CheckedField | null {
  return CHECKED_FIELDS.find((field) => errors[field]) ?? null;
}

/** True when two sets of filters ask the sources for the same thing. */
export function sameFilters(a: OpportunityFilters, b: OpportunityFilters): boolean {
  const canonical = (filters: OpportunityFilters) =>
    JSON.stringify([
      filters.query.replace(/\s+/g, ' ').trim().toLowerCase(),
      [...filters.levels].sort(),
      [filters.place.country, filters.place.region, filters.place.county, filters.place.city].map(
        (part) => part.trim().toLowerCase(),
      ),
      [...filters.applicantTypes].sort(),
      [...filters.categories].sort(),
      [...filters.kinds].sort(),
      filters.amountMin,
      filters.amountMax,
      filters.includeAmountNotStated,
      filters.deadlineFrom || null,
      filters.deadlineTo || null,
      [...filters.statuses].sort(),
      [...new Set(filters.sourceIds)].sort(),
    ]);
  return canonical(a) === canonical(b);
}

// ─────────────────────────── what a folded group says ──────────────────────────

/** Up to two chosen labels by name, a count beyond that, or `whenNone`. */
export function summarizeChoice<T extends string>(
  chosen: readonly T[],
  labels: Record<T, string>,
  whenNone: string,
): string {
  if (chosen.length === 0) return whenNone;
  if (chosen.length <= 2) return chosen.map((value) => labels[value] ?? value).join(', ');
  return `${chosen.length} chosen`;
}

export function summarizePlace(place: PlaceFilter): string {
  return describeLocation(place) || 'Any place';
}

const plainNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

export function summarizeAmount(
  draft: Pick<FilterDraft, 'amountMin' | 'amountMax' | 'includeAmountNotStated'>,
): string {
  const show = (typed: string) => {
    const reading = parseAmount(typed);
    return reading.ok && reading.value !== null ? plainNumber.format(reading.value) : typed.trim();
  };
  const min = show(draft.amountMin);
  const max = show(draft.amountMax);
  if (!min && !max) {
    return draft.includeAmountNotStated ? 'Any amount' : 'Only listings that state an amount';
  }
  const range = min && max ? `${min} to ${max}` : min ? `At least ${min}` : `At most ${max}`;
  return draft.includeAmountNotStated ? range : `${range}, stated amounts only`;
}

export function summarizeDeadline(draft: Pick<FilterDraft, 'deadlineFrom' | 'deadlineTo'>): string {
  const show = (value: string) => (isIsoDate(value) ? formatDate(value) : value.trim());
  const from = show(draft.deadlineFrom);
  const to = show(draft.deadlineTo);
  if (!from && !to) return 'Any date';
  if (from && to) return `${from} to ${to}`;
  return from ? `From ${from}` : `Until ${to}`;
}

export function summarizeSources(chosen: number): string {
  if (chosen === 0) return 'Every source that covers your choices';
  return chosen === 1 ? '1 source chosen' : `${chosen} sources chosen`;
}
