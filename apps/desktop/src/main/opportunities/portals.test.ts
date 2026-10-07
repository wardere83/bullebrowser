import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GEO_LEVEL_LABELS, type GeoLevel, type OfficialPortal } from '../../shared/funding.js';
import { listPortals } from './portals.js';

/** The data file as it is on disk, to compare with what the directory shows. */
const directory: unknown = JSON.parse(readFileSync(new URL('./data/official-portals.json', import.meta.url), 'utf8'));
const ALL = listPortals();
const LEVELS = Object.keys(GEO_LEVEL_LABELS);
const hostOf = (portal: OfficialPortal) => new URL(portal.url).hostname.toLowerCase();

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY',
  'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND',
  'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
];

/**
 * Places with no state-level entry, and why. The District of Columbia has no
 * state government apart from the city's, so its portals are listed at city
 * level.
 */
const NO_STATE_LEVEL_ENTRY: Record<string, string> = {
  DC: 'The District is a single government; its portals are listed at city level.',
};

// Sites the research turned down because they are not the body that publishes
// the funding: commercial grant and bid databases, sector aggregators, data
// repackagers and wrappers around official portals.
const NOT_OFFICIAL_DOMAINS = [
  'grantwatch.com',
  'instrumentl.com',
  'candid.org',
  'foundationcenter.org',
  'guidestar.org',
  'opengrants.io',
  'grantedai.com',
  'zeffy.com',
  'grantable.co',
  'starbridge.ai',
  'thegrantportal.com',
  'grantstation.com',
  'grantforward.com',
  'proquest.com',
  'bidnet.com',
  'bidnetdirect.com',
  'demandstar.com',
  'govspend.com',
  'bidprime.com',
  'govtribe.com',
  'highergov.com',
  'govwin.com',
  'causeiq.com',
  'charitynavigator.org',
  'grantmakers.io',
  'propublica.org',
  'devex.com',
  'fundsforngos.org',
  'developmentaid.org',
  'grantfinder.co.uk',
  'grantsonline.org.uk',
  'grantguru.com',
  'dgmarket.com',
  'tendersinfo.com',
  'tendios.com',
  'funding.scot',
  'funding.cymru',
  'grant-tracker.org',
  'wheel.ie',
  'generosity.org.nz',
  'apify.com',
  'emdesk.com',
  'socrata.com',
];
/** The same, for names whose address the research did not record. */
const NOT_OFFICIAL_NAMES = ['grantsights', 'fundinglandscape', 'nationgraph', 'grantwatch', 'instrumentl', 'grantguru'];

describe('the directory of official portals', () => {
  it('shows every entry in the data file, so none is silently left out', () => {
    expect(Array.isArray(directory)).toBe(true);
    expect(ALL).toHaveLength((directory as unknown[]).length);
    expect(ALL.length).toBeGreaterThan(240);
  });

  it('gives every entry an id, a name, an operator, a place, a level and a secure address', () => {
    for (const portal of ALL) {
      expect(portal.id, portal.url).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(portal.id.length, portal.id).toBeLessThanOrEqual(90);
      for (const field of [portal.name, portal.operator, portal.jurisdiction]) {
        expect(field.trim(), portal.id).not.toBe('');
        expect(field, portal.id).toBe(field.trim());
      }
      expect(LEVELS, portal.id).toContain(portal.level);
      expect(portal.country, portal.id).toMatch(/^(?:[A-Z]{2})?$/);
      expect(portal.region, portal.id).toMatch(/^(?:[A-Z]{2,3})?$/);
      const url = new URL(portal.url);
      expect(url.protocol, portal.id).toBe('https:');
      expect(url.username + url.password, portal.id).toBe('');
      expect(portal.checkedOn, portal.id).toBe('2026-10-06');
      expect(typeof portal.reachable, portal.id).toBe('boolean');
    }
  });

  it('never repeats an id or an address', () => {
    expect(new Set(ALL.map((portal) => portal.id)).size).toBe(ALL.length);
    const addresses = ALL.map((portal) => portal.url.toLowerCase().replace(/\/+$/, ''));
    expect(new Set(addresses).size).toBe(ALL.length);
  });

  it('describes each entry in one plain sentence, without the evidence of the check', () => {
    for (const portal of ALL) {
      expect(portal.notes.length, portal.id).toBeGreaterThan(10);
      expect(portal.notes.length, portal.id).toBeLessThanOrEqual(200);
      expect(portal.notes, portal.id).toMatch(/[.!]$/);
      // One sentence: no full stop followed by another capitalised sentence.
      expect(portal.notes.slice(0, -1), portal.id).not.toMatch(/[.!?]\s+\p{Lu}/u);
      expect(portal.notes, portal.id).not.toMatch(/https?:|HTTP|\bcurl\b|\b[1-5]\d\d\b status|User-Agent|\bAPI\b|\bJSON\b|\bHTML\b/);
    }
  });

  it('keeps a site that turned the automated check away, and says so', () => {
    const turnedAway = ALL.filter((portal) => !portal.reachable);
    expect(turnedAway.length).toBeGreaterThan(20);
    expect(turnedAway.length).toBeLessThan(ALL.length / 5);
    for (const portal of turnedAway) {
      expect(portal.notes, portal.id).toMatch(/automated check/);
    }
    expect(turnedAway.map((portal) => portal.id)).toContain('us-mn-mn-grants');
  });

  it('uses a country code for a single country and none for a body that belongs to several', () => {
    const noCountry = ALL.filter((portal) => portal.country === '');
    expect(noCountry.length).toBeGreaterThan(0);
    // A body of many countries has no country, no region, and is international.
    for (const portal of noCountry) {
      expect(portal.level, portal.id).toBe('international');
      expect(portal.region, portal.id).toBe('');
    }
    // Another country's national sources are federal, under that country's code.
    expect(listPortals({ level: 'federal', country: 'GB' }).map((portal) => portal.id)).toContain('gb-find-a-grant');
    expect(listPortals({ level: 'federal', country: 'AU' }).map((portal) => portal.id)).toContain('au-grantconnect');
    // A state, province or nation within a country carries its region code.
    for (const portal of ALL.filter((entry) => entry.level === 'state')) {
      expect(portal.region, portal.id).not.toBe('');
    }
    for (const portal of ALL.filter((entry) => entry.level === 'federal' || entry.level === 'international')) {
      expect(portal.region, portal.id).toBe('');
    }
    expect(ALL.find((portal) => portal.id === 'ca-on-ontario-trillium-foundation-grants')).toMatchObject({
      level: 'state',
      country: 'CA',
      region: 'ON',
      jurisdiction: 'Ontario',
    });
  });

  it('has a state-level entry for every US state, or a stated reason why not', () => {
    const covered = new Set(
      ALL.filter((portal) => portal.country === 'US' && portal.level === 'state').map((portal) => portal.region),
    );
    expect(US_STATES).toHaveLength(50);
    for (const state of [...US_STATES, 'DC']) {
      expect(covered.has(state) || Object.hasOwn(NO_STATE_LEVEL_ENTRY, state), state).toBe(true);
    }
    // Every exception is real, and still has somewhere to look.
    for (const place of Object.keys(NO_STATE_LEVEL_ENTRY)) {
      expect(covered.has(place), place).toBe(false);
      expect(listPortals({ country: 'US', region: place }).length, place).toBeGreaterThan(0);
    }
    // No entry claims a state that does not exist.
    for (const region of covered) expect(US_STATES, region).toContain(region);
  });

  it('holds no commercial aggregator, bid database or wrapper around an official site', () => {
    for (const portal of ALL) {
      const host = hostOf(portal);
      for (const domain of NOT_OFFICIAL_DOMAINS) {
        expect(host === domain || host.endsWith(`.${domain}`), `${portal.id} is on ${domain}`).toBe(false);
      }
      for (const name of NOT_OFFICIAL_NAMES) {
        expect(host.includes(name), `${portal.id} is on a ${name} site`).toBe(false);
      }
    }
    // The one entry the research could not tie to its publishing body was dropped.
    expect(ALL.map(hostOf)).not.toContain('www.essexcountynjprocure.org');
  });
});

describe('listing portals', () => {
  it('sorts by level from city to international, then by place, then by name', () => {
    const order = (portal: OfficialPortal) => LEVELS.indexOf(portal.level);
    expect(LEVELS).toEqual(['city', 'county', 'state', 'federal', 'international']);
    for (let at = 1; at < ALL.length; at += 1) {
      const before = ALL[at - 1]!;
      const after = ALL[at]!;
      expect(order(before), after.id).toBeLessThanOrEqual(order(after));
      if (before.level !== after.level) continue;
      const places = before.jurisdiction.localeCompare(after.jurisdiction, 'en', { sensitivity: 'base', numeric: true });
      expect(places, after.id).toBeLessThanOrEqual(0);
      if (places === 0) {
        const names = before.name.localeCompare(after.name, 'en', { sensitivity: 'base', numeric: true });
        expect(names, after.id).toBeLessThanOrEqual(0);
      }
    }
    expect(ALL[0]!.level).toBe('city');
    expect(ALL[ALL.length - 1]!.level).toBe('international');
  });

  it('filters by level, country and region, alone or together', () => {
    const california = listPortals({ country: 'US', region: 'CA' });
    expect(california.length).toBeGreaterThan(5);
    expect(california.every((portal) => portal.country === 'US' && portal.region === 'CA')).toBe(true);
    // City, county and state entries for the same state come back together, nearest first.
    expect([...new Set(california.map((portal) => portal.level))]).toEqual(['city', 'county', 'state']);

    expect(listPortals({ level: 'state', country: 'US', region: 'CA' }).map((portal) => portal.id)).toEqual([
      'us-ca-california-grants-portal',
    ]);
    expect(listPortals({ level: 'county', region: 'MD' }).map((portal) => portal.jurisdiction)).toEqual(['Montgomery County']);

    const federal = listPortals({ level: 'federal', country: 'US' });
    expect(federal.length).toBeGreaterThan(50);
    expect(federal.map((portal) => portal.id)).toContain('us-grants-gov-search-grants');
    expect(federal.every((portal) => portal.level === 'federal' && portal.country === 'US')).toBe(true);

    for (const level of LEVELS as GeoLevel[]) {
      const some = listPortals({ level });
      expect(some.length, level).toBeGreaterThan(0);
      expect(some.every((portal) => portal.level === level), level).toBe(true);
    }
    expect(LEVELS.reduce((sum, level) => sum + listPortals({ level: level as GeoLevel }).length, 0)).toBe(ALL.length);
  });

  it('compares without regard to case or stray spaces', () => {
    const expected = listPortals({ level: 'state', country: 'US', region: 'NY' });
    expect(expected.length).toBeGreaterThan(0);
    expect(listPortals({ level: 'STATE' as GeoLevel, country: 'us', region: ' ny ' })).toEqual(expected);
    expect(listPortals({ country: 'gb', region: 'sct' }).every((portal) => portal.jurisdiction === 'Scotland')).toBe(true);
  });

  it('treats an empty or missing value as no restriction, and an unknown one as no match', () => {
    expect(listPortals({})).toEqual(ALL);
    expect(listPortals({ level: undefined, country: '', region: '  ' })).toEqual(ALL);
    expect(listPortals({ country: 'ZZ' })).toEqual([]);
    expect(listPortals({ level: 'planet' as GeoLevel })).toEqual([]);
    expect(listPortals({ country: 'US', region: 'ON' })).toEqual([]);
    // Values that are not text, as a careless caller might send them.
    expect(listPortals({ country: 42 as unknown as string, region: null as unknown as string })).toEqual(ALL);
    expect(listPortals(null as unknown as undefined)).toEqual(ALL);
  });

  it('hands out copies, so a caller cannot change the directory', () => {
    const first = listPortals({ level: 'state', country: 'US', region: 'CA' })[0]!;
    first.name = 'Changed';
    first.reachable = false;
    expect(listPortals({ level: 'state', country: 'US', region: 'CA' })[0]).toMatchObject({
      name: 'California Grants Portal',
      reachable: true,
    });
  });
});
