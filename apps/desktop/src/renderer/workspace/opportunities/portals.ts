// The logic behind the directory of official funding sites: what is chosen,
// what main is asked for, and how the entries are set out. An entry is a link
// to a site BulleBrowser does not read, so nothing here ever becomes a listing.

import {
  GEO_LEVEL_LABELS,
  type GeoLevel,
  type OfficialPortal,
  type OrgLocation,
} from '../../../shared/funding.js';
import { NOT_STATED, formatDate, pluralize } from '../../lib/funding-client.js';
import { US_REGIONS, countryName, type PlaceOption } from '../organization.js';
import { LEVELS } from './filters.js';

export type PortalLevel = GeoLevel | 'all';

/** What the person has chosen to see. An empty country or region means all of them. */
export interface PortalChoice {
  level: PortalLevel;
  country: string;
  region: string;
}

/** What `opportunities.portals` is asked for. */
export interface PortalQuery {
  level?: GeoLevel;
  country?: string;
  region?: string;
}

/** The directory starts from where the organization is, at every level. */
export function defaultPortalChoice(location: OrgLocation | null | undefined): PortalChoice {
  return {
    level: 'all',
    country: (location?.country ?? '').trim().toUpperCase(),
    region: (location?.region ?? '').trim(),
  };
}

export function sameChoice(a: PortalChoice, b: PortalChoice): boolean {
  return a.level === b.level && a.country === b.country && a.region === b.region;
}

/** A federal or international site is not tied to a state or region. */
export function regionApplies(level: PortalLevel): boolean {
  return level !== 'federal' && level !== 'international';
}

/** An international site is listed for every country. */
export function countryApplies(level: PortalLevel): boolean {
  return level !== 'international';
}

/**
 * The requests that together give what was chosen. Main matches each part of a
 * request exactly, and a national or international site has no region, so for
 * "all levels" in one state the sites of that state, the national sites of its
 * country and the international sites are asked for separately. That way the
 * directory shows every level for the organization's place, not only the
 * levels that happen to carry a region code.
 */
export function portalQueries(choice: PortalChoice): PortalQuery[] {
  const country = choice.country.trim();
  const region = choice.region.trim();
  const place: PortalQuery = { ...(country ? { country } : {}) };

  if (choice.level === 'international') return [{ level: 'international' }];
  if (choice.level === 'federal') return [{ level: 'federal', ...place }];
  if (choice.level !== 'all') {
    return [{ level: choice.level, ...place, ...(country && region ? { region } : {}) }];
  }
  if (!country) return [{}];
  if (!region) return [{ country }, { level: 'international' }];
  return [{ country, region }, { level: 'federal', country }, { level: 'international' }];
}

const LEVEL_RANK = new Map<GeoLevel, number>(LEVELS.map((level, index) => [level, index]));

/** Several answers as one list: each site once, nearest level first, main's order kept within a level. */
export function mergePortals(answers: readonly (readonly OfficialPortal[])[]): OfficialPortal[] {
  const seen = new Set<string>();
  const merged: OfficialPortal[] = [];
  for (const answer of answers) {
    for (const portal of answer) {
      if (seen.has(portal.id)) continue;
      seen.add(portal.id);
      merged.push(portal);
    }
  }
  // Array.prototype.sort is stable, so sites of one level stay in the order they arrived.
  return merged.sort(
    (a, b) => (LEVEL_RANK.get(a.level) ?? LEVELS.length) - (LEVEL_RANK.get(b.level) ?? LEVELS.length),
  );
}

export interface PortalGroup {
  level: GeoLevel;
  portals: OfficialPortal[];
}

/** Sites under their level, city first and international last, leaving out levels with none. */
export function groupByLevel(portals: readonly OfficialPortal[]): PortalGroup[] {
  return LEVELS.flatMap((level) => {
    const found = portals.filter((portal) => portal.level === level);
    return found.length > 0 ? [{ level, portals: found }] : [];
  });
}

// ─────────────────────────────── the choice lists ──────────────────────────────

const byName = (a: PlaceOption, b: PlaceOption) => a.name.localeCompare(b.name, 'en');

/** The countries the directory has sites for, by name, with any extra code kept as a choice. */
export function countryChoices(
  directory: readonly OfficialPortal[],
  alsoOffer = '',
): PlaceOption[] {
  const codes = new Set(directory.map((portal) => portal.country).filter(Boolean));
  if (alsoOffer) codes.add(alsoOffer);
  return [...codes].map((code) => ({ code, name: countryName(code) })).sort(byName);
}

/** What a region code stands for: a state's name where the app or the directory knows it. */
export function regionName(
  directory: readonly OfficialPortal[],
  country: string,
  code: string,
): string {
  if (country === 'US') {
    const state = US_REGIONS.find((entry) => entry.code === code);
    if (state) return state.name;
  }
  // A state-level site's jurisdiction is the name of its state, province or region.
  const named = directory.find(
    (portal) => portal.level === 'state' && portal.country === country && portal.region === code,
  );
  return named?.jurisdiction.trim() || code;
}

/** The states and regions of one country that the directory has sites for, by name. */
export function regionChoices(
  directory: readonly OfficialPortal[],
  country: string,
  alsoOffer = '',
): PlaceOption[] {
  if (!country) return [];
  const codes = new Set(
    directory
      .filter((portal) => portal.country === country && portal.region)
      .map((portal) => portal.region),
  );
  if (alsoOffer) codes.add(alsoOffer);
  return [...codes].map((code) => ({ code, name: regionName(directory, country, code) })).sort(byName);
}

/**
 * The directory's code for a region as an organization wrote it. Outside the
 * United States an organization types its region freely, so "Ontario" is
 * matched to "ON" by name; anything that matches nothing is kept as written.
 */
export function resolveRegion(
  directory: readonly OfficialPortal[],
  country: string,
  written: string,
): string {
  const wanted = written.trim().toLowerCase();
  if (!wanted || !country) return written.trim();
  const choices = regionChoices(directory, country);
  const match =
    choices.find((choice) => choice.code.toLowerCase() === wanted) ??
    choices.find((choice) => choice.name.toLowerCase() === wanted);
  return match?.code ?? written.trim();
}

// ──────────────────────────────────── words ───────────────────────────────────

export const PORTAL_LEVEL_LABELS: Record<PortalLevel, string> = {
  all: 'All levels',
  ...GEO_LEVEL_LABELS,
};

/** "Link checked Oct 6, 2026", from the date the address was last checked. */
export function checkedSentence(portal: Pick<OfficialPortal, 'checkedOn'>): string {
  const checked = formatDate(portal.checkedOn);
  return checked === NOT_STATED ? 'Link check date not stated' : `Link checked ${checked}`;
}

export function portalCountSentence(count: number): string {
  return count === 0
    ? 'No official sites are listed for this choice.'
    : `${pluralize(count, 'official site')} listed.`;
}

/**
 * Said when a state or region was chosen and the directory has no city,
 * county or state site for it, while national and international sites still
 * show: otherwise the list would look as if it covered the place.
 */
export function missingLocalSentence(placeName: string): string {
  return `The directory has no citywide, countywide or statewide site for ${placeName}.`;
}

/** True when a list has at least one site below the national level. */
export function hasLocalSites(portals: readonly OfficialPortal[]): boolean {
  return portals.some(
    (portal) => portal.level === 'city' || portal.level === 'county' || portal.level === 'state',
  );
}
