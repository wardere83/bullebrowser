import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPPORTUNITY_FILTERS,
  type Opportunity,
  type OpportunityFilters,
} from '../../../shared/funding.js';
import { FundingError } from '../../funding/errors.js';
import type { HttpClient, HttpRequest } from '../http.js';
import type { SourceContext } from '../types.js';
import { euFundingTendersAdapter, PROGRAMMES } from './eu-funding-tenders.js';

// Every answer below was recorded from the live source on 6 October 2026 (see
// the README beside the fixtures). Where a test needs an answer the source did
// not give that day, it changes one field of a recorded answer and says so.

type Loose = Record<string, unknown>;
type Form = Record<string, unknown>;

interface Result {
  metadata: Record<string, string[]>;
  [field: string]: unknown;
}

interface Recording {
  recordedOn: string;
  request: { url: string; form: Form };
  response: Loose & { totalResults: number; pageNumber: number; pageSize: number; results: Result[] };
}

const recording = (name: string): Recording =>
  JSON.parse(
    readFileSync(new URL(`../../../../test-fixtures/funding/sources/eu-funding-tenders/${name}.json`, import.meta.url), 'utf8'),
  ) as Recording;

/** Noon UTC on the day of recording. */
const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);
const SEARCH_URL = 'https://api.tech.ec.europa.eu/search-api/prod/rest/search';
const PORTAL = 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities';

interface Call {
  url: string;
  form: Form;
  /** The media type of each form part, as it was sent. */
  types: Record<string, string>;
  request: HttpRequest;
}

/** A source that answers only the exact requests that were recorded. */
function replay(recordings: { request: { url: string; form: Form }; response: unknown }[]) {
  const calls: Call[] = [];
  const http: HttpClient = {
    async json<T>(request: HttpRequest): Promise<T> {
      if (request.signal.aborted) throw new FundingError('CANCELLED', 'Cancelled.');
      const form: Form = {};
      const types: Record<string, string> = {};
      if (request.body instanceof FormData) {
        for (const [name, part] of request.body.entries()) {
          if (typeof part === 'string') throw new Error('Every part must be a typed blob.');
          form[name] = JSON.parse(await part.text());
          types[name] = part.type;
        }
      }
      calls.push({ url: request.url, form, types, request });
      const match = recordings.find(
        (item) => item.request.url === request.url && isDeepStrictEqual(item.request.form, form),
      );
      if (!match) {
        throw new FundingError(
          'SOURCE_UNAVAILABLE',
          'EU Funding & Tenders Portal could not be read: it answered with status 500.',
        );
      }
      return structuredClone(match.response) as T;
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

const openTopics = recording('open-topics');
const openExternal = recording('open-external');
const openCascade = recording('open-cascade');
const OPEN = [openTopics, openExternal, openCascade];
const FORTHCOMING = [recording('forthcoming-topics'), recording('forthcoming-external'), recording('forthcoming-cascade')];
const closed = recording('closed-latest');

/** A recorded answer with its body changed. */
const changed = (original: Recording, change: (response: Recording['response']) => void): Recording => {
  const copy = structuredClone(original);
  change(copy.response);
  return copy;
};
/** The recorded open topics with one field of one topic changed. */
const topicWith = (identifier: string, field: string, values: string[] | undefined) =>
  changed(openTopics, (response) => {
    const metadata = response.results.find((result) => result.metadata.identifier?.[0] === identifier)!.metadata;
    if (values === undefined) delete metadata[field];
    else metadata[field] = values;
  });

const find = (recordings: Recording[], patch: Partial<OpportunityFilters> = {}, now = NOW) =>
  euFundingTendersAdapter.search(filters(patch), context(replay(recordings).http, now));
const byId = (listings: Opportunity[], recordId: string): Opportunity => {
  const found = listings.find((listing) => listing.id === `eu-funding-tenders:${recordId}`);
  if (!found) throw new Error(`No listing ${recordId} in the result.`);
  return found;
};
const mustOf = (call: Call) => (call.form.query as { bool: { must: Loose[] } }).bool.must;

describe('EU Funding & Tenders Portal source', () => {
  it('describes itself as an international source of grants, with its licence', () => {
    expect(euFundingTendersAdapter.info).toMatchObject({
      id: 'eu-funding-tenders',
      name: 'EU Funding & Tenders Portal',
      operator: 'European Commission',
      level: 'international',
      jurisdiction: 'European Union',
      // It belongs to no single country.
      coverage: { country: '', region: '', county: '', city: '' },
      kinds: ['grant'],
    });
    expect(euFundingTendersAdapter.info.homepageUrl).toMatch(/^https:\/\/ec\.europa\.eu\//);
    expect(euFundingTendersAdapter.info.attribution).toMatch(/European Union.*CC BY 4\.0/);
    expect(euFundingTendersAdapter.info.note).toMatch(/applies the status filter itself/);
    expect(euFundingTendersAdapter.info.note).toMatch(/whatever the portal's own flag says/);
  });

  it('knows the programme of every recorded listing by the name the portal gives it', () => {
    const recorded = [...OPEN, ...FORTHCOMING, closed].flatMap((item) => item.response.results);
    for (const result of recorded) {
      expect(Object.hasOwn(PROGRAMMES, result.metadata.frameworkProgramme![0]!)).toBe(true);
    }
    expect(PROGRAMMES['43108390']).toBe('Horizon Europe (HORIZON)');
    expect(PROGRAMMES['43353764']).toBe('Erasmus+ (ERASMUS+)');
    expect(Object.keys(PROGRAMMES)).toHaveLength(64);
  });
});

describe('EU Funding & Tenders Portal search', () => {
  it('asks for current, open records with a deadline still to come, one record type at a time', async () => {
    const source = replay([...OPEN, ...FORTHCOMING, closed]);
    const found = await euFundingTendersAdapter.search(
      filters({ query: 'women innovators', applicantTypes: ['nonprofit'], categories: ['science_technology_research'] }),
      context(source.http),
    );

    expect(source.calls).toHaveLength(3);
    for (const call of source.calls) {
      expect(call.request).toMatchObject({ method: 'POST', source: 'EU Funding & Tenders Portal' });
      // The keyword is applied on the device: three asterisks ask the portal for everything.
      expect(call.url).toBe(`${SEARCH_URL}?apiKey=SEDIA&text=***&pageSize=100&pageNumber=1`);
      // The portal answers anything but JSON-typed parts with an internal error.
      expect(call.types).toEqual({
        query: 'application/json',
        languages: 'application/json',
        sort: 'application/json',
        displayFields: 'application/json',
      });
      expect(call.form.languages).toEqual(['en']);
      expect(call.form.displayFields).toEqual(openTopics.request.form.displayFields);
    }
    expect(source.calls.map((call) => call.form)).toEqual(OPEN.map((item) => item.request.form));

    expect(mustOf(source.calls[0]!)).toEqual([
      { terms: { type: ['1'] } },
      { terms: { DATASOURCE: ['SEDIA'] } },
      { terms: { status: ['31094502'] } },
      { range: { deadlineDate: { gte: '2026-10-06T00:00:00.000+0000' } } },
    ]);
    // Each type is sorted by the number unique to it, so that pages cannot overlap.
    expect(source.calls.map((call) => call.form.sort)).toEqual([
      { field: 'identifier', order: 'ASC' },
      { field: 'callIdentifier', order: 'ASC' },
      { field: 'callccm2Id', order: 'ASC' },
    ]);
    expect(source.calls.map((call) => mustOf(call)[0])).toEqual([
      { terms: { type: ['1'] } },
      { terms: { type: ['2'] } },
      { terms: { type: ['8'] } },
    ]);

    expect(found.map((listing) => listing.id.replace('eu-funding-tenders:', ''))).toEqual([
      'topic-CREA-MEDIA-2027-FILMOVE',
      'topic-EUBA-EFSA-2026-PLANTS-02',
      'topic-HORIZON-EIC-2026-DEFENCE-01',
      'topic-HORIZON-EIT-2026-PRIZE-WIP-LEADERSHIP',
      'external-186411',
      'external-187027',
      'cascade-14741',
      'cascade-14841',
      'cascade-15322',
    ]);
  });

  it('adds forthcoming topics when unverified listings are wanted and the latest closed ones when expired are', async () => {
    const unverified = replay([...OPEN, ...FORTHCOMING, closed]);
    await euFundingTendersAdapter.search(filters({ statuses: ['active', 'unverified'] }), context(unverified.http));
    expect(unverified.calls.map((call) => call.form)).toEqual([...OPEN, ...FORTHCOMING].map((item) => item.request.form));
    expect(mustOf(unverified.calls[3]!).slice(2)).toEqual([
      { terms: { status: ['31094501'] } },
      // A forthcoming topic whose opening date has passed is not asked for.
      { range: { startDate: { gte: '2026-10-06T00:00:00.000+0000' } } },
    ]);

    const expired = replay([...OPEN, ...FORTHCOMING, closed]);
    await euFundingTendersAdapter.search(filters({ statuses: ['expired'] }), context(expired.http));
    expect(expired.calls.map((call) => call.form)).toEqual([...OPEN, closed].map((item) => item.request.form));
    expect(expired.calls[3]!.form).toMatchObject({
      query: {
        bool: {
          must: [
            { terms: { type: ['1', '2', '8'] } },
            { terms: { DATASOURCE: ['SEDIA'] } },
            { terms: { status: ['31094503'] } },
          ],
        },
      },
      sort: { field: 'deadlineDate', order: 'DESC' },
    });

    const all = replay([...OPEN, ...FORTHCOMING, closed]);
    const found = await euFundingTendersAdapter.search(filters({ statuses: [] }), context(all.http));
    expect(all.calls).toHaveLength(7);
    expect(found).toHaveLength(15);
  });

  it('does not ask at all when only contract solicitations are wanted', async () => {
    const source = replay(OPEN);
    expect(await euFundingTendersAdapter.search(filters({ kinds: ['contract_solicitation'] }), context(source.http))).toEqual([]);
    expect(source.calls).toHaveLength(0);
  });

  it('reads a complete grant topic, with its own line of the call budget', async () => {
    const found = await find(OPEN);
    expect(byId(found, 'topic-HORIZON-EIT-2026-PRIZE-WIP-LEADERSHIP')).toEqual({
      id: 'eu-funding-tenders:topic-HORIZON-EIT-2026-PRIZE-WIP-LEADERSHIP',
      sourceId: 'eu-funding-tenders',
      sourceName: 'EU Funding & Tenders Portal',
      funder: 'European Commission, Horizon Europe (HORIZON)',
      kind: 'grant',
      level: 'international',
      country: '',
      region: '',
      jurisdiction: 'European Union',
      geographyNote: '',
      title: 'Women Leadership Category',
      summary:
        'Expected Impact: The prize will boost public awareness of the potential, importance and contribution of women ' +
        'to the EU innovation ecosystem and create strong role models, inspiring more women to become innovators themselves.',
      number: 'HORIZON-EIT-2026-PRIZE-WIP-LEADERSHIP',
      applicantTypes: [],
      applicantNote: '',
      categories: [],
      awardFloor: 20_000,
      awardCeiling: 50_000,
      totalFunding: 100_000,
      currency: 'EUR',
      openDate: '2026-09-02',
      closeDate: '2026-12-01',
      closeDateText: 'December 1, 2026',
      status: 'active',
      statusReason: expect.stringMatching(/Closes December 1, 2026\.$/) as string,
      unverifiedReason: null,
      sourceStatus: 'Open for submission',
      officialUrl: `${PORTAL}/topic-details/HORIZON-EIT-2026-PRIZE-WIP-LEADERSHIP`,
      fetchedAt: NOW,
      match: null,
    });
  });

  it('reads a sparse topic without filling in what the portal left out', async () => {
    const found = await find(OPEN);
    // No description at all.
    expect(byId(found, 'topic-HORIZON-EIC-2026-DEFENCE-01')).toMatchObject({
      title: 'EIC defence call',
      summary: '',
      awardFloor: 10_000_000,
      awardCeiling: 30_000_000,
      totalFunding: 100_000_000,
      closeDate: '2026-10-28',
      status: 'active',
    });
    // A budget line that gives a year's budget but zero for each contribution.
    expect(byId(found, 'topic-EUBA-EFSA-2026-PLANTS-02')).toMatchObject({
      funder: 'European Commission, EU Bodies and Agencies (EUBA)',
      awardFloor: null,
      awardCeiling: null,
      totalFunding: 500_000,
      openDate: '2026-10-06',
    });
  });

  it('takes the next cut-off date still to come as the deadline', async () => {
    const found = await find(OPEN);
    expect(byId(found, 'topic-CREA-MEDIA-2027-FILMOVE')).toMatchObject({
      closeDate: '2027-01-21',
      closeDateText: 'January 21, 2027. One of 2 cut-off dates: 2027-01-21, 2027-07-15.',
      totalFunding: 23_500_000,
      status: 'active',
    });
    // One cut-off has passed; the next is in April.
    expect(byId(found, 'cascade-14841')).toMatchObject({
      closeDate: '2027-04-30',
      closeDateText:
        'April 30, 2027. The official page gives the time of day. One of 2 cut-off dates: 2026-09-08, 2027-04-30.',
      status: 'active',
    });
  });

  it('reads a cascade call under its own number, title and page, not those of the topic that pays for it', async () => {
    const found = await find(OPEN);
    const call = byId(found, 'cascade-14741');
    expect(call).toMatchObject({
      title: 'Open Call of Perform Europe 2026 – 2028',
      funder: 'EU-funded project PE 3 (Perform Europe 3)',
      summary: 'Cascade funding call run by an EU-funded project under the EU topic CREA-CULT-2026-PERFORM-EU.',
      number: '',
      totalFunding: 1_400_000,
      awardFloor: null,
      awardCeiling: null,
      currency: 'EUR',
      closeDate: '2026-10-22',
      closeDateText: 'October 22, 2026. The official page gives the time of day.',
      status: 'active',
      // The link the portal gives for it ends in the topic's number, 49521170.
      officialUrl: `${PORTAL}/competitive-calls-cs/14741`,
    });
    expect(byId(found, 'cascade-15322').summary).toMatch(
      /^Cascade funding call run by an EU-funded project under the EU topic HORIZON-EIT-2025-KIC-IBA-RM\. The call text,/,
    );
  });

  it('reads an external-action call with the link the portal gives for it', async () => {
    const found = await find(OPEN);
    expect(byId(found, 'external-186411')).toMatchObject({
      title: 'EU-China Think Tank Engagement on Green Governance',
      funder: 'European Commission, EU External Action - Prospect (RELEX-PROSPECT)',
      number: 'EuropeAid/186411/DD/ACT/CN',
      summary: 'Call for proposals under EU external action.',
      totalFunding: 500_000,
      currency: 'EUR',
      openDate: '2026-07-17',
      closeDate: '2026-10-30',
      officialUrl: 'https://webgate.ec.europa.eu/prospect/external/publishedcalls.htm?callId=186411',
      status: 'active',
    });
    // Closing today still counts as open.
    expect(byId(found, 'external-187027')).toMatchObject({ closeDate: '2026-10-06', status: 'active' });
  });

  it('labels forthcoming topics as forecasts and closed ones as expired', async () => {
    const found = await find([...OPEN, ...FORTHCOMING, closed], { statuses: [] });
    expect(byId(found, 'topic-CREA-MEDIA-2027-FILMDIST')).toMatchObject({
      status: 'unverified',
      unverifiedReason: 'forecast',
      sourceStatus: 'Forthcoming',
      openDate: '2026-12-03',
      closeDate: '2027-04-08',
      totalFunding: 38_000_000,
    });
    expect(byId(found, 'cascade-15342')).toMatchObject({ unverifiedReason: 'forecast', totalFunding: 86_439_583 });

    // Closed for its first stage, with a second-stage date still to come: closed is closed.
    expect(byId(found, 'topic-LIFE-2026-STRAT-CLIMA-SIP-two-stage')).toMatchObject({
      status: 'expired',
      statusReason: 'The source lists this as closed.',
      unverifiedReason: null,
      sourceStatus: 'Closed',
      closeDate: '2027-03-04',
    });
    // When every cut-off has passed, the last one is the deadline.
    expect(byId(found, 'cascade-11264')).toMatchObject({ status: 'expired', closeDate: '2026-09-29' });
    expect(byId(found, 'cascade-15241')).toMatchObject({ status: 'expired', closeDate: '2026-10-05' });
  });

  it("does not trust the portal's open flag once the deadline it read has passed", async () => {
    // Changed: the same rows, given as the answer to the query of 15 November.
    const later = Date.UTC(2026, 10, 15, 12, 0, 0);
    const moved = OPEN.map((item) => {
      const copy = structuredClone(item);
      const must = (copy.request.form.query as { bool: { must: Loose[] } }).bool.must;
      must[3] = { range: { deadlineDate: { gte: '2026-11-15T00:00:00.000+0000' } } };
      return copy;
    });
    const found = await find(moved, {}, later);
    expect(byId(found, 'topic-HORIZON-EIC-2026-DEFENCE-01')).toMatchObject({
      status: 'expired',
      statusReason: 'The deadline passed on October 28, 2026.',
      sourceStatus: 'Open for submission',
    });
    expect(byId(found, 'external-187027').status).toBe('expired');
    expect(byId(found, 'topic-HORIZON-EIT-2026-PRIZE-WIP-LEADERSHIP').status).toBe('active');
    expect(byId(found, 'cascade-14841')).toMatchObject({ status: 'active', closeDate: '2027-04-30' });
  });

  it('never calls a listing active without a deadline it can read, a link on an EU site or a status it knows', async () => {
    const id = 'HORIZON-EIT-2026-PRIZE-WIP-LEADERSHIP';
    const listing = async (topics: Recording) => byId(await find([topics, openExternal, openCascade]), `topic-${id}`);

    // Changed: the deadline of one open topic, three ways.
    expect(await listing(topicWith(id, 'deadlineDate', undefined))).toMatchObject({
      status: 'unverified',
      unverifiedReason: 'no_deadline',
      closeDate: null,
      closeDateText: '',
    });
    expect(await listing(topicWith(id, 'deadlineDate', ['To be announced']))).toMatchObject({
      status: 'unverified',
      unverifiedReason: 'implausible_deadline',
      closeDate: null,
      closeDateText: 'To be announced',
    });
    // A time in another zone is not read as if it were the portal's own.
    expect(await listing(topicWith(id, 'deadlineDate', ['2026-12-01T23:30:00.000-0500']))).toMatchObject({
      unverifiedReason: 'implausible_deadline',
      closeDate: null,
    });
    expect(await listing(topicWith(id, 'deadlineDate', ['2099-12-31T00:00:00.000+0000']))).toMatchObject({
      unverifiedReason: 'implausible_deadline',
      closeDate: '2099-12-31',
    });

    // Changed: an external-action call whose link leaves the EU's sites.
    const elsewhere = changed(openExternal, (response) => {
      response.results[0]!.metadata.url = ['https://europa.eu.example.com/publishedcalls.htm?callId=186411'];
    });
    expect(byId(await find([openTopics, elsewhere, openCascade]), 'external-186411')).toMatchObject({
      status: 'unverified',
      unverifiedReason: 'no_official_link',
      officialUrl: '',
    });
  });

  it('removes markup, scripts and invisible characters from what the portal sends', async () => {
    const id = 'HORIZON-EIT-2026-PRIZE-WIP-LEADERSHIP';
    // Changed: a description carrying a script, an escaped tag and a zero-width space.
    const hostile = topicWith(id, 'descriptionByte', [
      '<p class="x">Prize <script>steal()</script>for &amp;lt;img src=x onerror=alert(1)&amp;gt;' +
        `women${String.fromCodePoint(0x200b)} innovators</p>`,
    ]);
    const found = await find([hostile, openExternal, openCascade]);
    expect(byId(found, `topic-${id}`).summary).toBe('Prize for women innovators');
  });

  // Changed: one part of the recorded answer for open topics.
  const altered = (change: (response: Recording['response']) => void) => changed(openTopics, change).response;

  it.each([
    ['an internal error', { type: 'throwable', message: 'An internal error occurred' }, /reported a problem with the search/],
    ['nothing', null, /not in the expected form/],
    [
      'a count that is not a number',
      altered((response) => (response.totalResults = '4' as unknown as number)),
      /not in the expected form/,
    ],
    ['fewer rows than it counts', altered((response) => (response.totalResults = 9)), /different number of listings/],
    ['more rows than it counts', altered((response) => (response.totalResults = 2)), /different number of listings/],
    ['another page than was asked for', altered((response) => (response.pageNumber = 2)), /ran a different search/],
    ['another page size than was asked for', altered((response) => (response.pageSize = 50)), /ran a different search/],
    [
      'a row with no metadata',
      altered((response) => delete (response.results[0] as Loose).metadata),
      /not in the expected form/,
    ],
  ])('refuses %s instead of returning partial rows', async (_label, response, message) => {
    const failure = find([{ ...openTopics, response: response as Recording['response'] }, openExternal, openCascade]);
    await expect(failure).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
    await expect(failure).rejects.toThrow(message);
    await expect(failure).rejects.toThrow(/^EU Funding & Tenders Portal could not be read: /);
  });

  it.each([
    ['a copy left by the earlier system', 'DATASOURCE', ['SEDIA_PRD_CENTRICITY'], /ran a different search/],
    ['a tender', 'type', ['0'], /ran a different search/],
    ['a closed topic among the open ones', 'status', ['31094503'], /ran a different search/],
    ['a topic with no identifier', 'identifier', undefined, /not in the expected form/],
    ['a topic with no title', 'title', ['  '], /not in the expected form/],
    ['a value that is not text', 'title', [42 as unknown as string], /not in the expected form/],
    [
      'a value that is not a list',
      'deadlineDate',
      '2026-12-01T00:00:00.000+0000' as unknown as string[],
      /not in the expected form/,
    ],
  ])('refuses the whole answer when it holds %s', async (_label, field, values, message) => {
    // Changed: one field of the first open topic.
    const failure = find([topicWith('CREA-MEDIA-2027-FILMOVE', field, values), openExternal, openCascade]);
    await expect(failure).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
    await expect(failure).rejects.toThrow(message);
  });

  it('reads further pages of a hundred, and gives up rather than show a short or shifting list', async () => {
    const template = openTopics.response.results[1]!;
    // Changed: a full first page made of one recorded topic under a hundred
    // different identifiers, followed by a second page holding the four recorded ones.
    const page = (pageNumber: number, total: number, results: Result[]): Recording => ({
      recordedOn: openTopics.recordedOn,
      request: {
        url: `${SEARCH_URL}?apiKey=SEDIA&text=***&pageSize=100&pageNumber=${pageNumber}`,
        form: openTopics.request.form,
      },
      response: { ...openTopics.response, totalResults: total, pageNumber, results },
    });
    const hundred = (prefix: string): Result[] =>
      Array.from({ length: 100 }, (_, at) => ({
        ...template,
        metadata: { ...template.metadata, identifier: [`${prefix}-${String(at).padStart(3, '0')}`] },
      }));

    const twoPages = [page(1, 104, hundred('CLONE')), page(2, 104, openTopics.response.results)];
    const source = replay([...twoPages, openExternal, openCascade]);
    const found = await euFundingTendersAdapter.search(filters(), context(source.http));
    expect(source.calls.map((call) => call.url.split('pageNumber=')[1])).toEqual(['1', '2', '1', '1']);
    expect(found).toHaveLength(104 + 2 + 3);
    expect(new Set(found.map((listing) => listing.id)).size).toBe(109);

    // Changed: the count moves between the two pages.
    const shifting = [page(1, 104, hundred('CLONE')), page(2, 103, openTopics.response.results.slice(0, 3))];
    await expect(find([...shifting, openExternal, openCascade])).rejects.toThrow(
      'EU Funding & Tenders Portal could not be read: its listings changed while they were being read. Search again.',
    );

    // Changed: more topics than ten pages can hold.
    const endless = Array.from({ length: 10 }, (_, at) => page(at + 1, 1500, hundred(`PAGE${at}`)));
    await expect(find([...endless, openExternal, openCascade])).rejects.toThrow(
      'EU Funding & Tenders Portal could not be read: it has more listings than can be read at once.',
    );
  });

  it('stops when the search is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      euFundingTendersAdapter.search(filters(), context(replay(OPEN).http, NOW, controller.signal)),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});

describe('EU Funding & Tenders Portal listing', () => {
  it('re-reads one grant topic and labels what the portal says', async () => {
    const recorded = recording('detail-topic-HORIZON-EIT-2026-PRIZE-WIP-LEADERSHIP');
    const source = replay([recorded]);
    const detail = await euFundingTendersAdapter.detail('topic-HORIZON-EIT-2026-PRIZE-WIP-LEADERSHIP', context(source.http));

    expect(source.calls).toHaveLength(1);
    expect(source.calls[0]!.url).toBe(`${SEARCH_URL}?apiKey=SEDIA&text=***&pageSize=10&pageNumber=1`);
    expect(source.calls[0]!.form).toEqual(recorded.request.form);
    expect(mustOf(source.calls[0]!)).toEqual([
      { terms: { type: ['1'] } },
      { terms: { DATASOURCE: ['SEDIA'] } },
      { terms: { identifier: ['HORIZON-EIT-2026-PRIZE-WIP-LEADERSHIP'] } },
    ]);

    expect(detail.opportunity).toMatchObject({
      id: 'eu-funding-tenders:topic-HORIZON-EIT-2026-PRIZE-WIP-LEADERSHIP',
      status: 'active',
      closeDate: '2026-12-01',
      awardCeiling: 50_000,
    });
    expect(detail.description).toMatch(/^Expected Impact:\n\nThe prize will boost public awareness/);
    expect(detail.facts).toEqual([
      { label: 'Programme', value: 'Horizon Europe (HORIZON)' },
      { label: 'Call', value: 'HORIZON-EIT-2026-PRIZE-WIP: The European Prize for Women Innovators' },
      { label: 'Type of action', value: 'HORIZON Recognition Prize' },
      { label: 'Deadline model', value: 'single-stage' },
      { label: 'Status at the source', value: 'Open for submission' },
      {
        label: 'Budget line: HORIZON-EIT-2026-PRIZE-WIP-LEADERSHIP - HORIZON-RPr HORIZON Recognition Prize',
        value: '3 expected grants; contribution from EUR 20,000; contribution up to EUR 50,000; 2026 budget EUR 100,000',
      },
    ]);
    expect(detail.links).toEqual([
      {
        label: 'Listing on the EU Funding & Tenders Portal',
        url: `${PORTAL}/topic-details/HORIZON-EIT-2026-PRIZE-WIP-LEADERSHIP`,
      },
    ]);
  });

  it('re-reads a cascade call by its own number and points to the topic it belongs to', async () => {
    const recorded = recording('detail-cascade-14841');
    const source = replay([recorded]);
    const detail = await euFundingTendersAdapter.detail('cascade-14841', context(source.http));

    expect(mustOf(source.calls[0]!)).toEqual([
      { terms: { type: ['8'] } },
      { terms: { DATASOURCE: ['SEDIA'] } },
      { terms: { callccm2Id: ['14841'] } },
    ]);
    expect(detail.opportunity).toMatchObject({
      id: 'eu-funding-tenders:cascade-14841',
      title: 'Co-Creation Accelerator 2026-2027',
      funder: 'EU-funded project EIT Digital 2026-27 (EIT Digital 2026-2027 MoC Activities)',
      closeDate: '2027-04-30',
      status: 'active',
    });
    expect(detail.facts).toEqual([
      { label: 'Programme', value: 'Horizon Europe (HORIZON)' },
      { label: 'EU topic this call belongs to', value: 'HORIZON-EIT-2025-MOC-IBA: 2026-2027 MOC Activities' },
      {
        label: 'Duration',
        value: 'All proposals must have an execution timeframe of four 4 months (November 2026 – February 2027 for Cut-Off 1)',
      },
      { label: 'Deadline model', value: 'multiple cut-off' },
      { label: 'Cut-off dates', value: 'September 8, 2026; April 30, 2027' },
      { label: 'Status at the source', value: 'Open for submission' },
      { label: 'Budget of the call', value: 'EUR 3,200,000' },
    ]);
    expect(detail.links).toEqual([
      { label: 'Listing on the EU Funding & Tenders Portal', url: `${PORTAL}/competitive-calls-cs/14841` },
      { label: 'EU topic this call belongs to', url: `${PORTAL}/topic-details/HORIZON-EIT-2025-MOC-IBA` },
    ]);
    const sections = detail.description.split('\n\n');
    expect(sections[0]).toBe('Further information');
    expect(sections).toContain('How the project administers the call');
    expect(detail.description).not.toMatch(/[<>]/);
  });

  it('re-reads an external-action call and lists the documents the portal attaches', async () => {
    const recorded = recording('detail-external-187126');
    const source = replay([recorded]);
    const detail = await euFundingTendersAdapter.detail('external-187126', context(source.http));

    expect(mustOf(source.calls[0]!)[2]).toEqual({ terms: { callIdentifier: ['187126'] } });
    expect(detail.opportunity).toMatchObject({
      id: 'eu-funding-tenders:external-187126',
      number: 'EuropeAid/187126/DD/ACT/VN',
      closeDate: '2026-11-03',
      totalFunding: 2_290_000,
      status: 'active',
    });
    expect(detail.description).toBe('');
    expect(detail.facts).toEqual([
      { label: 'Programme', value: 'EU External Action - Prospect (RELEX-PROSPECT)' },
      { label: 'Call', value: '187126' },
      { label: 'Status at the source', value: 'Open for submission' },
      { label: 'Budget of the call', value: 'EUR 2,290,000' },
    ]);
    expect(detail.links[0]).toEqual({
      label: 'Listing on the EU Funding & Tenders Portal',
      url: 'https://webgate.ec.europa.eu/prospect/external/publishedcalls.htm?callId=187126',
    });
    const documents = detail.links.slice(1);
    expect(documents.length).toBeGreaterThan(1);
    expect(documents.map((link) => link.label)).toContain('Document: Guidelines');
    for (const link of documents) {
      expect(link.label).toMatch(/^Document/);
      expect(link.url).toMatch(/^https:\/\/webgate\.ec\.europa\.eu\//);
    }
  });

  it('expires a topic the portal still flags as open when every one of its deadlines has passed', async () => {
    const detail = await euFundingTendersAdapter.detail(
      'topic-ERASMUS-EDU-2022-ECHE-CERT-FP',
      context(replay([recording('detail-topic-ERASMUS-EDU-2022-ECHE-CERT-FP')]).http),
    );
    expect(detail.opportunity).toMatchObject({
      funder: 'European Commission, Erasmus+ (ERASMUS+)',
      sourceStatus: 'Open for submission',
      status: 'expired',
      statusReason: 'The deadline passed on March 24, 2026.',
      closeDate: '2026-03-24',
      closeDateText:
        'March 24, 2026. One of 5 cut-off dates: 2022-05-03, 2023-01-26, 2024-01-25, 2025-01-28, 2026-03-24.',
      // Its budget line states no amounts.
      awardFloor: null,
      awardCeiling: null,
      totalFunding: null,
    });
    expect(detail.facts).toContainEqual({
      label: 'Cut-off dates',
      value: 'May 3, 2022; January 26, 2023; January 25, 2024; January 28, 2025; March 24, 2026',
    });
  });

  it('says so when the portal has no listing with that reference', async () => {
    const recorded = recording('detail-unknown');
    expect(recorded.response.results).toEqual([]);
    const failure = euFundingTendersAdapter.detail('topic-NO-SUCH-TOPIC-0000', context(replay([recorded]).http));
    await expect(failure).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(failure).rejects.toThrow(/has no listing with that reference/);

    // Changed: the portal answers with a different topic from the one asked for.
    const other = changed(recording('detail-topic-HORIZON-EIT-2026-PRIZE-WIP-LEADERSHIP'), (response) => {
      response.results[0]!.metadata.identifier = ['HORIZON-EIT-2026-PRIZE-WIP-RISING'];
    });
    await expect(
      euFundingTendersAdapter.detail('topic-HORIZON-EIT-2026-PRIZE-WIP-LEADERSHIP', context(replay([other]).http)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses a reference it did not issue without asking the source', async () => {
    const source = replay([recording('detail-unknown')]);
    const refused = [
      '',
      'HORIZON-EIT-2026-PRIZE-WIP-LEADERSHIP',
      'tender-12',
      'topic-',
      `topic-${'x'.repeat(151)}`,
      'topic-A\nB',
      `cascade-14841${String.fromCodePoint(0x200b)}`,
    ];
    for (const id of refused) {
      await expect(euFundingTendersAdapter.detail(id, context(source.http))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
    expect(source.calls).toHaveLength(0);
  });
});
