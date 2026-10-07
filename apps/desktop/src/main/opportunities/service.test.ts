import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_OPPORTUNITY_FILTERS,
  type FundingSourceInfo,
  type Opportunity,
  type OpportunityDetail,
  type OpportunityFilters,
} from '../../shared/funding.js';
import { FundingError } from '../funding/errors.js';
import type { HttpClient } from './http.js';
import type { ProfileTerm } from './match.js';
import { MAX_RESULTS, OpportunityService } from './service.js';
import { STALE_AFTER_MS } from './status.js';
import type { SourceAdapter, SourceContext } from './types.js';

/** Noon UTC on 6 October 2026. */
const NOON = Date.UTC(2026, 9, 6, 12, 0, 0);
const MINUTE = 60 * 1000;
const HOME = { country: 'US', region: 'NJ', county: 'Essex', city: 'Newark' };

// The service only hands the client on; no test here may reach the network.
const http: HttpClient = {
  json: () => Promise.reject(new Error('The service itself never makes a request.')),
  text: () => Promise.reject(new Error('The service itself never makes a request.')),
};

function listing(sourceId: string, record: string, patch: Partial<Opportunity> = {}): Opportunity {
  return {
    id: `${sourceId}:${record}`,
    sourceId,
    sourceName: sourceId,
    funder: 'Department of Examples',
    kind: 'grant',
    level: 'federal',
    country: 'US',
    region: '',
    jurisdiction: 'United States',
    geographyNote: '',
    title: `Listing ${record}`,
    summary: '',
    number: record,
    applicantTypes: [],
    applicantNote: '',
    categories: [],
    awardFloor: null,
    awardCeiling: null,
    totalFunding: null,
    currency: 'USD',
    openDate: '2026-09-01',
    closeDate: '2026-11-15',
    closeDateText: '',
    status: 'active',
    statusReason: 'Open at the source.',
    unverifiedReason: null,
    sourceStatus: 'open',
    officialUrl: `https://example.gov/${record}`,
    fetchedAt: NOON,
    match: null,
    ...patch,
  };
}

type Search = (filters: OpportunityFilters, context: SourceContext) => Promise<Opportunity[]> | Opportunity[];
type Detail = (recordId: string, context: SourceContext) => Promise<OpportunityDetail> | OpportunityDetail;

interface FakeSource extends SourceAdapter {
  searches: { filters: OpportunityFilters; context: SourceContext }[];
  details: { recordId: string; context: SourceContext }[];
}

function source(
  id: string,
  options: { info?: Partial<FundingSourceInfo>; search?: Search; detail?: Detail } = {},
): FakeSource {
  const fake: FakeSource = {
    info: {
      id,
      name: `${id} name`,
      operator: 'Operator',
      level: 'federal',
      jurisdiction: 'United States',
      coverage: { country: 'US', region: '', county: '', city: '' },
      kinds: ['grant'],
      homepageUrl: 'https://example.gov',
      attribution: '',
      note: '',
      ...options.info,
    },
    searches: [],
    details: [],
    async search(filters, context) {
      fake.searches.push({ filters, context });
      return options.search ? options.search(filters, context) : [listing(id, '1')];
    },
    async detail(recordId, context) {
      fake.details.push({ recordId, context });
      if (options.detail) return options.detail(recordId, context);
      return { opportunity: listing(id, recordId), description: 'Longer text.', facts: [], links: [] };
    },
  };
  return fake;
}

const filters = (patch: Partial<OpportunityFilters> = {}): OpportunityFilters => ({
  ...DEFAULT_OPPORTUNITY_FILTERS,
  ...patch,
});

function serviceOf(adapters: SourceAdapter[], clock: { now: number } = { now: NOON }) {
  return new OpportunityService({ adapters, http, now: () => clock.now });
}

const ask = (
  service: OpportunityService,
  patch: Partial<OpportunityFilters> = {},
  more: { organization?: typeof HOME; profileTerms?: ProfileTerm[]; signal?: AbortSignal } = {},
) =>
  service.search({
    filters: filters(patch),
    organization: more.organization ?? HOME,
    profileTerms: more.profileTerms ?? [],
    signal: more.signal ?? new AbortController().signal,
  });

const ids = (listings: Opportunity[]) => listings.map((item) => item.id);
const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('OpportunityService', () => {
  it('lists the sources it was given, in order', () => {
    const service = serviceOf([source('grants-gov'), source('ca-grants', { info: { level: 'state' } })]);
    expect(service.sources().map((info) => [info.id, info.level])).toEqual([
      ['grants-gov', 'federal'],
      ['ca-grants', 'state'],
    ]);
  });

  it('refuses to start with source ids that could not tell two listings apart', () => {
    expect(() => serviceOf([source('grants-gov'), source('grants-gov')])).toThrow(/"grants-gov" is repeated/);
    // A colon would split a listing id in the wrong place; filters could not name the others.
    for (const id of ['state:ca', '', 'x', 'two words', '../up', 'ca_grants', 'x'.repeat(41)]) {
      expect(() => serviceOf([source(id)])).toThrow(/not a plain name/);
    }
    expect(() => serviceOf([source('ca-grants-2')])).not.toThrow();
  });
});

describe('searching', () => {
  it('asks each source with the filters and returns their listings with a report on each', async () => {
    const federal = source('grants-gov', { search: () => [listing('grants-gov', '1'), listing('grants-gov', '2')] });
    const state = source('nj-grants', {
      info: {
        level: 'state',
        jurisdiction: 'New Jersey',
        coverage: { country: 'US', region: 'NJ', county: '', city: '' },
      },
      search: () => [listing('nj-grants', '7', { level: 'state', region: 'NJ', jurisdiction: 'New Jersey' })],
    });
    const controller = new AbortController();
    const result = await ask(serviceOf([federal, state]), { query: '  Listing ' }, { signal: controller.signal });

    expect(ids(result.opportunities).sort()).toEqual(['grants-gov:1', 'grants-gov:2', 'nj-grants:7']);
    expect(result).toMatchObject({ truncated: false, searchedAt: NOON });
    expect(result.reports).toEqual([
      {
        sourceId: 'grants-gov',
        sourceName: 'grants-gov name',
        state: 'ok',
        received: 2,
        matched: 2,
        fetchedAt: NOON,
        durationMs: 0,
        message: '',
      },
      {
        sourceId: 'nj-grants',
        sourceName: 'nj-grants name',
        state: 'ok',
        received: 1,
        matched: 1,
        fetchedAt: NOON,
        durationMs: 0,
        message: '',
      },
    ]);
    // Each source gets tidied filters, the shared client, the time and the caller's signal.
    expect(federal.searches).toHaveLength(1);
    expect(federal.searches[0]!.filters).toEqual(filters({ query: 'Listing' }));
    expect(federal.searches[0]!.context).toEqual({ http, now: NOON, signal: controller.signal });
    expect(federal.searches[0]!.context.http).toBe(http);
  });

  it('applies every filter again on the device, whatever a source returned', async () => {
    const careless = source('careless', {
      search: () => [
        listing('careless', 'match', { categories: ['housing'], awardCeiling: 80000 }),
        listing('careless', 'other-category', { categories: ['energy'] }),
        listing('careless', 'too-small', { categories: ['housing'], awardCeiling: 2000 }),
        listing('careless', 'expired', { categories: ['housing'], status: 'expired' }),
        listing('careless', 'forecast', {
          categories: ['housing'],
          status: 'unverified',
          unverifiedReason: 'forecast',
        }),
        listing('careless', 'contract', { categories: ['housing'], kind: 'contract_solicitation' }),
      ],
    });
    const result = await ask(serviceOf([careless]), {
      categories: ['housing'],
      kinds: ['grant'],
      amountMin: 50000,
      includeAmountNotStated: false,
    });
    expect(ids(result.opportunities)).toEqual(['careless:match']);
    expect(result.reports[0]).toMatchObject({ state: 'ok', received: 6, matched: 1 });
  });

  it('never passes on "active" for a listing whose deadline has passed or whose check is a day old', async () => {
    const hopeful = source('hopeful', {
      search: () => [
        listing('hopeful', 'fresh'),
        listing('hopeful', 'passed', { closeDate: '2026-09-30' }),
        listing('hopeful', 'stale', { fetchedAt: NOON - STALE_AFTER_MS - MINUTE }),
      ],
    });
    const service = serviceOf([hopeful]);
    expect(ids((await ask(service)).opportunities)).toEqual(['hopeful:fresh']);

    const everything = await ask(service, { statuses: [] });
    expect(everything.opportunities.map((item) => [item.id, item.status, item.unverifiedReason])).toEqual([
      ['hopeful:fresh', 'active', null],
      ['hopeful:stale', 'unverified', 'stale'],
      ['hopeful:passed', 'expired', null],
    ]);
  });

  it('keeps answering when one source fails, and says which and why', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const down = source('down', {
      search: () => {
        throw new FundingError('SOURCE_UNAVAILABLE', 'Down Grants could not be read: it answered with status 503.');
      },
    });
    const broken = source('broken', {
      search: () => {
        throw new TypeError("Cannot read properties of undefined (reading 'rows') at /Users/dev/adapter.ts:12");
      },
    });
    const notAList = source('not-a-list', { search: () => ({ rows: [] }) as unknown as Opportunity[] });
    const impostor = source('impostor', { search: () => [listing('grants-gov', '99')] });
    const malformed = source('malformed', { search: () => [null as unknown as Opportunity] });
    const untitled = source('untitled', {
      search: () => [{ ...listing('untitled', '1'), title: undefined } as unknown as Opportunity],
    });
    const cancelsItself = source('cancels', {
      search: () => {
        throw new FundingError('CANCELLED', 'Cancelled.');
      },
    });
    const good = source('grants-gov', { search: () => [listing('grants-gov', '1')] });

    const result = await ask(serviceOf([down, broken, notAList, impostor, malformed, untitled, cancelsItself, good]));

    expect(ids(result.opportunities)).toEqual(['grants-gov:1']);
    expect(result.reports.map((report) => [report.sourceId, report.state, report.message])).toEqual([
      ['down', 'failed', 'Down Grants could not be read: it answered with status 503.'],
      ['broken', 'failed', 'broken name could not be read. Try again in a moment.'],
      ['not-a-list', 'failed', 'not-a-list name returned listings the app could not read.'],
      ['impostor', 'failed', 'impostor name returned listings the app could not read.'],
      ['malformed', 'failed', 'malformed name returned listings the app could not read.'],
      ['untitled', 'failed', 'untitled name returned listings the app could not read.'],
      ['cancels', 'failed', 'cancels name could not be read. Try again in a moment.'],
      ['grants-gov', 'ok', ''],
    ]);
    for (const report of result.reports.slice(0, 7)) expect(report).toMatchObject({ received: 0, matched: 0 });
    // The unexpected error is logged for the developer and kept away from the user.
    expect(JSON.stringify(result)).not.toMatch(/undefined|adapter\.ts|Users/);
    expect(quiet).toHaveBeenCalledTimes(1);
    quiet.mockRestore();
  });

  it('fails only the source whose listings cannot be filtered', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Enough of a listing to be accepted, and too little to be filtered.
    const half = source('half', {
      search: () => [{ id: 'half:1', sourceId: 'half', title: 'Half a listing' } as Opportunity],
    });
    const result = await ask(serviceOf([half, source('grants-gov')]), { query: 'listing' });
    expect(ids(result.opportunities)).toEqual(['grants-gov:1']);
    expect(quiet).toHaveBeenCalledTimes(1);
    expect(result.reports[0]).toMatchObject({
      state: 'failed',
      message: 'half name could not be read. Try again in a moment.',
    });
    quiet.mockRestore();
  });

  it('skips a source that has nothing to add, with a plain reason, and does not ask it', async () => {
    const federal = source('grants-gov');
    const california = source('ca-grants', {
      info: {
        level: 'state',
        jurisdiction: 'California',
        coverage: { country: 'US', region: 'CA', county: '', city: '' },
      },
    });
    const newJersey = source('nj-grants', {
      info: {
        level: 'state',
        jurisdiction: 'New Jersey',
        coverage: { country: 'US', region: 'NJ', county: '', city: '' },
      },
    });
    const hudson = source('hudson', {
      info: {
        level: 'county',
        jurisdiction: 'Hudson County',
        coverage: { country: 'US', region: 'NJ', county: 'Hudson', city: '' },
      },
    });
    const newark = source('newark', {
      info: {
        level: 'city',
        jurisdiction: 'City of Newark',
        coverage: { country: 'US', region: 'NJ', county: 'Essex', city: 'Newark' },
      },
    });
    const europe = source('eu-funding', {
      info: {
        level: 'international',
        jurisdiction: 'European Union',
        coverage: { country: '', region: '', county: '', city: '' },
      },
    });
    const bids = source('nj-bids', {
      info: {
        level: 'state',
        jurisdiction: 'New Jersey',
        kinds: ['contract_solicitation'],
        coverage: { country: 'US', region: 'NJ', county: '', city: '' },
      },
    });
    const all = [federal, california, newJersey, hudson, newark, europe, bids];
    const states = async (patch: Partial<OpportunityFilters>, organization = HOME) => {
      for (const fake of all) fake.searches.length = 0;
      const result = await ask(serviceOf(all), patch, { organization });
      // A skipped source is never asked, and every other source is.
      for (const fake of all) {
        const report = result.reports.find((item) => item.sourceId === fake.info.id)!;
        expect(fake.searches).toHaveLength(report.state === 'skipped' ? 0 : 1);
      }
      return Object.fromEntries(
        result.reports.map((report) => [report.sourceId, report.state === 'skipped' ? report.message : report.state]),
      );
    };

    const place = { country: 'US', region: 'NJ', county: 'Essex', city: 'Newark' };
    expect(await states({ place, kinds: ['grant'] })).toEqual({
      'grants-gov': 'ok',
      'ca-grants': 'Not searched: it covers California only.',
      'nj-grants': 'ok',
      hudson: 'Not searched: it covers Hudson County only.',
      newark: 'ok',
      'eu-funding': 'ok',
      'nj-bids': 'Not searched: it lists contract solicitations only.',
    });

    expect(await states({ levels: ['state', 'city'] })).toMatchObject({
      'grants-gov':
        'Not searched: it lists federal funding, and this search is limited to statewide and citywide funding.',
      'ca-grants': 'ok',
      hudson:
        'Not searched: it lists countywide funding, and this search is limited to statewide and citywide funding.',
      newark: 'ok',
      'eu-funding':
        'Not searched: it lists international funding, and this search is limited to statewide and citywide funding.',
    });

    expect(await states({ sourceIds: ['newark', 'grants-gov'] })).toEqual({
      'grants-gov': 'ok',
      'ca-grants': 'Not chosen for this search.',
      'nj-grants': 'Not chosen for this search.',
      hudson: 'Not chosen for this search.',
      newark: 'ok',
      'eu-funding': 'Not chosen for this search.',
      'nj-bids': 'Not chosen for this search.',
    });

    // To an organization in Canada every one of these is international.
    expect(
      await states({ levels: ['international'] }, { country: 'CA', region: 'ON', county: '', city: 'Toronto' }),
    ).toEqual({
      'grants-gov': 'ok',
      'ca-grants': 'ok',
      'nj-grants': 'ok',
      hudson: 'ok',
      newark: 'ok',
      'eu-funding': 'ok',
      'nj-bids': 'ok',
    });
    expect(
      (await states({ levels: ['federal'] }, { country: 'CA', region: 'ON', county: '', city: 'Toronto' }))[
        'grants-gov'
      ],
    ).toBe('Not searched: it lists international funding, and this search is limited to federal funding.');
  });

  it('reports a skipped source with nothing received, and still returns the rest', async () => {
    const result = await ask(serviceOf([source('grants-gov'), source('other')]), { sourceIds: ['other'] });
    expect(ids(result.opportunities)).toEqual(['other:1']);
    expect(result.reports[0]).toEqual({
      sourceId: 'grants-gov',
      sourceName: 'grants-gov name',
      state: 'skipped',
      received: 0,
      matched: 0,
      fetchedAt: NOON,
      durationMs: 0,
      message: 'Not chosen for this search.',
    });
  });

  it('asks at most four sources at once', async () => {
    let inFlight = 0;
    let mostAtOnce = 0;
    const slow = (id: string) =>
      source(id, {
        search: async () => {
          inFlight += 1;
          mostAtOnce = Math.max(mostAtOnce, inFlight);
          await tick();
          await tick();
          inFlight -= 1;
          return [listing(id, '1')];
        },
      });
    const adapters = Array.from({ length: 11 }, (_, index) => slow(`source-${index}`));
    const result = await ask(serviceOf(adapters));
    expect(result.opportunities).toHaveLength(11);
    expect(result.reports.map((report) => report.sourceId)).toEqual(adapters.map((adapter) => adapter.info.id));
    expect(mostAtOnce).toBe(4);
  });

  it('describes each listing’s overlap with the approved profile, or says nothing without one', async () => {
    const federal = source('grants-gov', {
      search: () => [
        listing('grants-gov', '1', {
          title: 'Youth workforce training',
          match: { score: 3, sharedTerms: ['stale'], fields: [] },
        }),
        listing('grants-gov', '2', { title: 'Marine research' }),
      ],
    });
    const service = serviceOf([federal]);
    const withProfile = await ask(
      service,
      {},
      {
        profileTerms: [
          { term: 'workforce training', field: 'programs' },
          { term: 'youth', field: 'populations_served' },
        ],
      },
    );
    expect(withProfile.opportunities.map((item) => [item.id, item.match])).toEqual([
      [
        'grants-gov:1',
        { score: 100, sharedTerms: ['workforce training', 'youth'], fields: ['populations_served', 'programs'] },
      ],
      ['grants-gov:2', { score: 0, sharedTerms: [], fields: [] }],
    ]);
    // The same answer from the source, compared with no profile: no match at all.
    const without = await ask(service);
    expect(without.opportunities.map((item) => item.match)).toEqual([null, null]);
    expect(federal.searches).toHaveLength(1);
  });

  it('orders active listings first, then by match, then by nearest deadline, then by title', async () => {
    const mixed = source('mixed', {
      search: () => [
        listing('mixed', 'expired-older', { title: 'Housing for youth', status: 'expired', closeDate: '2026-09-01' }),
        listing('mixed', 'no-deadline', { title: 'Housing counsel', closeDate: null }),
        listing('mixed', 'later', { title: 'Housing repair', closeDate: '2026-10-20' }),
        listing('mixed', 'forecast', {
          title: 'Housing for youth',
          status: 'unverified',
          unverifiedReason: 'forecast',
          closeDate: null,
        }),
        listing('mixed', 'sooner-v', { title: 'Housing vouchers', closeDate: '2026-10-10' }),
        listing('mixed', 'expired-recent', { title: 'Housing for youth', status: 'expired', closeDate: '2026-10-01' }),
        listing('mixed', 'best', { title: 'Housing for youth', closeDate: '2026-12-01' }),
        listing('mixed', 'sooner-a', { title: 'housing aid', closeDate: '2026-10-10' }),
        listing('mixed', 'no-overlap', { title: 'Fisheries', closeDate: '2026-10-07' }),
      ],
    });
    const result = await ask(
      serviceOf([mixed]),
      { statuses: [] },
      {
        profileTerms: [
          { term: 'housing', field: 'programs' },
          { term: 'youth', field: 'populations_served' },
        ],
      },
    );
    expect(ids(result.opportunities)).toEqual([
      'mixed:best',
      'mixed:sooner-a',
      'mixed:sooner-v',
      'mixed:later',
      'mixed:no-deadline',
      'mixed:no-overlap',
      'mixed:forecast',
      'mixed:expired-recent',
      'mixed:expired-older',
    ]);
  });

  it(`returns at most ${MAX_RESULTS} listings and says when more matched`, async () => {
    const many = (count: number) =>
      source('many', {
        search: () =>
          Array.from({ length: count }, (_, index) =>
            listing('many', String(index + 1), { title: `Listing ${String(index + 1).padStart(4, '0')}` }),
          ),
      });
    const over = await ask(serviceOf([many(250), source('other')]));
    expect(over.opportunities).toHaveLength(200);
    expect(over.truncated).toBe(true);
    // The report still counts everything that matched.
    expect(over.reports[0]).toMatchObject({ received: 250, matched: 250 });
    expect(over.opportunities[0]!.title).toBe('Listing 0001');

    const exact = await ask(serviceOf([many(200)]));
    expect(exact.opportunities).toHaveLength(200);
    expect(exact.truncated).toBe(false);
  });

  it('counts a listing a source returned twice only once', async () => {
    const repeats = source('repeats', {
      search: () => [listing('repeats', '1'), listing('repeats', '2'), listing('repeats', '1', { title: 'Again' })],
    });
    const result = await ask(serviceOf([repeats]));
    expect(ids(result.opportunities)).toEqual(['repeats:1', 'repeats:2']);
    expect(result.opportunities[0]!.title).toBe('Listing 1');
    expect(result.reports[0]).toMatchObject({ received: 2, matched: 2 });
  });

  it('refuses filters it cannot read, before asking any source', async () => {
    const federal = source('grants-gov');
    const service = serviceOf([federal]);
    const search = (bad: unknown) =>
      service.search({
        filters: bad as OpportunityFilters,
        organization: HOME,
        profileTerms: [],
        signal: new AbortController().signal,
      });
    await expect(search({ statuses: ['Active'] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(search(null)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(search({ amountMin: 9, amountMax: 1 })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringMatching(/smallest award amount is larger/),
    });
    expect(federal.searches).toHaveLength(0);
  });
});

describe('repeating a search', () => {
  it('does not ask a source again for the same search within fifteen minutes', async () => {
    const clock = { now: NOON };
    let answer = 0;
    const federal = source('grants-gov', {
      search: () => {
        answer += 1;
        return [listing('grants-gov', '1', { title: `Answer ${answer}`, fetchedAt: clock.now })];
      },
    });
    const service = serviceOf([federal], clock);

    const first = await ask(service, { query: 'answer', categories: ['health', 'housing'] });
    clock.now = NOON + 14 * MINUTE;
    const again = await ask(service, { query: ' ANSWER ', categories: ['housing', 'health'] });
    expect(federal.searches).toHaveLength(1);
    expect(again.opportunities[0]).toMatchObject({ title: 'Answer 1', fetchedAt: NOON });
    // The report says when the source was actually read.
    expect(again.reports[0]).toMatchObject({ state: 'ok', received: 1, matched: 1, fetchedAt: NOON });
    expect(again.searchedAt).toBe(NOON + 14 * MINUTE);
    expect(first.reports[0]!.fetchedAt).toBe(NOON);

    clock.now = NOON + 15 * MINUTE;
    const later = await ask(service, { query: 'answer', categories: ['health', 'housing'] });
    expect(federal.searches).toHaveLength(2);
    expect(later.opportunities[0]).toMatchObject({ title: 'Answer 2', fetchedAt: NOON + 15 * MINUTE });

    // A different search is a different question.
    await ask(service, { query: 'answer' });
    expect(federal.searches).toHaveLength(3);
  });

  it('goes on ageing a listing it remembers', async () => {
    // 23:55 on 5 October in the last time zone on Earth, five minutes before the deadline day ends everywhere.
    const clock = { now: Date.UTC(2026, 9, 6, 11, 55, 0) };
    const federal = source('grants-gov', {
      search: () => [listing('grants-gov', '1', { closeDate: '2026-10-05', fetchedAt: clock.now })],
    });
    const service = serviceOf([federal], clock);
    expect(ids((await ask(service)).opportunities)).toEqual(['grants-gov:1']);

    clock.now += 10 * MINUTE;
    const afterMidnight = await ask(service);
    expect(federal.searches).toHaveLength(1);
    expect(afterMidnight.opportunities).toEqual([]);
    expect(afterMidnight.reports[0]).toMatchObject({ state: 'ok', received: 1, matched: 0 });
    const shown = await ask(service, { statuses: ['expired'] });
    expect(shown.opportunities[0]).toMatchObject({
      status: 'expired',
      statusReason: 'The deadline passed on October 5, 2026.',
    });
  });

  it('does not close a listing early for a source whose day has not ended', async () => {
    // 03:00 UTC on 7 October is still 6 October in New York.
    const clock = { now: Date.UTC(2026, 9, 7, 3, 0, 0) };
    const federal = source('grants-gov', {
      search: () => [listing('grants-gov', '1', { closeDate: '2026-10-06', fetchedAt: clock.now })],
    });
    expect(ids((await ask(serviceOf([federal], clock))).opportunities)).toEqual(['grants-gov:1']);
  });

  it('ages a listing in its source’s own time zone when the source names one', async () => {
    // 23:55 on 6 October in New York; the deadline day ends there in five minutes.
    const clock = { now: Date.UTC(2026, 9, 7, 3, 55, 0) };
    const eastern = Object.assign(
      source('grants-gov', {
        search: () => [listing('grants-gov', '1', { closeDate: '2026-10-06', fetchedAt: clock.now })],
      }),
      { timeZone: 'America/New_York' },
    );
    const service = serviceOf([eastern], clock);
    expect(ids((await ask(service)).opportunities)).toEqual(['grants-gov:1']);

    clock.now += 10 * MINUTE;
    expect((await ask(service)).opportunities).toEqual([]);
    expect(eastern.searches).toHaveLength(1);
  });

  it('tells whoever keeps a listing which time zone to age it in', () => {
    const named = Object.assign(source('grants-gov'), { timeZone: 'America/New_York' });
    const unnamed = source('eu-funding');
    const misnamed = Object.assign(source('typo'), { timeZone: 'Mars/Olympus_Mons' });
    const service = serviceOf([named, unnamed, misnamed]);
    expect(service.timeZoneFor(listing('grants-gov', '1'))).toBe('America/New_York');
    // Without a zone the deadline must have passed everywhere before it counts as passed.
    expect(service.timeZoneFor(listing('eu-funding', '1'))).toBe('Etc/GMT+12');
    expect(service.timeZoneFor(listing('typo', '1'))).toBe('Etc/GMT+12');
    expect(service.timeZoneFor(listing('retired-source', '1'))).toBe('Etc/GMT+12');
    expect(service.timeZoneFor(null as unknown as Opportunity)).toBe('Etc/GMT+12');
  });

  it('does not ask again when only a filter the source never reads has changed', async () => {
    const reader = Object.assign(
      source('grants-gov', {
        search: () => [
          listing('grants-gov', 'small', { awardCeiling: 20000 }),
          listing('grants-gov', 'large', { awardCeiling: 900000 }),
        ],
      }),
      { filtersRead: ['query', 'statuses'] },
    );
    const service = serviceOf([reader]);
    expect(ids((await ask(service)).opportunities)).toEqual(['grants-gov:large', 'grants-gov:small']);

    // The remembered answer is filtered again on the device for each new choice.
    const narrowed = await ask(service, {
      amountMin: 100000,
      levels: ['federal'],
      place: { country: 'US', region: 'NJ', county: '', city: '' },
    });
    expect(ids(narrowed.opportunities)).toEqual(['grants-gov:large']);
    expect(narrowed.reports[0]).toMatchObject({ received: 2, matched: 1 });
    expect(reader.searches).toHaveLength(1);

    // A filter it does read is a different question.
    await ask(service, { query: 'listing' });
    expect(reader.searches).toHaveLength(2);
  });

  it('takes every filter to matter for a source that does not say, or says it badly', async () => {
    const silent = source('silent');
    const garbled = Object.assign(source('garbled'), { filtersRead: ['query', 'colour'] });
    const wrongType = Object.assign(source('wrong-type'), { filtersRead: 'query' });
    const service = serviceOf([silent, garbled, wrongType]);
    await ask(service);
    await ask(service, { amountMin: 5 });
    for (const fake of [silent, garbled, wrongType]) expect(fake.searches).toHaveLength(2);
  });

  it('does not remember a failure', async () => {
    let attempts = 0;
    const flaky = source('flaky', {
      search: () => {
        attempts += 1;
        if (attempts === 1)
          throw new FundingError('SOURCE_UNAVAILABLE', 'Flaky could not be read: it took too long to answer.');
        return [listing('flaky', '1')];
      },
    });
    const service = serviceOf([flaky]);
    expect((await ask(service)).reports[0]).toMatchObject({ state: 'failed' });
    const retry = await ask(service);
    expect(retry.reports[0]).toMatchObject({ state: 'ok', received: 1 });
    expect(ids(retry.opportunities)).toEqual(['flaky:1']);
  });

  it('never changes the listings a source returned', async () => {
    const original = listing('grants-gov', '1', { title: 'Youth housing' });
    const frozen = Object.freeze(structuredClone(original));
    const federal = source('grants-gov', { search: () => [frozen as Opportunity] });
    const service = serviceOf([federal]);
    const result = await ask(service, {}, { profileTerms: [{ term: 'youth', field: 'mission' }] });
    expect(result.opportunities[0]!.match).toMatchObject({ score: 100 });
    expect(frozen).toEqual(original);
  });
});

describe('cancelling a search', () => {
  it('rejects at once when the search was already cancelled, asking nobody', async () => {
    const federal = source('grants-gov');
    const controller = new AbortController();
    controller.abort();
    await expect(ask(serviceOf([federal]), {}, { signal: controller.signal })).rejects.toMatchObject({
      code: 'CANCELLED',
      message: 'Cancelled.',
    });
    expect(federal.searches).toHaveLength(0);
  });

  it('rejects as soon as it is cancelled, even when a source never answers', async () => {
    const deaf = source('deaf', { search: () => new Promise<Opportunity[]>(() => {}) });
    const quick = source('quick');
    const waiting = Array.from({ length: 6 }, (_, index) =>
      source(`waiting-${index}`, { search: () => new Promise<Opportunity[]>(() => {}) }),
    );
    const controller = new AbortController();
    const search = ask(serviceOf([deaf, quick, ...waiting]), {}, { signal: controller.signal });
    await tick();
    controller.abort();
    await expect(search).rejects.toMatchObject({ code: 'CANCELLED' });
    // Sources still queued behind the four in flight are never started.
    expect(waiting.filter((fake) => fake.searches.length > 0).length).toBeLessThan(6);
  });

  it('treats a source that stops because of the cancellation as cancelled, not failed', async () => {
    const controller = new AbortController();
    const polite = source('polite', {
      search: (_filters, context) =>
        new Promise<Opportunity[]>((_resolve, reject) => {
          context.signal.addEventListener('abort', () => reject(new FundingError('CANCELLED', 'Cancelled.')));
        }),
    });
    const search = ask(serviceOf([polite]), {}, { signal: controller.signal });
    await tick();
    controller.abort();
    await expect(search).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('does not remember an answer that arrived after the search was cancelled', async () => {
    let release: (listings: Opportunity[]) => void = () => {};
    let calls = 0;
    const late = source('late', {
      search: () => {
        calls += 1;
        if (calls > 1) return [listing('late', 'second')];
        return new Promise<Opportunity[]>((resolve) => {
          release = resolve;
        });
      },
    });
    const service = serviceOf([late]);
    const controller = new AbortController();
    const search = ask(service, {}, { signal: controller.signal });
    await tick();
    controller.abort();
    await expect(search).rejects.toMatchObject({ code: 'CANCELLED' });
    release([listing('late', 'first')]);
    await tick();

    expect(ids((await ask(service)).opportunities)).toEqual(['late:second']);
    expect(calls).toBe(2);
  });
});

describe('reading one listing', () => {
  it('asks the listing’s own source for the record', async () => {
    const federal = source('grants-gov');
    const state = source('nj-grants');
    const controller = new AbortController();
    const detail = await serviceOf([federal, state]).detail('nj-grants:2026:A-17', controller.signal);

    expect(detail.opportunity.id).toBe('nj-grants:2026:A-17');
    expect(detail.description).toBe('Longer text.');
    // Everything after the first colon is the source's own record id.
    expect(state.details).toEqual([{ recordId: '2026:A-17', context: { http, now: NOON, signal: controller.signal } }]);
    expect(federal.details).toHaveLength(0);
  });

  it('refuses a reference that is not a listing id', async () => {
    const federal = source('grants-gov');
    const service = serviceOf([federal]);
    const signal = new AbortController().signal;
    for (const id of [
      '',
      'grants-gov',
      'grants-gov:',
      ':362880',
      `grants-gov:${'9'.repeat(300)}`,
      42,
      null,
      undefined,
      {},
      ['grants-gov:1'],
    ]) {
      await expect(service.detail(id as string, signal)).rejects.toMatchObject({
        code: 'INVALID_INPUT',
        message: 'That listing reference is not valid.',
      });
    }
    await expect(service.detail('../../etc/passwd:1', signal)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.detail('unknown-source:1', signal)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'That listing comes from a source this version of the app does not read.',
    });
    expect(federal.details).toHaveLength(0);
  });

  it('passes on what the source says went wrong, and hides what it did not mean to say', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const signal = new AbortController().signal;
    const withdrawn = source('withdrawn', {
      detail: () => {
        throw new FundingError('NOT_FOUND', 'Withdrawn Grants has no listing with that reference.');
      },
    });
    const broken = source('broken', {
      detail: () => {
        throw new RangeError('Invalid time value at parse (/Users/dev/secret/adapter.ts:88)');
      },
    });
    const confused = source('confused', {
      detail: () => ({ opportunity: listing('confused', 'another'), description: '', facts: [], links: [] }),
    });
    const empty = source('empty', { detail: () => null as unknown as OpportunityDetail });
    const service = serviceOf([withdrawn, broken, confused, empty]);

    await expect(service.detail('withdrawn:1', signal)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Withdrawn Grants has no listing with that reference.',
    });
    const failure = service.detail('broken:1', signal);
    await expect(failure).rejects.toMatchObject({
      code: 'SOURCE_UNAVAILABLE',
      message: 'broken name could not be read. Try again in a moment.',
    });
    await expect(failure).rejects.not.toThrow(/Users|secret|time value/);
    await expect(service.detail('confused:1', signal)).rejects.toMatchObject({
      code: 'SOURCE_UNAVAILABLE',
      message: 'confused name returned a different listing from the one asked for.',
    });
    await expect(service.detail('empty:1', signal)).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
    quiet.mockRestore();
  });

  it('stops when cancelled', async () => {
    const controller = new AbortController();
    const slow = source('slow', {
      detail: (_recordId, context) =>
        new Promise<OpportunityDetail>((_resolve, reject) => {
          context.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    });
    const service = serviceOf([slow]);
    const pending = service.detail('slow:1', controller.signal);
    await tick();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    await expect(service.detail('slow:1', controller.signal)).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(slow.details).toHaveLength(1);
  });
});

describe('re-checking a stored listing', () => {
  const signal = () => new AbortController().signal;
  const stored = (patch: Partial<Opportunity> = {}) =>
    listing('grants-gov', '362880', {
      title: 'Stored title',
      fetchedAt: NOON - 3 * 24 * 60 * MINUTE,
      match: { score: 40, sharedTerms: ['housing'], fields: ['programs'] },
      ...patch,
    });
  const failing = (error: unknown) =>
    source('grants-gov', {
      detail: () => {
        throw error;
      },
    });
  const down = () =>
    new FundingError('SOURCE_UNAVAILABLE', 'Grants.gov could not be read: it answered with status 503.');

  it('returns the listing as the source has it now, keeping the stored match', async () => {
    const federal = source('grants-gov', {
      detail: (recordId) => ({
        opportunity: listing('grants-gov', recordId, {
          title: 'Current title',
          closeDate: '2026-12-01',
          fetchedAt: NOON,
        }),
        description: '',
        facts: [],
        links: [],
      }),
    });
    const fresh = await serviceOf([federal]).recheck(
      stored({ status: 'unverified', unverifiedReason: 'stale' }),
      signal(),
    );
    expect(fresh).toMatchObject({
      id: 'grants-gov:362880',
      title: 'Current title',
      status: 'active',
      closeDate: '2026-12-01',
      fetchedAt: NOON,
      match: { score: 40, sharedTerms: ['housing'], fields: ['programs'] },
    });
    expect(federal.details.map((call) => call.recordId)).toEqual(['362880']);
  });

  it('never returns "active" when the source could not be read', async () => {
    const before = stored();
    const after = await serviceOf([failing(down())]).recheck(before, signal());
    expect(after).toEqual({
      ...before,
      status: 'unverified',
      unverifiedReason: 'detail_unavailable',
      statusReason: 'The listing could not be re-read from the source to confirm it.',
    });
    // It is still dated from the last time it was actually read.
    expect(after.fetchedAt).toBe(before.fetchedAt);
    expect(before.status).toBe('active');
  });

  it.each<[string, unknown]>([
    ['the source is down', down()],
    ['the adapter breaks', new TypeError('boom')],
    ['the source returns something else', null],
  ])('marks the listing unverified when %s', async (_label, error) => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const adapter =
      error === null ? source('grants-gov', { detail: () => null as unknown as OpportunityDetail }) : failing(error);
    for (const status of ['active', 'unverified'] as const) {
      const after = await serviceOf([adapter]).recheck(stored({ status }), signal());
      expect(after).toMatchObject({ status: 'unverified', unverifiedReason: 'detail_unavailable' });
    }
    quiet.mockRestore();
  });

  it('still knows a passed deadline has passed', async () => {
    const service = serviceOf([failing(down())]);
    expect(await service.recheck(stored({ closeDate: '2026-09-30' }), signal())).toMatchObject({
      status: 'expired',
      statusReason: 'The deadline passed on September 30, 2026.',
      unverifiedReason: null,
    });
    const alreadyExpired = stored({ status: 'expired', statusReason: 'The source lists this as closed.' });
    expect(await service.recheck(alreadyExpired, signal())).toEqual(alreadyExpired);
  });

  it('says so when the source no longer has the listing', async () => {
    const gone = failing(
      new FundingError('NOT_FOUND', 'Grants.gov has no listing with that reference. It may have been withdrawn.'),
    );
    expect(await serviceOf([gone]).recheck(stored(), signal())).toMatchObject({
      status: 'unverified',
      unverifiedReason: 'detail_unavailable',
      statusReason: 'The source no longer has this listing, so it could not be confirmed.',
    });
  });

  it('marks a listing unverified when its source is not one the app reads', async () => {
    const service = serviceOf([source('grants-gov')]);
    for (const id of ['retired-source:5', 'no-colon', '']) {
      expect(await service.recheck(stored({ id }), signal())).toMatchObject({
        id,
        status: 'unverified',
        unverifiedReason: 'detail_unavailable',
        statusReason: 'The listing could not be re-read from the source to confirm it.',
      });
    }
    await expect(service.recheck(null as unknown as Opportunity, signal())).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await expect(service.recheck({} as Opportunity, signal())).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('leaves the listing alone when the check is cancelled', async () => {
    const controller = new AbortController();
    const slow = source('grants-gov', {
      detail: (_recordId, context) =>
        new Promise<OpportunityDetail>((_resolve, reject) => {
          context.signal.addEventListener('abort', () => reject(new FundingError('CANCELLED', 'Cancelled.')));
        }),
    });
    const pending = serviceOf([slow]).recheck(stored(), controller.signal);
    await tick();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});
