import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPPORTUNITY_FILTERS,
  type FundingSourceInfo,
  type Opportunity,
  type OpportunityFilters,
} from '../../shared/funding.js';
import { applyFilters, effectiveLevel, levelFrom, readFilters, sourceOutsidePlace } from './filters.js';

const HOME = { country: 'US', region: 'NJ', county: 'Essex', city: 'Newark' };

function listing(title: string, patch: Partial<Opportunity> = {}): Opportunity {
  return {
    id: `test:${title}`,
    sourceId: 'test',
    sourceName: 'Test Source',
    funder: 'Department of Examples',
    kind: 'grant',
    level: 'federal',
    country: 'US',
    region: '',
    jurisdiction: 'United States',
    geographyNote: '',
    title,
    summary: '',
    number: '',
    applicantTypes: [],
    applicantNote: '',
    categories: [],
    awardFloor: null,
    awardCeiling: null,
    totalFunding: null,
    currency: 'USD',
    openDate: null,
    closeDate: null,
    closeDateText: '',
    status: 'active',
    statusReason: 'Open at the source.',
    unverifiedReason: null,
    sourceStatus: 'open',
    officialUrl: 'https://example.gov/listing',
    fetchedAt: 0,
    match: null,
    ...patch,
  };
}

// Tests start from "no restriction" so that each one shows a single rule.
const filters = (patch: Partial<OpportunityFilters> = {}): OpportunityFilters => ({
  ...DEFAULT_OPPORTUNITY_FILTERS,
  statuses: [],
  ...patch,
});

const kept = (listings: Opportunity[], patch: Partial<OpportunityFilters>, organization = HOME): string[] =>
  applyFilters(listings, filters(patch), organization).map((found) => found.title);

const federal = listing('federal');
const newJersey = listing('new jersey', { level: 'state', region: 'NJ', jurisdiction: 'New Jersey' });
const california = listing('california', { level: 'state', region: 'CA', jurisdiction: 'California' });
const essex = listing('essex county', { level: 'county', region: 'NJ', jurisdiction: 'Essex County' });
const hudson = listing('hudson county', { level: 'county', region: 'NJ', jurisdiction: 'County of Hudson' });
const losAngelesCounty = listing('la county', { level: 'county', region: 'CA', jurisdiction: 'Los Angeles County' });
const newark = listing('newark', { level: 'city', region: 'NJ', jurisdiction: 'City of Newark' });
const newarkDelaware = listing('newark de', { level: 'city', region: 'DE', jurisdiction: 'Newark' });
const jerseyCity = listing('jersey city', { level: 'city', region: 'NJ', jurisdiction: 'Jersey City' });
const europe = listing('european union', { level: 'international', country: '', jurisdiction: 'European Union' });
const canada = listing('canada', { country: 'CA', jurisdiction: 'Canada' });
const ontario = listing('ontario', { level: 'state', country: 'CA', region: 'ON', jurisdiction: 'Ontario' });
const everywhere = [
  federal,
  newJersey,
  california,
  essex,
  hudson,
  losAngelesCounty,
  newark,
  newarkDelaware,
  jerseyCity,
  europe,
  canada,
  ontario,
];

describe('effectiveLevel', () => {
  it('is the funder’s own tier inside the organization’s country', () => {
    expect(effectiveLevel(federal, 'US')).toBe('federal');
    expect(effectiveLevel(newJersey, 'us ')).toBe('state');
    expect(effectiveLevel(newark, 'US')).toBe('city');
  });

  it('is international for another country’s funder, whatever its tier there', () => {
    expect(effectiveLevel(canada, 'US')).toBe('international');
    expect(effectiveLevel(ontario, 'US')).toBe('international');
    expect(effectiveLevel(federal, 'CA')).toBe('international');
    expect(effectiveLevel(ontario, 'CA')).toBe('state');
  });

  it('is international for a body that belongs to no single country', () => {
    expect(effectiveLevel(europe, 'US')).toBe('international');
    expect(effectiveLevel(listing('multi', { country: '  ' }), 'US')).toBe('international');
    expect(effectiveLevel(europe, '')).toBe('international');
  });

  it('does not call a funder foreign to an organization that has not said where it is', () => {
    expect(effectiveLevel(federal, '')).toBe('federal');
    expect(effectiveLevel(ontario, '')).toBe('state');
    expect(levelFrom('county', 'US', '')).toBe('county');
  });
});

describe('applyFilters', () => {
  it('keeps everything when nothing is restricted, and changes nothing it is given', () => {
    const before = structuredClone(everywhere);
    const found = applyFilters(everywhere, filters(), HOME);
    expect(found).toEqual(everywhere);
    expect(found).not.toBe(everywhere);
    expect(found[0]).toBe(federal);
    expect(everywhere).toEqual(before);
  });

  it('levels: keeps a listing whose level, as the organization sees it, was chosen', () => {
    expect(kept(everywhere, { levels: ['federal'] })).toEqual(['federal']);
    expect(kept(everywhere, { levels: ['state', 'county'] })).toEqual([
      'new jersey',
      'california',
      'essex county',
      'hudson county',
      'la county',
    ]);
    // Another country's national and provincial funders are international here.
    expect(kept(everywhere, { levels: ['international'] })).toEqual(['european union', 'canada', 'ontario']);
    expect(kept(everywhere, { levels: ['state'] }, { ...HOME, country: 'CA' })).toEqual(['ontario']);
  });

  it('place: a federal or multi-country listing is never removed by a place', () => {
    const place = { country: 'US', region: 'NJ', county: 'Essex', city: 'Newark' };
    const found = kept(everywhere, { place });
    expect(found).toContain('federal');
    expect(found).toContain('european union');
    // Canada's national programs are federal in their own country.
    expect(found).toContain('canada');
  });

  it('place: a state listing must match the region, by code or by name, in any case', () => {
    const states = [newJersey, california, ontario];
    const region = (value: string, country = '') =>
      kept(states, { place: { country, region: value, county: '', city: '' } });
    expect(region('NJ')).toEqual(['new jersey']);
    expect(region('nj')).toEqual(['new jersey']);
    expect(region('New Jersey')).toEqual(['new jersey']);
    expect(region('  new jersey ')).toEqual(['new jersey']);
    expect(region('State of California')).toEqual(['california']);
    expect(region('')).toEqual(['new jersey', 'california', 'ontario']);
    // "CA" is California in the United States and nothing in Canada.
    expect(region('CA', 'US')).toEqual(['california']);
    expect(region('ON', 'US')).toEqual([]);
    expect(region('ON', 'CA')).toEqual(['ontario']);
  });

  it('place: county and city listings must match their names, and sit in the region asked for', () => {
    const local = [essex, hudson, losAngelesCounty, newark, newarkDelaware, jerseyCity];
    const place = (region: string, county: string, city: string) =>
      kept(local, { place: { country: 'US', region, county, city } });
    expect(place('NJ', 'Essex', 'Newark')).toEqual(['essex county', 'newark']);
    expect(place('NJ', 'essex county', 'city of newark')).toEqual(['essex county', 'newark']);
    expect(place('NJ', 'Hudson County, NJ', 'Jersey City')).toEqual(['hudson county', 'jersey city']);
    // The same city name in another state is another city.
    expect(place('DE', '', 'Newark')).toEqual(['newark de']);
    // A region alone leaves every county and city inside it.
    expect(place('NJ', '', '')).toEqual(['essex county', 'hudson county', 'newark', 'jersey city']);
    // A county does not narrow cities, nor a city counties.
    expect(place('', 'Essex', '')).toEqual(['essex county', 'newark', 'newark de', 'jersey city']);
    expect(place('', '', 'Newark')).toEqual(['essex county', 'hudson county', 'la county', 'newark', 'newark de']);
  });

  it('place: a place narrows only the tier it names', () => {
    const place = { country: '', region: '', county: 'Essex', city: 'Newark' };
    expect(kept([federal, newJersey, california], { place })).toEqual(['federal', 'new jersey', 'california']);
  });

  it('place: a comparison that cannot be settled removes nothing', () => {
    // The county listing gives its state only as a code; the filter gives a name.
    expect(
      kept([essex, losAngelesCounty], { place: { country: 'US', region: 'New Jersey', county: '', city: '' } }),
    ).toEqual(['essex county', 'la county']);
    const unplaced = listing('somewhere', { level: 'state', region: '', jurisdiction: '' });
    const unnamed = listing('some city', { level: 'city', region: '', jurisdiction: '' });
    expect(
      kept([unplaced, unnamed], { place: { country: 'US', region: 'NJ', county: 'Essex', city: 'Newark' } }),
    ).toEqual(['somewhere', 'some city']);
  });

  it('applicantTypes: a listing that states types must share one with the filter', () => {
    const forNonprofits = listing('nonprofits', { applicantTypes: ['nonprofit', 'tribal'] });
    const forBusiness = listing('business', { applicantTypes: ['small_business', 'for_profit'] });
    expect(kept([forNonprofits, forBusiness], { applicantTypes: ['nonprofit'] })).toEqual(['nonprofits']);
    expect(kept([forNonprofits, forBusiness], { applicantTypes: ['individual', 'for_profit'] })).toEqual(['business']);
    expect(kept([forNonprofits, forBusiness], { applicantTypes: ['education'] })).toEqual([]);
  });

  it('applicantTypes: a listing that does not state who may apply is kept, not hidden on a guess', () => {
    const notStated = listing('not stated', { applicantTypes: [] });
    expect(kept([notStated], { applicantTypes: ['nonprofit'] })).toEqual(['not stated']);
  });

  it('categories: a listing that states categories must share one with the filter', () => {
    const health = listing('health', { categories: ['health', 'human_services'] });
    const housing = listing('housing', { categories: ['housing'] });
    expect(kept([health, housing], { categories: ['housing', 'energy'] })).toEqual(['housing']);
    expect(kept([health, housing], { categories: ['human_services'] })).toEqual(['health']);
    expect(kept([health, housing], { categories: ['education'] })).toEqual([]);
  });

  it('categories: a listing that states no category is kept', () => {
    expect(kept([listing('not stated')], { categories: ['housing'] })).toEqual(['not stated']);
  });

  it('kinds: keeps only the kinds chosen', () => {
    const grant = listing('grant');
    const solicitation = listing('solicitation', { kind: 'contract_solicitation' });
    expect(kept([grant, solicitation], { kinds: ['contract_solicitation'] })).toEqual(['solicitation']);
    expect(kept([grant, solicitation], { kinds: ['grant', 'contract_solicitation'] })).toEqual([
      'grant',
      'solicitation',
    ]);
  });

  it('sourceIds: keeps only listings from the sources chosen', () => {
    const one = listing('one', { sourceId: 'grants-gov' });
    const two = listing('two', { sourceId: 'ca-grants' });
    expect(kept([one, two], { sourceIds: ['ca-grants'] })).toEqual(['two']);
    expect(kept([one, two], { sourceIds: ['somewhere-else'] })).toEqual([]);
  });

  it('statuses: compares the status each listing arrives with', () => {
    const active = listing('active');
    const expired = listing('expired', { status: 'expired' });
    const unverified = listing('unverified', { status: 'unverified', unverifiedReason: 'forecast' });
    expect(kept([active, expired, unverified], { statuses: ['active'] })).toEqual(['active']);
    expect(kept([active, expired, unverified], { statuses: ['expired', 'unverified'] })).toEqual([
      'expired',
      'unverified',
    ]);
    expect(kept([active, expired, unverified], { statuses: [] })).toEqual(['active', 'expired', 'unverified']);
  });

  it('amount: the listing’s stated range must overlap the range asked for', () => {
    const small = listing('5k to 25k', { awardFloor: 5000, awardCeiling: 25000 });
    const middle = listing('50k to 250k', { awardFloor: 50000, awardCeiling: 250000 });
    const large = listing('1m to 5m', { awardFloor: 1000000, awardCeiling: 5000000 });
    const all = [small, middle, large];
    const range = (amountMin: number | null, amountMax: number | null) => kept(all, { amountMin, amountMax });
    expect(range(25000, 50000)).toEqual(['5k to 25k', '50k to 250k']);
    expect(range(30000, 40000)).toEqual([]);
    expect(range(100000, null)).toEqual(['50k to 250k', '1m to 5m']);
    expect(range(null, 10000)).toEqual(['5k to 25k']);
    expect(range(null, null)).toEqual(['5k to 25k', '50k to 250k', '1m to 5m']);
  });

  it('amount: reads a half-stated range as far as it goes', () => {
    const upTo = listing('up to 100k', { awardCeiling: 100000 });
    const atLeast = listing('at least 100k', { awardFloor: 100000 });
    // No ceiling given, so no award can exceed the total available.
    const pool = listing('25k in total', { totalFunding: 25000 });
    const swapped = listing('floor above ceiling', { awardFloor: 90000, awardCeiling: 20000 });
    const all = [upTo, atLeast, pool, swapped];
    const range = (amountMin: number | null, amountMax: number | null) =>
      kept(all, { amountMin, amountMax, includeAmountNotStated: false });
    expect(range(200000, null)).toEqual(['at least 100k']);
    expect(range(null, 50000)).toEqual(['up to 100k', '25k in total', 'floor above ceiling']);
    expect(range(50000, 60000)).toEqual(['up to 100k', 'floor above ceiling']);
    expect(range(null, null)).toEqual(['up to 100k', 'at least 100k', '25k in total', 'floor above ceiling']);
  });

  it('amount: a listing that states no amount is kept only when "not stated" is included', () => {
    const notStated = listing('not stated');
    const stated = listing('stated', { awardCeiling: 75000 });
    expect(kept([notStated, stated], { amountMin: 50000, includeAmountNotStated: true })).toEqual([
      'not stated',
      'stated',
    ]);
    expect(kept([notStated, stated], { amountMin: 50000, includeAmountNotStated: false })).toEqual(['stated']);
    expect(kept([notStated, stated], { includeAmountNotStated: false })).toEqual(['stated']);
    // A source's "0" has already been read as "not stated"; it is never a real zero here.
    expect(kept([notStated], { amountMax: 0, includeAmountNotStated: true })).toEqual(['not stated']);
  });

  it('deadline: closeDate must fall within the bounds, both included', () => {
    const october = listing('october', { closeDate: '2026-10-31' });
    const november = listing('november', { closeDate: '2026-11-15' });
    const january = listing('january', { closeDate: '2027-01-05' });
    const all = [october, november, january];
    const within = (deadlineFrom: string | null, deadlineTo: string | null) => kept(all, { deadlineFrom, deadlineTo });
    expect(within('2026-10-31', '2026-11-15')).toEqual(['october', 'november']);
    expect(within('2026-11-01', null)).toEqual(['november', 'january']);
    expect(within(null, '2026-11-14')).toEqual(['october']);
    expect(within('2026-11-16', '2026-12-31')).toEqual([]);
  });

  it('deadline: once a bound is set, a listing with no closeDate is removed', () => {
    const undated = listing('undated');
    const unreadable = listing('unreadable', { closeDate: '11/15/2026' });
    const dated = listing('dated', { closeDate: '2026-11-15' });
    expect(kept([undated, unreadable, dated], { deadlineTo: '2026-12-31' })).toEqual(['dated']);
    expect(kept([undated, unreadable, dated], { deadlineFrom: '2026-01-01' })).toEqual(['dated']);
    expect(kept([undated, unreadable, dated], {})).toEqual(['undated', 'unreadable', 'dated']);
  });

  it('query: every term must occur in the title, summary, funder or reference number', () => {
    const inTitle = listing('Youth Workforce Training Grants');
    const acrossFields = listing('Pathways', {
      summary: 'Job TRAINING for young adults.',
      funder: 'Office of Workforce Development',
      number: 'OWD-2027-014',
    });
    const partial = listing('Workforce housing');
    const all = [inTitle, acrossFields, partial];
    expect(kept(all, { query: 'workforce training' })).toEqual(['Youth Workforce Training Grants', 'Pathways']);
    expect(kept(all, { query: '  Training,  WORKFORCE! ' })).toEqual(['Youth Workforce Training Grants', 'Pathways']);
    expect(kept(all, { query: 'owd-2027-014' })).toEqual(['Pathways']);
    expect(kept(all, { query: 'workforce' })).toEqual([
      'Youth Workforce Training Grants',
      'Pathways',
      'Workforce housing',
    ]);
    expect(kept(all, { query: 'workforce childcare' })).toEqual([]);
    // A term is text to look for, never a pattern.
    expect(kept(all, { query: '.* (workforce|housing)+' })).toEqual(['Workforce housing']);
  });

  it('applies every filter together', () => {
    const match = listing('Newark youth jobs', {
      level: 'city',
      region: 'NJ',
      jurisdiction: 'Newark',
      applicantTypes: ['nonprofit'],
      categories: ['employment_workforce'],
      awardFloor: 25000,
      awardCeiling: 100000,
      closeDate: '2026-12-01',
    });
    const all = [
      match,
      { ...match, title: 'Newark jobs' },
      { ...match, title: 'youth, wrong city', jurisdiction: 'Trenton' },
      { ...match, title: 'youth, wrong applicant', applicantTypes: ['individual'] as Opportunity['applicantTypes'] },
      { ...match, title: 'youth, wrong category', categories: ['housing'] as Opportunity['categories'] },
      { ...match, title: 'youth, wrong kind', kind: 'contract_solicitation' as const },
      { ...match, title: 'youth, too small', awardFloor: 500, awardCeiling: 5000 },
      { ...match, title: 'youth, too late', closeDate: '2027-06-01' },
      { ...match, title: 'youth, expired', status: 'expired' as const },
      { ...match, title: 'youth, another source', sourceId: 'elsewhere' },
      { ...match, title: 'youth, another level', level: 'county' as const, jurisdiction: 'Essex County' },
    ];
    expect(
      kept(all, {
        query: 'youth',
        levels: ['city'],
        place: { country: 'US', region: 'NJ', county: 'Essex', city: 'Newark' },
        applicantTypes: ['nonprofit'],
        categories: ['employment_workforce'],
        kinds: ['grant'],
        amountMin: 50000,
        amountMax: 150000,
        includeAmountNotStated: false,
        deadlineFrom: '2026-10-01',
        deadlineTo: '2026-12-31',
        statuses: ['active'],
        sourceIds: ['test'],
      }),
    ).toEqual(['Newark youth jobs']);
  });
});

describe('sourceOutsidePlace', () => {
  const source = (
    level: FundingSourceInfo['level'],
    coverage: Partial<FundingSourceInfo['coverage']>,
    jurisdiction = '',
  ): FundingSourceInfo => ({
    id: 'source',
    name: 'Source',
    operator: 'Operator',
    level,
    jurisdiction,
    coverage: { country: 'US', region: '', county: '', city: '', ...coverage },
    kinds: ['grant'],
    homepageUrl: 'https://example.gov',
    attribution: '',
    note: '',
  });
  const newarkEssex = { country: 'US', region: 'NJ', county: 'Essex', city: 'Newark' };

  it('never rules out a national or international source', () => {
    expect(sourceOutsidePlace(source('federal', {}, 'United States'), newarkEssex)).toBe(false);
    expect(sourceOutsidePlace(source('international', { country: '' }, 'European Union'), newarkEssex)).toBe(false);
    expect(sourceOutsidePlace(source('federal', { country: 'CA' }, 'Canada'), newarkEssex)).toBe(false);
  });

  it('rules out a source that covers another region, county or city', () => {
    expect(sourceOutsidePlace(source('state', { region: 'CA' }, 'California'), newarkEssex)).toBe(true);
    expect(sourceOutsidePlace(source('state', { region: 'NJ' }, 'New Jersey'), newarkEssex)).toBe(false);
    expect(sourceOutsidePlace(source('county', { region: 'NJ', county: 'Hudson' }, 'Hudson County'), newarkEssex)).toBe(
      true,
    );
    expect(
      sourceOutsidePlace(source('county', { region: 'NJ', county: 'Essex County' }, 'Essex County'), newarkEssex),
    ).toBe(false);
    expect(
      sourceOutsidePlace(
        source('city', { region: 'NJ', county: 'Essex', city: 'Newark' }, 'City of Newark'),
        newarkEssex,
      ),
    ).toBe(false);
    expect(
      sourceOutsidePlace(
        source('city', { region: 'NJ', county: 'Hudson', city: 'Jersey City' }, 'Jersey City'),
        newarkEssex,
      ),
    ).toBe(true);
    expect(
      sourceOutsidePlace(source('state', { country: 'AU', region: 'WA' }, 'Western Australia'), {
        ...newarkEssex,
        region: 'WA',
      }),
    ).toBe(true);
  });

  it('keeps a source when the search names no place, or one it cannot compare', () => {
    const anywhere = { country: '', region: '', county: '', city: '' };
    expect(sourceOutsidePlace(source('state', { region: 'CA' }, 'California'), anywhere)).toBe(false);
    expect(
      sourceOutsidePlace(source('county', { region: 'NJ', county: 'Hudson' }), { ...anywhere, city: 'Newark' }),
    ).toBe(false);
    expect(
      sourceOutsidePlace(source('state', { region: 'CA' }, 'California'), { ...anywhere, region: 'California' }),
    ).toBe(false);
    expect(
      sourceOutsidePlace(source('state', { region: 'CA' }, 'California'), { ...anywhere, region: 'New Jersey' }),
    ).toBe(true);
  });
});

describe('readFilters', () => {
  const refusal = (input: unknown): unknown => {
    try {
      readFilters(input);
    } catch (error) {
      return error;
    }
    return null;
  };

  it('returns the defaults for an empty object, as a copy', () => {
    const read = readFilters({});
    expect(read).toEqual(DEFAULT_OPPORTUNITY_FILTERS);
    expect(read.statuses).not.toBe(DEFAULT_OPPORTUNITY_FILTERS.statuses);
    expect(read.place).not.toBe(DEFAULT_OPPORTUNITY_FILTERS.place);
  });

  it('keeps valid filters, tidies text and drops repeats', () => {
    const hidden = String.fromCodePoint(0x200b);
    const read = readFilters({
      query: `  youth${hidden}   workforce\n`,
      levels: ['state', 'federal', 'state'],
      place: { country: ' US ', region: 'NJ', county: 'Essex', city: 'Newark', planet: 'Earth' },
      applicantTypes: ['nonprofit'],
      categories: ['health', 'housing'],
      kinds: ['grant'],
      amountMin: 0,
      amountMax: 250000,
      includeAmountNotStated: false,
      deadlineFrom: '2026-10-06',
      deadlineTo: '',
      statuses: [],
      sourceIds: ['grants-gov', 'grants-gov'],
      somethingElse: true,
    });
    expect(read).toEqual({
      query: 'youth workforce',
      levels: ['state', 'federal'],
      place: { country: 'US', region: 'NJ', county: 'Essex', city: 'Newark' },
      applicantTypes: ['nonprofit'],
      categories: ['health', 'housing'],
      kinds: ['grant'],
      amountMin: 0,
      amountMax: 250000,
      includeAmountNotStated: false,
      deadlineFrom: '2026-10-06',
      deadlineTo: null,
      statuses: [],
      sourceIds: ['grants-gov'],
    });
    expect(readFilters({ query: 'x'.repeat(5000) }).query).toHaveLength(200);
  });

  it.each<[string, unknown]>([
    ['nothing', undefined],
    ['null', null],
    ['a list', []],
    ['text', 'statuses=active'],
    ['a status the app does not have', { statuses: ['Active'] }],
    ['a status list that is not a list', { statuses: 'active' }],
    ['a level the app does not have', { levels: ['federal', 'galactic'] }],
    ['an inherited name as an applicant type', { applicantTypes: ['constructor'] }],
    ['a category that is not text', { categories: [7] }],
    ['a query that is not text', { query: { $ne: '' } }],
    ['a place that is not a record', { place: 'Newark' }],
    ['a place part that is not text', { place: { region: ['NJ'] } }],
    ['a source id with a path in it', { sourceIds: ['../grants-gov'] }],
    ['far too many source ids', { sourceIds: Array.from({ length: 51 }, (_, index) => `source-${index}`) }],
    ['a flag that is not a flag', { includeAmountNotStated: 'yes' }],
  ])('refuses %s rather than widening the search', (_label, input) => {
    expect(refusal(input)).toMatchObject({ code: 'INVALID_INPUT', message: 'Those search filters are not valid.' });
  });

  it.each<[unknown, RegExp]>([
    [{ amountMin: '50000' }, /award amount must be a number/],
    [{ amountMax: -1 }, /award amount must be a number/],
    [{ amountMin: Number.NaN }, /award amount must be a number/],
    [{ amountMin: 100000, amountMax: 50000 }, /smallest award amount is larger than the largest/],
    [{ deadlineFrom: '11/15/2026' }, /deadline date could not be read/],
    [{ deadlineTo: '2026-02-30' }, /deadline date could not be read/],
    [{ deadlineFrom: 20261115 }, /deadline date could not be read/],
    [{ deadlineFrom: '2026-12-01', deadlineTo: '2026-11-01' }, /deadline range ends before it starts/],
  ])('says what is wrong with %j', (input, message) => {
    expect(refusal(input)).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringMatching(message) });
  });
});
