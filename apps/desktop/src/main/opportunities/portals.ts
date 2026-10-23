// The directory of official funding portals: the human-facing pages of the
// bodies that publish funding, for the places and funders the app cannot
// search itself. An entry is shown as a link and never as a listing: it says
// where to look, not that anything is open.
//
// Each address was checked on the date it carries. `reachable: false` means
// the site turned an automated check away, which most often is a site that
// only answers a real browser, so those entries are kept.

import type { GeoLevel, OfficialPortal } from '../../shared/funding.js';

// The data file is read through the bundler's file matcher, which builds it
// into the app like any import. A plain import would do the same, but the
// TypeScript project for this process does not list data files and refuses one.
const files = import.meta.glob('./data/official-portals.json', { eager: true, import: 'default' });
const directory: unknown = Object.values(files)[0];

export interface PortalFilter {
  level?: GeoLevel;
  /** ISO 3166-1 alpha-2. */
  country?: string;
  /** State, province or region code, e.g. "CA". */
  region?: string;
}

/** Nearest first: an organization looks to its own city before the wider world. */
const LEVEL_ORDER: readonly GeoLevel[] = ['city', 'county', 'state', 'federal', 'international'];

const fold = (value: string): string => value.normalize('NFKC').trim().toLowerCase();
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/** True for an entry that is complete enough to show. */
function isPortal(value: unknown): value is OfficialPortal {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    isText(entry.id) &&
    isText(entry.name) &&
    isText(entry.operator) &&
    isText(entry.jurisdiction) &&
    LEVEL_ORDER.includes(entry.level as GeoLevel) &&
    typeof entry.country === 'string' &&
    /^(?:[A-Z]{2})?$/.test(entry.country) &&
    typeof entry.region === 'string' &&
    isText(entry.url) &&
    entry.url.startsWith('https://') &&
    isText(entry.checkedOn) &&
    typeof entry.reachable === 'boolean' &&
    typeof entry.notes === 'string'
  );
}

const compare = (a: string, b: string): number => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true });

const inOrder = (a: OfficialPortal, b: OfficialPortal): number =>
  LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level) ||
  compare(a.jurisdiction, b.jurisdiction) ||
  compare(a.name, b.name) ||
  compare(a.id, b.id);

// An entry that is not complete is left out rather than shown half-filled; the
// tests fail if the data file ever holds one.
const PORTALS: readonly OfficialPortal[] = (Array.isArray(directory) ? directory : []).filter(isPortal).sort(inOrder);

/** A filter value, or '' when none was given: an empty value does not narrow the list. */
const wanted = (value: unknown): string => (typeof value === 'string' ? fold(value) : '');

/**
 * The portals for a level, a country and a region, each of them optional,
 * compared without regard to case. Sorted by level (city first, international
 * last), then jurisdiction, then name.
 */
export function listPortals(filter: PortalFilter = {}): OfficialPortal[] {
  const level = wanted(filter?.level);
  const country = wanted(filter?.country);
  const region = wanted(filter?.region);
  return PORTALS.filter(
    (portal) =>
      (!level || portal.level === level) &&
      (!country || fold(portal.country) === country) &&
      (!region || fold(portal.region) === region),
  ).map((portal) => ({ ...portal }));
}
