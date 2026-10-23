import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  APPLICANT_TYPE_LABELS,
  DEFAULT_OPPORTUNITY_FILTERS,
  FUNDING_CATEGORY_LABELS,
  type ApplicantType,
  type FundingCategory,
  type Opportunity,
  type OpportunityFilters,
} from '../../../shared/funding.js';
import { FundingError } from '../../funding/errors.js';
import type { HttpClient, HttpRequest } from '../http.js';
import type { SourceContext } from '../types.js';
import { CATEGORY_CODES, ELIGIBILITY_CODES, grantsGovAdapter } from './grants-gov.js';

// Every answer below was recorded from the live source on 6 October 2026 (see
// the README beside the fixtures). Where a test needs an answer the source did
// not give that day, it changes one field of a recorded answer and says so.

type Loose = Record<string, unknown>;

interface Recording {
  recordedOn: string;
  request: { url: string; body: unknown };
  response: unknown;
}

const SEARCH_URL = 'https://api.grants.gov/v1/api/search2';
const RECORD_URL = 'https://api.grants.gov/v1/api/fetchOpportunity';

const recording = (name: string): Recording =>
  JSON.parse(
    readFileSync(new URL(`../../../../test-fixtures/funding/sources/grants-gov/${name}.json`, import.meta.url), 'utf8'),
  ) as Recording;

/** Noon UTC on the day of recording: 8 a.m. in the source's time zone. */
const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);

const unreachable = () =>
  new FundingError('SOURCE_UNAVAILABLE', 'Grants.gov could not be read: it answered with status 503.');

/**
 * A source that answers only the exact requests that were recorded. Anything
 * else is refused the way a dead connection would be.
 */
function replay(recordings: Recording[]) {
  const calls: HttpRequest[] = [];
  let inFlight = 0;
  const state = { mostAtOnce: 0 };
  const http: HttpClient = {
    async json<T>(request: HttpRequest): Promise<T> {
      calls.push(request);
      inFlight += 1;
      state.mostAtOnce = Math.max(state.mostAtOnce, inFlight);
      try {
        await new Promise((resolve) => setImmediate(resolve));
        if (request.signal.aborted) throw new FundingError('CANCELLED', 'Cancelled.');
        const match = recordings.find(
          (item) => item.request.url === request.url && isDeepStrictEqual(item.request.body, request.body),
        );
        if (!match) throw unreachable();
        return structuredClone(match.response) as T;
      } finally {
        inFlight -= 1;
      }
    },
    async text(): Promise<string> {
      throw new Error('The adapter only asks for JSON.');
    },
  };
  const to = (url: string) => calls.filter((call) => call.url === url);
  return { http, calls, state, searches: () => to(SEARCH_URL), records: () => to(RECORD_URL) };
}

/** A source that gives the same answer to every search, or to every record request. */
function answering(url: string, response: unknown) {
  const calls: HttpRequest[] = [];
  const http: HttpClient = {
    async json<T>(request: HttpRequest): Promise<T> {
      calls.push(request);
      if (request.url !== url) throw unreachable();
      return structuredClone(response) as T;
    },
    async text(): Promise<string> {
      throw new Error('The adapter only asks for JSON.');
    },
  };
  return { http, calls };
}

const context = (http: HttpClient, now = NOW, signal = new AbortController().signal): SourceContext => ({
  http,
  now,
  signal,
});
const filters = (patch: Partial<OpportunityFilters> = {}): OpportunityFilters => ({
  ...DEFAULT_OPPORTUNITY_FILTERS,
  ...patch,
});

const dataOf = (item: Recording): Loose => (item.response as { data: Loose }).data;
const partOf = (item: Recording, part: 'synopsis' | 'forecast'): Loose => dataOf(item)[part] as Loose;
const hitsOf = (item: Recording): Loose[] => dataOf(item).oppHits as Loose[];
const byId = (listings: Opportunity[], id: string): Opportunity => {
  const found = listings.find((listing) => listing.id === `grants-gov:${id}`);
  if (!found) throw new Error(`No listing ${id} in the result.`);
  return found;
};

const ORAL_HEALTH = {
  query: 'Oral health',
  applicantTypes: ['nonprofit'],
  categories: ['health'],
} satisfies Partial<OpportunityFilters>;
const INFRASTRUCTURE = { query: 'Strengthening American infrastructure' } satisfies Partial<OpportunityFilters>;

afterEach(() => {
  vi.useRealTimers();
});

describe('Grants.gov source', () => {
  it('describes itself as the federal grants source for the United States', () => {
    expect(grantsGovAdapter.info).toMatchObject({
      id: 'grants-gov',
      name: 'Grants.gov',
      level: 'federal',
      jurisdiction: 'United States',
      coverage: { country: 'US', region: '', county: '', city: '' },
      kinds: ['grant'],
    });
    expect(grantsGovAdapter.info.homepageUrl).toMatch(/^https:\/\/www\.grants\.gov\//);
    expect(grantsGovAdapter.timeZone).toBe('America/New_York');
    expect(grantsGovAdapter.filtersRead).toEqual([
      'query',
      'applicantTypes',
      'categories',
      'kinds',
      'statuses',
      'deadlineFrom',
      'deadlineTo',
    ]);
    expect(grantsGovAdapter.info.note).toMatch(/on this device/);
  });
});

describe('Grants.gov search', () => {
  it('sends the search the source understands and reads each row back from its own record', async () => {
    const search = recording('search-oral-health-nonprofit');
    const source = replay([search, recording('detail-359123')]);
    const found = await grantsGovAdapter.search(filters(ORAL_HEALTH), context(source.http));

    expect(source.searches()).toHaveLength(1);
    expect(source.searches()[0]).toMatchObject({ url: SEARCH_URL, source: 'Grants.gov' });
    // Exactly the request that was recorded: terms joined with AND, nonprofits
    // widened to both nonprofit codes plus "unrestricted", and the app's
    // category as the source's codes.
    expect(source.searches()[0]!.body).toEqual(search.request.body);
    expect(source.searches()[0]!.body).toEqual({
      keyword: 'oral AND health',
      oppStatuses: 'posted',
      eligibilities: '12|13|99',
      fundingCategories: 'ACA|HL',
      sortBy: '',
      rows: 5000,
      startRecordNum: 0,
    });
    // One record request per row, by number, and nothing else.
    expect(source.records().map((call) => call.body)).toEqual(
      hitsOf(search).map((hit) => ({ opportunityId: Number(hit.id) })),
    );

    expect(found.map((listing) => listing.id)).toEqual(hitsOf(search).map((hit) => `grants-gov:${String(hit.id)}`));
    const confirmed = byId(found, '359123');
    expect(confirmed).toMatchObject({
      sourceId: 'grants-gov',
      sourceName: 'Grants.gov',
      funder: 'National Institutes of Health',
      kind: 'grant',
      level: 'federal',
      country: 'US',
      region: '',
      jurisdiction: 'United States',
      number: 'RFA-DE-27-001',
      categories: ['health'],
      awardFloor: null,
      awardCeiling: null,
      totalFunding: 1000000,
      currency: 'USD',
      openDate: '2026-04-27',
      closeDate: '2026-10-19',
      closeDateText: 'Oct 19, 2026',
      status: 'active',
      unverifiedReason: null,
      sourceStatus: 'posted',
      officialUrl: 'https://www.grants.gov/search-results-detail/359123',
      fetchedAt: NOW,
      match: null,
    });
    expect(confirmed.statusReason).toMatch(/Closes October 19, 2026\.$/);
    expect(confirmed.summary).toMatch(/^The purpose of this Notice of Funding Opportunity/);
    expect(confirmed.applicantTypes).toEqual(
      Object.keys(APPLICANT_TYPE_LABELS).filter((type) => type !== 'individual'),
    );
  });

  it('never calls a listing active when its own record could not be read', async () => {
    const source = replay([recording('search-oral-health-nonprofit'), recording('detail-359123')]);
    const found = await grantsGovAdapter.search(filters(ORAL_HEALTH), context(source.http));

    const unconfirmed = found.filter((listing) => listing.id !== 'grants-gov:359123');
    expect(unconfirmed).toHaveLength(10);
    for (const listing of unconfirmed) {
      expect(listing).toMatchObject({
        status: 'unverified',
        unverifiedReason: 'detail_unavailable',
        sourceStatus: 'posted',
      });
      expect(listing.statusReason).toBe('The listing could not be re-read from the source to confirm it.');
      // What the search row did say is kept; what it did not say is left empty.
      expect(listing.closeDate).toMatch(/^20\d\d-\d\d-\d\d$/);
      expect(listing).toMatchObject({
        summary: '',
        applicantTypes: [],
        categories: [],
        awardCeiling: null,
        totalFunding: null,
      });
    }
  });

  it('expires a posted listing whose deadline has passed, without asking for its record', async () => {
    const source = replay([recording('search-oral-health-nonprofit'), recording('detail-359123')]);
    const twoWeeksLater = Date.UTC(2026, 9, 20, 12, 0, 0);
    const found = await grantsGovAdapter.search(filters(ORAL_HEALTH), context(source.http, twoWeeksLater));

    expect(byId(found, '359123')).toMatchObject({
      status: 'expired',
      statusReason: 'The deadline passed on October 19, 2026.',
      sourceStatus: 'posted',
    });
    expect(source.records().map((call) => call.body)).not.toContainEqual({ opportunityId: 359123 });
    expect(source.records()).toHaveLength(10);
  });

  it('decodes entities and strips markup from titles', async () => {
    const search = recording('search-infrastructure-open');
    expect(hitsOf(search).filter((hit) => /&[a-z]+;/.test(String(hit.title))).length).toBeGreaterThan(3);
    const found = await grantsGovAdapter.search(
      filters({ ...INFRASTRUCTURE, statuses: ['unverified'] }),
      context(replay([search]).http),
    );

    expect(found).toHaveLength(80);
    expect(found.filter((listing) => /&[a-z#0-9]+;|[<>]/i.test(listing.title))).toEqual([]);
    expect(byId(found, '350338').title).toMatch(/^CHIPS Incentives Program – Facilities for Semiconductor/);
    expect(byId(found, '362866').title).toBe('DoW Parkinson’s, Early Investigator Research Award');
  });

  it('reads at most forty records for one search, six at a time', async () => {
    const source = replay([recording('search-infrastructure-open')]);
    const found = await grantsGovAdapter.search(
      filters({ ...INFRASTRUCTURE, statuses: ['active', 'unverified'] }),
      context(source.http),
    );

    expect(found).toHaveLength(80);
    expect(source.records()).toHaveLength(40);
    expect(source.state.mostAtOnce).toBe(6);
    // Rows that could be confirmed active go first, in the source's relevance
    // order; an undated row cannot be, so the first row is not among them.
    const asked = source.records().map((call) => (call.body as { opportunityId: number }).opportunityId);
    expect(asked.slice(0, 3)).toEqual([364016, 364006, 361754]);
    expect(asked).not.toContain(364025);

    const notRead = found.filter((listing) => /has not been read yet/.test(listing.statusReason));
    const readFailed = found.filter((listing) => /could not be re-read/.test(listing.statusReason));
    expect(readFailed).toHaveLength(40);
    // The other thirty-five rows that a record could confirm as active.
    expect(notRead).toHaveLength(35);
    expect(found.some((listing) => listing.status === 'active')).toBe(false);

    // The five rows no record could make active already say why, read or not.
    const reasons = (id: string) => [byId(found, id).status, byId(found, id).unverifiedReason];
    expect(reasons('364025')).toEqual(['unverified', 'no_deadline']);
    expect(reasons('347414')).toEqual(['unverified', 'no_deadline']);
    expect(reasons('363786')).toEqual(['unverified', 'implausible_deadline']);
    expect(reasons('363381')).toEqual(['unverified', 'implausible_deadline']);
    expect(reasons('363416')).toEqual(['unverified', 'forecast']);
  });

  it('with no keyword, reads the listings with the nearest deadlines first', async () => {
    const search = recording('search-human-services');
    const source = replay([search, recording('detail-363482')]);
    const found = await grantsGovAdapter.search(filters({ categories: ['human_services'] }), context(source.http));

    expect(source.searches().map((call) => call.body)).toEqual([search.request.body]);
    expect(found).toHaveLength(66);
    const asked = source.records().map((call) => String((call.body as { opportunityId: number }).opportunityId));
    expect(asked).toHaveLength(40);
    expect(asked.slice(0, 4)).toEqual(['362844', '363655', '363667', '363482']);
    const deadlines = asked.map((id) => byId(found, id).closeDate!);
    expect(deadlines).toEqual([...deadlines].sort());
    const notAsked = found.filter((listing) => !asked.includes(listing.id.slice('grants-gov:'.length)));
    expect(notAsked).toHaveLength(26);
    expect(notAsked.every((listing) => listing.closeDate! >= deadlines[39]!)).toBe(true);

    // The one record this test can answer is the one listing confirmed active.
    expect(found.filter((listing) => listing.status === 'active').map((listing) => listing.id)).toEqual([
      'grants-gov:363482',
    ]);
    // A deadline of today has not passed.
    expect(byId(found, '362844')).toMatchObject({
      closeDate: '2026-10-06',
      status: 'unverified',
      unverifiedReason: 'detail_unavailable',
    });
  });

  it('reports what each kind of listing is, and never more than the source supports', async () => {
    const source = replay([
      recording('search-infrastructure-open'),
      recording('detail-364025'),
      recording('detail-363786'),
    ]);
    const found = await grantsGovAdapter.search(
      filters({ ...INFRASTRUCTURE, statuses: ['unverified'] }),
      context(source.http),
    );

    // Only the five rows that could be unverified are worth a record request.
    expect(
      source
        .records()
        .map((call) => (call.body as { opportunityId: number }).opportunityId)
        .sort(),
    ).toEqual([347414, 363381, 363416, 363786, 364025]);

    // Posted the day before, with no date, and its own text says it is archived.
    const archived = byId(found, '364025');
    expect(archived).toMatchObject({ status: 'unverified', unverifiedReason: 'source_contradiction', closeDate: null });
    expect(archived.statusReason).toContain('"Funding Opportunity is Archived, Proposals are not accepted"');

    // A deadline in 2099 is a placeholder, however the source labels the listing.
    expect(byId(found, '363786')).toMatchObject({
      status: 'unverified',
      unverifiedReason: 'implausible_deadline',
      closeDate: '2099-01-01',
    });

    // A forecast stays a forecast even when its record cannot be read.
    expect(byId(found, '363416')).toMatchObject({
      status: 'unverified',
      unverifiedReason: 'forecast',
      sourceStatus: 'forecasted',
      closeDate: null,
      closeDateText: '',
    });

    // Posted with no deadline, and the record request failed.
    expect(byId(found, '347414')).toMatchObject({
      status: 'unverified',
      unverifiedReason: 'detail_unavailable',
      closeDate: null,
      statusReason: 'The listing could not be re-read from the source to confirm it.',
    });

    // Posted with a real deadline but not read in this search: said plainly.
    expect(byId(found, '364016')).toMatchObject({
      status: 'unverified',
      unverifiedReason: 'detail_unavailable',
      closeDate: '2026-10-30',
      closeDateText: '10/30/2026',
    });
    expect(byId(found, '364016').statusReason).toMatch(/its own record has not been read yet/);
  });

  it('asks for closed and archived listings only when expired ones are wanted', async () => {
    const posted = recording('search-algerian-posted');
    const closed = recording('search-algerian-closed');
    const source = replay([posted, closed, recording('detail-362903')]);
    const found = await grantsGovAdapter.search(
      filters({ query: 'Algerian collaboration', statuses: ['expired'] }),
      context(source.http),
    );

    expect(source.searches().map((call) => call.body)).toEqual([posted.request.body, closed.request.body]);
    expect(source.searches()[1]!.body).toMatchObject({
      oppStatuses: 'archived|closed',
      sortBy: 'closeDate|desc',
      rows: 500,
    });
    expect(found).toHaveLength(25);
    expect(found.every((listing) => listing.status === 'expired')).toBe(true);
    expect(new Set(found.map((listing) => listing.sourceStatus))).toEqual(new Set(['closed', 'archived']));
    expect(byId(found, '362903')).toMatchObject({
      statusReason: 'The source lists this as closed.',
      awardFloor: 5000,
      awardCeiling: 100000,
      // The source wrote "0", which is "not stated", not zero dollars.
      totalFunding: null,
      closeDate: '2026-08-08',
    });

    for (const statuses of [['active'], ['active', 'unverified'], []] as OpportunityFilters['statuses'][]) {
      const probe = answering(SEARCH_URL, null);
      await expect(grantsGovAdapter.search(filters({ statuses }), context(probe.http))).rejects.toThrow();
      expect(probe.calls.map((call) => (call.body as Loose).oppStatuses)).toEqual([
        statuses.includes('active') && statuses.length === 1 ? 'posted' : 'forecasted|posted',
      ]);
    }
  });

  it('takes an empty answer as empty when nothing it counts contradicts it', async () => {
    const posted = recording('search-algerian-posted');
    // Closed and archived matches exist; none is posted. That is not an error.
    expect(dataOf(posted)).toMatchObject({ hitCount: 0, oppHits: [] });
    expect(JSON.stringify(dataOf(posted).oppStatusOptions)).toContain('"value":"closed","count":9');
    const source = replay([posted]);
    await expect(
      grantsGovAdapter.search(filters({ query: 'Algerian collaboration' }), context(source.http)),
    ).resolves.toEqual([]);
    expect(source.records()).toHaveLength(0);
  });

  it('does not ask a grants source for contract solicitations', async () => {
    const source = replay([]);
    expect(await grantsGovAdapter.search(filters({ kinds: ['contract_solicitation'] }), context(source.http))).toEqual(
      [],
    );
    expect(source.calls).toHaveLength(0);
  });

  it('does not let a slow source hold the search for long', async () => {
    vi.useFakeTimers();
    const search = recording('search-infrastructure-open');
    const calls: HttpRequest[] = [];
    // Every record takes five seconds to arrive.
    const http: HttpClient = {
      async json<T>(request: HttpRequest): Promise<T> {
        calls.push(request);
        if (request.url === SEARCH_URL) return structuredClone(search.response) as T;
        await new Promise((resolve) => setTimeout(resolve, 5000));
        throw unreachable();
      },
      async text(): Promise<string> {
        return '';
      },
    };
    const pending = grantsGovAdapter.search(
      filters({ ...INFRASTRUCTURE, statuses: ['active', 'unverified'] }),
      context(http),
    );
    await vi.advanceTimersByTimeAsync(60_000);
    const found = await pending;

    // Four rounds of six fit in twenty seconds; the other sixteen are never started.
    const records = calls.filter((call) => call.url === RECORD_URL);
    expect(records).toHaveLength(24);
    // Each read has its own, shorter, time limit; the search keeps the client's default.
    expect(records.every((call) => call.timeoutMs === 12_000)).toBe(true);
    expect(calls[0]!.timeoutMs).toBeUndefined();
    expect(found).toHaveLength(80);
    expect(found.filter((listing) => /could not be re-read/.test(listing.statusReason))).toHaveLength(24);
    expect(found.filter((listing) => /has not been read yet/.test(listing.statusReason))).toHaveLength(51);
  });

  it('stops as soon as the search is cancelled', async () => {
    const controller = new AbortController();
    const search = recording('search-infrastructure-open');
    const calls: HttpRequest[] = [];
    const http: HttpClient = {
      async json<T>(request: HttpRequest): Promise<T> {
        calls.push(request);
        if (request.url === SEARCH_URL) return structuredClone(search.response) as T;
        controller.abort();
        throw new FundingError('CANCELLED', 'Cancelled.');
      },
      async text(): Promise<string> {
        return '';
      },
    };
    await expect(
      grantsGovAdapter.search(
        filters({ ...INFRASTRUCTURE, statuses: ['active', 'unverified'] }),
        context(http, NOW, controller.signal),
      ),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    // The six requests already under way, and not one more.
    expect(calls.filter((call) => call.url === RECORD_URL).length).toBeLessThanOrEqual(6);
  });
});

describe('Grants.gov search requests', () => {
  /** The search request the adapter sends for some filters; the source is unreachable, so it stops there. */
  async function sent(patch: Partial<OpportunityFilters>): Promise<Loose[]> {
    const source = replay([]);
    await expect(grantsGovAdapter.search(filters(patch), context(source.http))).rejects.toMatchObject({
      code: 'SOURCE_UNAVAILABLE',
    });
    return source.calls.map((call) => call.body as Loose);
  }

  it.each<[ApplicantType[], string]>([
    [['nonprofit'], '12|13|99'],
    [['small_business'], '23|99'],
    [['for_profit'], '22|99'],
    [['local_government'], '01|02|04|08|99'],
    [['state_government'], '00|99'],
    [['tribal'], '07|08|11|99'],
    [['education'], '05|06|20|99'],
    [['individual'], '21|99'],
    [['other'], '25|99'],
    [['nonprofit', 'small_business'], '12|13|23|99'],
    [[], ''],
  ])('widens applicant types %j to the codes %s, always with "unrestricted"', async (applicantTypes, codes) => {
    expect((await sent({ applicantTypes }))[0]).toMatchObject({ eligibilities: codes });
  });

  it.each<[FundingCategory[], string]>([
    [['health'], 'ACA|HL'],
    [['agriculture_food'], 'AG|FN'],
    [['community_development'], 'CD|OZ|RD'],
    [['business_economic_development'], 'BC|OZ|RD'],
    [['arts_culture_humanities', 'housing'], 'AR|HO|HU'],
    [['other'], 'CP|IS|O|RA|RT'],
    [[], ''],
  ])('sends categories %j as the codes %s', async (categories, codes) => {
    expect((await sent({ categories }))[0]).toMatchObject({ fundingCategories: codes });
  });

  it.each([
    ['Workforce   training', 'workforce AND training'],
    ['“Adult ESL” & job-readiness!', 'adult AND esl AND job AND readiness'],
    // AND, OR and NOT are the source's operators, so they are never sent as words.
    ['arts and culture, or NOT music', 'arts AND culture AND music'],
    // A keyword outside ASCII makes the source answer with nothing at all.
    ['Educación para niños', 'educacion AND para AND ninos'],
    ['住宅 housing', 'housing'],
    ['housing housing HOUSING', 'housing'],
    // Punctuation never reaches the source, so an entry cannot change the search's syntax.
    ['cats\') OR (1=1 -- "dogs"', 'cats AND dogs'],
    ['', ''],
  ])('turns the entry %j into the keyword %j', async (query, keyword) => {
    expect((await sent({ query }))[0]).toMatchObject({ keyword });
  });

  it('caps a very long entry and sends only filters, never anything about the organization', async () => {
    const words = Array.from({ length: 60 }, (_, index) => `term${index}`).join(' ');
    const [body] = await sent({
      query: words,
      place: { country: 'US', region: 'NJ', county: 'Essex', city: 'Newark' },
      amountMin: 50000,
      deadlineTo: '2027-01-01',
      sourceIds: ['grants-gov'],
      levels: ['federal'],
    });
    expect(String(body!.keyword).split(' AND ')).toHaveLength(12);
    expect(Object.keys(body!).sort()).toEqual([
      'eligibilities',
      'fundingCategories',
      'keyword',
      'oppStatuses',
      'rows',
      'sortBy',
      'startRecordNum',
    ]);
    expect(JSON.stringify(body)).not.toMatch(/Newark|Essex|NJ|50000|2027/);
  });

  it('asks the source the same things whatever the filters it says it does not read', async () => {
    const asked = async (patch: Partial<OpportunityFilters>) => {
      const source = replay([recording('search-oral-health-nonprofit'), recording('detail-359123')]);
      await grantsGovAdapter.search(filters({ ...ORAL_HEALTH, ...patch }), context(source.http));
      return source.calls.map((call) => [call.url, call.body]);
    };
    const usual = await asked({});
    expect(usual).toHaveLength(12);
    const untouched: Partial<OpportunityFilters>[] = [
      { levels: ['state'] },
      { place: { country: 'CA', region: 'ON', county: '', city: 'Toronto' } },
      { amountMin: 50000, amountMax: 90000 },
      { includeAmountNotStated: false },
      { sourceIds: ['somewhere-else'] },
    ];
    for (const patch of untouched) {
      for (const name of Object.keys(patch)) expect(grantsGovAdapter.filtersRead).not.toContain(name);
      expect(await asked(patch)).toEqual(usual);
    }
    // A filter it does read changes what is asked: here, which records are worth reading.
    expect(grantsGovAdapter.filtersRead).toContain('deadlineTo');
    expect(await asked({ deadlineTo: '2026-12-31' })).toHaveLength(2);
  });

  it('only ever sends a sort the source supports', async () => {
    // An unsupported sort is answered with no rows and no error, so the two
    // values seen to work are the only ones the adapter may send.
    const source = replay([
      recording('search-oral-health-nonprofit'),
      recording('search-infrastructure-open'),
      recording('search-algerian-posted'),
      recording('search-algerian-closed'),
    ]);
    await grantsGovAdapter.search(filters(ORAL_HEALTH), context(source.http));
    await grantsGovAdapter.search(filters({ ...INFRASTRUCTURE, statuses: ['unverified'] }), context(source.http));
    await grantsGovAdapter.search(
      filters({ query: 'Algerian collaboration', statuses: ['expired'] }),
      context(source.http),
    );
    const sorts = source.searches().map((call) => (call.body as Loose).sortBy);
    expect(sorts).toEqual(['', '', '', 'closeDate|desc']);
  });
});

describe('Grants.gov search guards', () => {
  const good = () =>
    structuredClone(recording('search-oral-health-nonprofit').response) as { errorcode: number; data: Loose };
  const changed = (change: (reply: { errorcode: number; data: Loose }) => void) => () => {
    const reply = good();
    change(reply);
    return reply as unknown;
  };
  const echo = (reply: { data: Loose }) => reply.data.searchParams as Loose;

  it('accepts the recorded answer it is about to break', async () => {
    const found = await grantsGovAdapter.search(filters(ORAL_HEALTH), context(answering(SEARCH_URL, good()).http));
    expect(found).toHaveLength(11);
  });

  it('holds the silent failures exactly as the source produced them', () => {
    // An unsupported sort: no rows, no error, yet 528 posted matches counted.
    const unsorted = dataOf(recording('search-unsupported-sort'));
    expect(unsorted).toMatchObject({ hitCount: 0, oppHits: [], errorMsgs: [] });
    expect(JSON.stringify(unsorted.oppStatusOptions)).toContain('"value":"posted","count":528');
    // A keyword outside ASCII: success code, and no echo of the search at all.
    const response = recording('search-non-ascii-keyword').response as { errorcode: number; data: Loose };
    expect(response.errorcode).toBe(0);
    expect(response.data).not.toHaveProperty('searchParams');
  });

  it.each<[string, () => unknown, RegExp]>([
    [
      'the unsupported-sort answer as recorded',
      () => recording('search-unsupported-sort').response,
      /ran a different search/,
    ],
    [
      'the non-ASCII keyword answer as recorded',
      () => recording('search-non-ascii-keyword').response,
      /did not confirm which search/,
    ],
    ['an echo that dropped a filter', changed((reply) => (echo(reply).eligibilities = '')), /ran a different search/],
    [
      'an echo with other keywords',
      changed((reply) => (echo(reply).keyword = 'oral health')),
      /ran a different search/,
    ],
    [
      'an echo with another status',
      changed((reply) => (echo(reply).oppStatuses = 'forecasted|posted')),
      /ran a different search/,
    ],
    ['an echo with fewer rows', changed((reply) => (echo(reply).rows = 25)), /ran a different search/],
    [
      'an echo with a sort that was not sent',
      changed((reply) => (echo(reply).sortBy = 'openDate|desc')),
      /ran a different search/,
    ],
    [
      'an echo with a filter that was never sent',
      changed((reply) => (echo(reply).agencies = 'HHS')),
      /ran a different search/,
    ],
    [
      'no rows for a search it counts matches for',
      changed((reply) => Object.assign(reply.data, { hitCount: 0, oppHits: [] })),
      /returned no listings for a search it counts matches for/,
    ],
    [
      'fewer rows than it reports',
      changed((reply) => (reply.data.oppHits as Loose[]).pop()),
      /different number of listings/,
    ],
    ['more rows than it reports', changed((reply) => (reply.data.hitCount = 3)), /different number of listings/],
    [
      'an error list',
      changed((reply) => (reply.data.errorMsgs = ['Backend apply07 failed'])),
      /reported a problem with the search/,
    ],
    ['an error code', changed((reply) => (reply.errorcode = 5)), /reported a problem with the search/],
    ['no data', changed((reply) => delete (reply as Loose).data), /not in the expected form/],
    ['rows that are not a list', changed((reply) => (reply.data.oppHits = { 0: {} })), /not in the expected form/],
    ['a count that is not a number', changed((reply) => (reply.data.hitCount = '11')), /not in the expected form/],
    [
      'a row with a path for an id',
      changed((reply) => ((reply.data.oppHits as Loose[])[0]!.id = '../../359123')),
      /not in the expected form/,
    ],
    [
      'a row with no title',
      changed((reply) => ((reply.data.oppHits as Loose[])[3]!.title = '')),
      /not in the expected form/,
    ],
    [
      'a row that is not a record',
      changed((reply) => ((reply.data.oppHits as unknown[])[5] = 'row')),
      /not in the expected form/,
    ],
    ['something that is not an answer', () => 'OK', /not in the expected form/],
  ])('refuses %s instead of returning rows or an empty result', async (_label, respond, message) => {
    const source = answering(SEARCH_URL, respond());
    const failure = grantsGovAdapter.search(filters(ORAL_HEALTH), context(source.http));
    await expect(failure).rejects.toMatchObject({
      code: 'SOURCE_UNAVAILABLE',
      message: expect.stringMatching(message),
    });
    await expect(failure).rejects.toThrow(/^Grants\.gov could not be read: /);
    await expect(failure).rejects.not.toThrow(/apply07/);
    // Nothing is read from a search that cannot be trusted.
    expect(source.calls.filter((call) => call.url === RECORD_URL)).toHaveLength(0);
  });

  it('says so when there are more open listings than one answer can hold', async () => {
    // Built for the test: the source had 1,465 open listings on the day of recording.
    const template = hitsOf(recording('search-oral-health-nonprofit'))[0]!;
    const source = answering(
      SEARCH_URL,
      changed((reply) =>
        Object.assign(reply.data, {
          hitCount: 5001,
          oppHits: Array.from({ length: 5000 }, (_, index) => ({ ...template, id: String(400000 + index) })),
        }),
      )(),
    );
    await expect(grantsGovAdapter.search(filters(ORAL_HEALTH), context(source.http))).rejects.toMatchObject({
      code: 'SOURCE_UNAVAILABLE',
      message: expect.stringMatching(/more open listings for this search than can be read at once\. Add a keyword/),
    });
    expect(source.calls).toHaveLength(1);
  });

  it('keeps hostile text out of a listing', async () => {
    const hidden = String.fromCodePoint(0x202e);
    const source = answering(
      SEARCH_URL,
      changed((reply) => {
        const first = (reply.data.oppHits as Loose[])[0]!;
        first.title = `<img src=x onerror=alert(1)>Free <b>money</b>${hidden} &lt;script&gt;alert(2)&lt;/script&gt;`;
        first.agency = '<a href="javascript:void(0)">Agency</a>';
        first.number = 'N-1\u0000\u0007';
        first.oppStatus = 'constructor';
        first.closeDate = 'soon';
      })(),
    );
    const [first] = await grantsGovAdapter.search(filters(ORAL_HEALTH), context(source.http));
    expect(first).toMatchObject({
      title: 'Free money alert(2)',
      funder: 'Agency',
      number: 'N-1',
      // A status the source does not define is unknown, and a date that cannot be read is not a date.
      status: 'unverified',
      sourceStatus: 'constructor',
      closeDate: null,
      closeDateText: 'soon',
    });
  });
});

describe('Grants.gov listing record', () => {
  const detailOf = async (id: string, now = NOW, item = recording(`detail-${id}`)) =>
    grantsGovAdapter.detail(id, context(answering(RECORD_URL, item.response).http, now));

  it('asks for the record by number and returns its facts and official links', async () => {
    const source = replay([recording('detail-362880')]);
    const detail = await grantsGovAdapter.detail('362880', context(source.http));

    expect(source.calls).toHaveLength(1);
    expect(source.calls[0]).toMatchObject({ url: RECORD_URL, body: { opportunityId: 362880 }, source: 'Grants.gov' });
    expect(detail.opportunity).toMatchObject({
      id: 'grants-gov:362880',
      title: 'Fair Housing Initiatives Program - Education and Outreach Initiative',
      funder: 'Department of Housing and Urban Development',
      number: 'OFH-2600-DC-021A',
      awardFloor: 175000,
      awardCeiling: 2500000,
      totalFunding: 10750000,
      openDate: '2026-07-02',
      closeDate: '2026-11-02',
      closeDateText:
        'Nov 02, 2026. Electronically submitted applications must be submitted no later than 11:59 p.m., ET, on the listed application due date.',
      status: 'active',
      sourceStatus: 'posted',
      categories: ['education'],
      // Coded only "Others": the eligibility text is what says who may apply.
      applicantTypes: ['other'],
      officialUrl: 'https://www.grants.gov/search-results-detail/362880',
    });
    expect(detail.opportunity.applicantNote).toMatch(/^Individuals are ineligible applicants\./);
    expect(detail.description).toMatch(/^Congress in 1988 established the Fair Housing Initiatives Program/);
    expect(detail.facts).toEqual([
      { label: 'Cost sharing or matching required', value: 'No' },
      { label: 'Expected number of awards', value: '34' },
      { label: 'Funding instrument', value: 'Grant' },
      { label: 'Assistance listing numbers', value: '14.416 Education and Outreach Initiatives' },
      { label: 'Funding category at the source', value: 'Education' },
      {
        label: 'Eligible applicants at the source',
        value: 'Others (see text field entitled "Additional Information on Eligibility" for clarification)',
      },
      { label: 'Last updated at the source', value: 'Jul 06, 2026 12:08:59 PM EDT' },
    ]);
    expect(detail.links).toEqual([
      { label: 'Listing on Grants.gov', url: 'https://www.grants.gov/search-results-detail/362880' },
      { label: 'Listing on Simpler.Grants.gov', url: 'https://simpler.grants.gov/opportunity/362880' },
      { label: "Funder's page", url: 'https://www.hud.gov/stat/fheo/initiatives-program' },
    ]);
  });

  it.each<[string, string, number, Opportunity['status'], Opportunity['unverifiedReason']]>([
    ['posted with a deadline ahead', '362880', NOW, 'active', null],
    ['posted with a deadline that has passed', '362880', Date.UTC(2026, 10, 3, 12), 'expired', null],
    ['posted with a deadline that is today in Eastern Time', '362880', Date.UTC(2026, 10, 3, 3), 'active', null],
    ['posted with no deadline, though its text says "accepted year-round"', '279638', NOW, 'unverified', 'no_deadline'],
    ['posted with no deadline, "accepted on a continuing basis"', '332127', NOW, 'unverified', 'no_deadline'],
    ['posted, but its own text says it is archived', '364025', NOW, 'unverified', 'source_contradiction'],
    ['posted with a placeholder deadline of 2099', '355211', NOW, 'unverified', 'implausible_deadline'],
    ['posted with a placeholder deadline and a rolling review', '363786', NOW, 'unverified', 'implausible_deadline'],
    ['a forecast with an estimated deadline ahead', '364022', NOW, 'unverified', 'forecast'],
    ['a forecast whose estimated deadline passed long ago', '355824', NOW, 'expired', null],
    ['closed', '362903', NOW, 'expired', null],
    ['archived', '318269', NOW, 'expired', null],
  ])('reports a listing that is %s as it is', async (_label, id, now, status, unverifiedReason) => {
    const { opportunity } = await detailOf(id, now);
    expect(opportunity).toMatchObject({ id: `grants-gov:${id}`, status, unverifiedReason, fetchedAt: now });
    expect(opportunity.statusReason.length).toBeGreaterThan(10);
  });

  it('keeps the deadline as the source words it, without the padding it adds', async () => {
    // The literal word "undefined" is what the source stores for no explanation.
    expect(partOf(recording('detail-355211'), 'synopsis').responseDateDesc).toBe('undefined');
    expect((await detailOf('355211')).opportunity.closeDateText).toBe('Jan 01, 2099');
    // So is "No Explanation", seen that day on listing 361206 and put here by the test.
    const unexplained = recording('detail-362880');
    partOf(unexplained, 'synopsis').responseDateDesc = 'No Explanation';
    expect((await detailOf('362880', NOW, unexplained)).opportunity.closeDateText).toBe('Nov 02, 2026');
    expect((await detailOf('364025')).opportunity).toMatchObject({
      closeDate: null,
      closeDateText: 'Funding Opportunity is Archived, Proposals are not accepted',
    });
    expect((await detailOf('279638')).opportunity.closeDateText).toMatch(
      /^REAP Applications are accepted year-round\. /,
    );
  });

  it('marks a forecast and its dates as the funder’s estimates', async () => {
    const detail = await detailOf('364022');
    expect(detail.opportunity).toMatchObject({
      sourceStatus: 'forecasted',
      openDate: '2026-10-02',
      closeDate: '2027-03-11',
      awardFloor: 400000,
      awardCeiling: 3000000,
      totalFunding: 5000000,
      categories: ['business_economic_development', 'community_development', 'housing'],
      applicantTypes: ['nonprofit', 'small_business', 'for_profit', 'education'],
    });
    expect(detail.opportunity.closeDateText).toMatch(/^Estimated by the funder: Mar 11, 2027\. /);
    expect(detail.opportunity.statusReason).toMatch(/^Forecast: not open yet/);
    expect(detail.facts).toEqual(
      expect.arrayContaining([
        { label: 'Estimated posting date', value: 'Jan 11, 2027' },
        { label: 'Estimated award date', value: 'Apr 30, 2027' },
        { label: 'Estimated project start date', value: 'May 28, 2027' },
        { label: 'Fiscal year', value: '2026' },
        { label: 'Agency contact', value: 'Distressed Cities Technical Assistance' },
        { label: 'Contact email', value: 'distressedcities@hud.gov' },
      ]),
    );
    // "See email contact" is not a telephone number.
    expect(detail.facts.map((fact) => fact.label)).not.toContain('Contact phone');
  });

  it('reads the synopsis, not the forecast a listing began as', async () => {
    const item = recording('detail-362880');
    expect(dataOf(item)).toHaveProperty('forecast');
    partOf(item, 'forecast').estApplicationResponseDate = 'Jan 01, 2031 12:00:00 AM EST';
    partOf(item, 'forecast').awardCeiling = '1';
    const { opportunity, facts } = await detailOf('362880', NOW, item);
    expect(opportunity).toMatchObject({ closeDate: '2026-11-02', awardCeiling: 2500000, status: 'active' });
    expect(facts.map((fact) => fact.label)).not.toContain('Estimated award date');
  });

  it('names the agency, never a person, as the funder', async () => {
    const item = recording('detail-363482');
    // The source sometimes puts a staff member's name in the synopsis agency
    // field. The fixture has those fields removed; this puts a made-up one back.
    partOf(item, 'synopsis').agencyName = 'Pat Example\nGrantor';
    const detail = await detailOf('363482', NOW, item);
    expect(detail.opportunity.funder).toBe('AmeriCorps');
    expect(detail.opportunity).toMatchObject({
      awardFloor: null,
      awardCeiling: null,
      totalFunding: null,
      status: 'active',
    });
    expect(detail.facts).toContainEqual({ label: 'Cost sharing or matching required', value: 'Yes' });
    expect(detail.links[2]).toEqual({
      label: "Funder's page: Full competition information and resources",
      url: 'https://www.americorps.gov/funding-opportunity/fy-2027-americorps-seniors-rsvp',
    });
  });

  it('gives the agency contact when the source gives one', async () => {
    const detail = await detailOf('359123');
    expect(detail.facts).toEqual(
      expect.arrayContaining([
        {
          label: 'Agency contact',
          value: 'National Institute of Dental and Craniofacial Research (NIDCR), NIDCR-ADAPT@nih.gov',
        },
        { label: 'Contact email', value: 'NIDCR-ADAPT@nih.gov' },
        { label: 'Contact phone', value: '301-402-2541' },
      ]),
    );
    // This record has no page of the funder's own, so only the two official links.
    expect(detail.links).toHaveLength(2);
    expect((await detailOf('362880')).facts.map((fact) => fact.label)).not.toContain('Agency contact');
  });

  it('shows the source’s own category and eligibility wording beside the app’s', async () => {
    const detail = await detailOf('363482');
    expect(detail.opportunity.categories).toEqual([
      'agriculture_food',
      'community_development',
      'disaster_emergency',
      'education',
      'employment_workforce',
      'environment_natural_resources',
      'health',
      'housing',
      'human_services',
      'transportation_infrastructure',
      'other',
    ]);
    const category = detail.facts.find((fact) => fact.label === 'Funding category at the source')!;
    expect(category.value).toMatch(/^Community Development; Consumer Protection; /);
    expect(category.value).toMatch(/; Economic Opportunity, Veterans and Military Families$/);
    const eligible = detail.facts.find((fact) => fact.label === 'Eligible applicants at the source')!;
    expect(eligible.value.split('; ')).toHaveLength(11);
    expect(eligible.value).not.toMatch(/…$/);

    // "Unrestricted" opens the listing to every applicant type.
    expect((await detailOf('318269')).opportunity.applicantTypes).toEqual(Object.keys(APPLICANT_TYPE_LABELS));
  });

  it('returns plain text only, keeping the paragraphs of the description', async () => {
    const raw = String(partOf(recording('detail-332127'), 'synopsis').synopsisDesc);
    expect(raw).toMatch(/<p>|<strong/);
    const detail = await detailOf('332127');
    expect(detail.opportunity.title).toBe('Seattle FY 2021 – FY 2023 EDA Planning and Local Technical Assistance');
    expect(detail.description).toMatch(/^UPDATED NOTICE - PLEASE READ: April 6, 2023\n\nEDA is excited to announce/);
    expect(detail.description).not.toMatch(/[<>]|&[a-z]+;/);
    expect(detail.opportunity.summary).not.toMatch(/[<>\n]|&[a-z]+;/);
    expect(detail.opportunity.applicantNote).toContain('(42 U.S.C. § 3122)');

    // The other entity the shared decoder lacks, seen that day on listing 363381 and put here by the test.
    const dotted = recording('detail-362880');
    partOf(dotted, 'synopsis').applicantEligibilityDesc =
      'Eligible: &middot; nonprofits &amp;middot; tribes (&SECT; 5)';
    expect((await detailOf('362880', NOW, dotted)).opportunity.applicantNote).toBe(
      'Eligible: · nonprofits · tribes (§ 5)',
    );
  });

  it('keeps hostile content in a record out of the listing', async () => {
    const item = recording('detail-362880');
    const synopsis = partOf(item, 'synopsis');
    synopsis.synopsisDesc =
      '<script>steal()</script><p onclick="x()">Real <i>text</i></p><style>p{}</style><p>Second</p>';
    synopsis.fundingDescLinkUrl = 'javascript:alert(document.cookie)';
    synopsis.applicantTypes = [
      { id: 'constructor' },
      { id: '__proto__' },
      { id: '77', description: '<b>New type</b>' },
    ];
    synopsis.fundingActivityCategories = [{ id: 'toString', description: 'Odd' }, 'HL', null];
    synopsis.awardCeiling = { amount: 5 };
    synopsis.numberOfAwards = '<img src=x>12';
    const detail = await detailOf('362880', NOW, item);

    expect(detail.description).toBe('Real text\n\nSecond');
    expect(detail.opportunity.summary).toBe('Real text Second');
    expect(detail.links.map((link) => link.url)).toEqual([
      'https://www.grants.gov/search-results-detail/362880',
      'https://simpler.grants.gov/opportunity/362880',
    ]);
    // Codes the tables do not hold are "other", whatever they are called.
    expect(detail.opportunity.applicantTypes).toEqual(['other']);
    expect(detail.opportunity.categories).toEqual(['other']);
    expect(detail.opportunity.awardCeiling).toBeNull();
    expect(detail.facts).toContainEqual({ label: 'Expected number of awards', value: '12' });
    expect(JSON.stringify(detail)).not.toMatch(/<|javascript:/);

    for (const address of [
      'https://user:secret@example.org/',
      'file:///etc/passwd',
      'www.hud.gov/grants',
      'not a link',
    ]) {
      synopsis.fundingDescLinkUrl = address;
      expect((await detailOf('362880', NOW, item)).links).toHaveLength(2);
    }
    // A description that is itself an address is not used as the label of another address.
    synopsis.fundingDescLinkUrl = 'https://example.org/program';
    synopsis.fundingDescLinkDesc = 'https://www.hud.gov/';
    expect((await detailOf('362880', NOW, item)).links[2]).toEqual({
      label: "Funder's page",
      url: 'https://example.org/program',
    });
  });

  it.each([
    ['Funding Opportunity is Archived, Proposals are not accepted', true],
    ['This opportunity has been cancelled.', true],
    ['This opportunity has been cancelled. If you applied, you will be told.', true],
    ['It will remain open until it is cancelled or superseded by a new announcement.', false],
    ['If the program is terminated, applicants will be notified.', false],
    ['The announcement was withdrawn on September 1. A new one will follow.', true],
    ['We are no longer accepting applications for this program.', true],
    ['Applications are no longer being accepted.', true],
    ['This opportunity is no longer available.', true],
    ['Paper applications are no longer accepted.', false],
    ['That is the date the opportunity closes and applications can no longer be accepted.', false],
    ['The agency is not accepting applications at this time.', true],
    ['Applications are not accepted until the portal opens in January.', true],
    ['Late applications are not accepted.', false],
    ['Paper applications are not accepted; apply through the portal.', false],
    ['Applications will not be accepted after 5:00 p.m. ET on the due date.', false],
    ['Applications are not accepted unless they are submitted electronically.', false],
    ['An archived recording of the applicant webinar is available.', false],
    ['The deadline for the first round closed on August 31. Applications are reviewed on a rolling basis.', false],
    ['Electronically submitted applications must be submitted no later than 11:59 p.m., ET.', false],
  ])('reads the deadline note %j (says the listing is shut: %s)', async (note, shut) => {
    // The recorded note is replaced by wording made up for the test.
    const item = recording('detail-362880');
    partOf(item, 'synopsis').responseDateDesc = note;
    const { opportunity } = await detailOf('362880', NOW, item);
    expect(opportunity.status).toBe(shut ? 'unverified' : 'active');
    expect(opportunity.unverifiedReason).toBe(shut ? 'source_contradiction' : null);
  });

  it('finds no such wording in any of the recorded listings but the archived one', async () => {
    for (const id of ['359123', '362880', '363482', '363786', '279638', '332127', '355211', '362903', '318269']) {
      expect((await detailOf(id)).opportunity.unverifiedReason).not.toBe('source_contradiction');
    }
  });

  it('does not mistake a note about what happens at the deadline for a closed listing', async () => {
    // A real note: "…that is the date that the funding opportunity closes and
    // applications can no longer be accepted." The listing was open.
    const { opportunity } = await detailOf('362893');
    expect(opportunity.closeDateText).toContain('applications can no longer be accepted');
    expect(opportunity).toMatchObject({
      status: 'active',
      unverifiedReason: null,
      closeDate: '2026-12-16',
      awardFloor: 5000,
      awardCeiling: 150000,
      totalFunding: 4084000,
      applicantTypes: ['state_government', 'other'],
      categories: ['environment_natural_resources'],
    });
  });
});

describe('Grants.gov listing record guards', () => {
  const answerTo = (id: string, response: unknown) => {
    const source = answering(RECORD_URL, response);
    return { source, failure: grantsGovAdapter.detail(id, context(source.http)) };
  };

  it('reports an id the source does not have as not found, whatever the HTTP status said', async () => {
    const unknown = recording('detail-unknown-id');
    // Recorded with status 200 and a success code; only the missing id and the error list say otherwise.
    expect(unknown.response).toMatchObject({
      errorcode: 0,
      data: { errorMessages: ['There is no record found for your search.'] },
    });
    expect(dataOf(unknown)).not.toHaveProperty('id');
    const source = replay([unknown]);
    const failure = grantsGovAdapter.detail('999999999', context(source.http));
    await expect(failure).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Grants.gov has no listing with that reference. It may have been withdrawn.',
    });
    expect(source.calls[0]!.body).toEqual(unknown.request.body);
  });

  it('reports the source’s own outage as unavailable, without repeating its internal address', async () => {
    const outage = recording('detail-backend-unavailable');
    expect(JSON.stringify(outage.response)).toContain('apply07.grants.gov');
    const { failure } = answerTo('362880', outage.response);
    await expect(failure).rejects.toMatchObject({
      code: 'SOURCE_UNAVAILABLE',
      message: 'Grants.gov could not be read: it did not return the listing.',
    });
    await expect(failure).rejects.not.toThrow(/apply07|grantsws|https?:/);
  });

  it.each<[string, () => unknown, RegExp]>([
    [
      'another listing than the one asked for',
      () => recording('detail-359123').response,
      /returned a different listing/,
    ],
    [
      'a record that comes with an error list',
      () => {
        const item = recording('detail-362880');
        dataOf(item).errorMessages = ['Partial data'];
        return item.response;
      },
      /reported a problem with the listing/,
    ],
    [
      'a record with no title',
      () => {
        const item = recording('detail-362880');
        dataOf(item).opportunityTitle = '';
        return item.response;
      },
      /not in the expected form/,
    ],
    [
      'a record with neither a synopsis nor a forecast',
      () => {
        const item = recording('detail-362880');
        delete dataOf(item).synopsis;
        delete dataOf(item).forecast;
        return item.response;
      },
      /not in the expected form/,
    ],
    ['an answer with no data', () => ({ errorcode: 0, msg: 'Webservice Succeeds' }), /not in the expected form/],
    ['an answer that is a list', () => [], /not in the expected form/],
  ])('refuses %s', async (_label, respond, message) => {
    const { failure } = answerTo('362880', respond());
    await expect(failure).rejects.toMatchObject({
      code: 'SOURCE_UNAVAILABLE',
      message: expect.stringMatching(message),
    });
    await expect(failure).rejects.toThrow(/^Grants\.gov could not be read: /);
  });

  it('refuses a reference that is not a record number before asking the source', async () => {
    for (const id of [
      '',
      'abc',
      '12 ',
      ' 12',
      '../362880',
      '362880/..',
      '0123',
      '1e5',
      '-5',
      '12.5',
      '9'.repeat(13),
      '%33',
    ]) {
      const { source, failure } = answerTo(id, recording('detail-362880').response);
      await expect(failure).rejects.toMatchObject({
        code: 'INVALID_INPUT',
        message: 'That listing reference is not valid.',
      });
      expect(source.calls).toHaveLength(0);
    }
  });

  it('passes a cancellation on as a cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const source = replay([recording('detail-362880')]);
    await expect(grantsGovAdapter.detail('362880', context(source.http, NOW, controller.signal))).rejects.toMatchObject(
      {
        code: 'CANCELLED',
      },
    );
  });
});

describe('Grants.gov code tables', () => {
  // Both lists are the source's own, read from its all-status facets on 6 October 2026.
  const ELIGIBILITY = [
    '00',
    '01',
    '02',
    '04',
    '05',
    '06',
    '07',
    '08',
    '11',
    '12',
    '13',
    '20',
    '21',
    '22',
    '23',
    '25',
    '99',
  ];
  const CATEGORIES = [
    'ACA',
    'AG',
    'AR',
    'BC',
    'CD',
    'CP',
    'DPR',
    'ED',
    'EIC',
    'ELT',
    'EN',
    'ENV',
    'FN',
    'HL',
    'HO',
    'HU',
    'IIJ',
    'IS',
    'ISS',
    'LJL',
    'NR',
    'O',
    'OZ',
    'RA',
    'RD',
    'RT',
    'ST',
    'T',
  ];
  const applicantTypes = Object.keys(APPLICANT_TYPE_LABELS);
  const categories = Object.keys(FUNDING_CATEGORY_LABELS);

  it('accounts for every eligibility code, and reaches every applicant type', () => {
    expect(Object.keys(ELIGIBILITY_CODES).sort()).toEqual(ELIGIBILITY);
    for (const types of Object.values(ELIGIBILITY_CODES)) {
      expect(types.length).toBeGreaterThan(0);
      for (const type of types) expect(applicantTypes).toContain(type);
    }
    for (const type of applicantTypes) {
      expect(
        Object.values(ELIGIBILITY_CODES).filter((types) => types.includes(type as ApplicantType)).length,
      ).toBeGreaterThan(1);
    }
    expect(ELIGIBILITY_CODES['99']).toEqual(applicantTypes);
    expect(ELIGIBILITY_CODES['25']).toEqual(['other']);
  });

  it('accounts for every funding category code, and reaches every category', () => {
    expect(Object.keys(CATEGORY_CODES).sort()).toEqual([...CATEGORIES].sort());
    for (const mapped of Object.values(CATEGORY_CODES)) {
      expect(mapped.length).toBeGreaterThan(0);
      for (const category of mapped) expect(categories).toContain(category);
    }
    for (const category of categories) {
      expect(Object.values(CATEGORY_CODES).some((mapped) => mapped.includes(category as FundingCategory))).toBe(true);
    }
  });

  it('knows every code that appears in the recorded listings', () => {
    const seen = { eligibility: new Set<string>(), category: new Set<string>() };
    for (const id of [
      '359123',
      '362880',
      '363482',
      '364025',
      '363786',
      '279638',
      '332127',
      '355211',
      '355824',
      '364022',
      '362903',
      '318269',
      '362893',
    ]) {
      const data = dataOf(recording(`detail-${id}`));
      const part = (data.synopsis ?? data.forecast) as Loose;
      for (const item of part.applicantTypes as { id: string }[]) seen.eligibility.add(item.id);
      for (const item of part.fundingActivityCategories as { id: string }[]) seen.category.add(item.id);
    }
    expect(seen.eligibility.size).toBeGreaterThan(12);
    expect(seen.category.size).toBeGreaterThan(12);
    for (const code of seen.eligibility) expect(ELIGIBILITY_CODES).toHaveProperty(code);
    for (const code of seen.category) expect(CATEGORY_CODES).toHaveProperty(code);
  });
});
