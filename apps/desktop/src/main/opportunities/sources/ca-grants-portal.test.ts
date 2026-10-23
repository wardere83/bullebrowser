import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  APPLICANT_TYPE_LABELS,
  DEFAULT_OPPORTUNITY_FILTERS,
  FUNDING_CATEGORY_LABELS,
  type Opportunity,
  type OpportunityFilters,
} from '../../../shared/funding.js';
import { FundingError } from '../../funding/errors.js';
import type { HttpClient, HttpRequest } from '../http.js';
import type { SourceContext } from '../types.js';
import { APPLICANT_TYPES, caGrantsPortalAdapter, CATEGORIES } from './ca-grants-portal.js';

// Every answer below was recorded from the live source on 6 October 2026 (see
// the README beside the fixtures). Where a test needs an answer the source did
// not give that day, it changes one field of a recorded answer and says so.

type Loose = Record<string, unknown>;

type Result = Loose & { records: Loose[]; total: number };

interface Recording {
  recordedOn: string;
  request: { url: string };
  response: { success: boolean; result: Result };
}

const recording = (name: string): Recording =>
  JSON.parse(
    readFileSync(new URL(`../../../../test-fixtures/funding/sources/ca-grants-portal/${name}.json`, import.meta.url), 'utf8'),
  ) as Recording;

/** Noon UTC on the day of recording: 5 a.m. in California. */
const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);

/** A source that answers only the exact requests that were recorded. */
function replay(recordings: { request: { url: string }; response: unknown }[]) {
  const calls: HttpRequest[] = [];
  const http: HttpClient = {
    async json<T>(request: HttpRequest): Promise<T> {
      calls.push(request);
      if (request.signal.aborted) throw new FundingError('CANCELLED', 'Cancelled.');
      const match = recordings.find((item) => item.request.url === request.url);
      if (!match) {
        throw new FundingError('SOURCE_UNAVAILABLE', 'California Grants Portal could not be read: it answered with status 409.');
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
const params = (call: HttpRequest) => Object.fromEntries(new URL(call.url).searchParams);

const active = recording('search-active');
const activeAndForecasted = recording('search-active-and-forecasted');
const closed = recording('search-closed');

/** A recorded answer with its result changed. */
const changed = (original: Recording, change: (result: Result) => void) => {
  const copy = structuredClone(original);
  change(copy.response.result);
  return copy;
};
/** The recorded active answer with one field of one listing changed. */
const withField = (id: string, field: string, value: unknown) =>
  changed(active, (result) => {
    result.records.find((record) => record.PortalID === id)![field] = value;
  });

const find = (recordings: { request: { url: string }; response: unknown }[], patch: Partial<OpportunityFilters> = {}, now = NOW) =>
  caGrantsPortalAdapter.search(filters(patch), context(replay(recordings).http, now));
const byId = (listings: Opportunity[], id: string): Opportunity => {
  const found = listings.find((listing) => listing.id === `ca-grants-portal:${id}`);
  if (!found) throw new Error(`No listing ${id} in the result.`);
  return found;
};

describe('California Grants Portal source', () => {
  it('describes itself as the state grants source for California', () => {
    expect(caGrantsPortalAdapter.info).toMatchObject({
      id: 'ca-grants-portal',
      name: 'California Grants Portal',
      operator: 'California State Library',
      level: 'state',
      jurisdiction: 'California',
      coverage: { country: 'US', region: 'CA', county: '', city: '' },
      kinds: ['grant'],
      homepageUrl: 'https://www.grants.ca.gov/',
    });
    expect(caGrantsPortalAdapter.info.attribution).toMatch(/Public domain/);
    expect(caGrantsPortalAdapter.info.note).toMatch(/applies the status filter itself/);
  });

  it('maps every applicant type and category the portal uses to values the app knows', () => {
    expect(Object.keys(APPLICANT_TYPES).sort()).toEqual([
      'Business',
      'Individual',
      'Nonprofit',
      'Other Legal Entity',
      'Public Agency',
      'Tribal Government',
    ]);
    expect(Object.keys(CATEGORIES)).toHaveLength(18);
    for (const values of Object.values(APPLICANT_TYPES)) {
      expect(values.length).toBeGreaterThan(0);
      for (const value of values) expect(Object.hasOwn(APPLICANT_TYPE_LABELS, value)).toBe(true);
    }
    for (const values of Object.values(CATEGORIES)) {
      expect(values.length).toBeGreaterThan(0);
      for (const value of values) expect(Object.hasOwn(FUNDING_CATEGORY_LABELS, value)).toBe(true);
    }
    // Every label in the recorded answers is one the tables know.
    const recorded = [active, activeAndForecasted, closed].flatMap((item) => item.response.result.records);
    const labels = (field: string) =>
      new Set(recorded.flatMap((record) => String(record[field] ?? '').split(';').map((label) => label.trim())).filter(Boolean));
    for (const label of labels('ApplicantType')) expect(Object.hasOwn(APPLICANT_TYPES, label)).toBe(true);
    for (const label of labels('Categories')) expect(Object.hasOwn(CATEGORIES, label)).toBe(true);
  });
});

describe('California Grants Portal search', () => {
  it('accepts CKAN numeric portal ids without changing their official identity or facts', async () => {
    const numeric = changed(active, (result) => {
      for (const record of result.records) record.PortalID = Number(record.PortalID);
    });
    const before = await find([active]);
    expect(await find([numeric])).toEqual(before);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, true, {}])('rejects an invalid numeric portal id %j', async (id) => {
    await expect(find([withField('191046', 'PortalID', id)])).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
  });

  it('asks only for active listings by default, and sends nothing else about the search', async () => {
    const source = replay([active, activeAndForecasted, closed]);
    const found = await caGrantsPortalAdapter.search(
      filters({ query: 'trails', applicantTypes: ['nonprofit'], categories: ['education'], amountMin: 50_000 }),
      context(source.http),
    );

    expect(source.calls).toHaveLength(1);
    expect(source.calls[0]).toMatchObject({ url: active.request.url, source: 'California Grants Portal' });
    expect(source.calls[0]!.body).toBeUndefined();
    const url = new URL(source.calls[0]!.url);
    expect(url.origin + url.pathname).toBe('https://data.ca.gov/api/3/action/datastore_search');
    expect(params(source.calls[0]!)).toEqual({
      resource_id: '111c8c88-21f6-453c-ae2c-b4785a0624f5',
      filters: '{"Status":["active"]}',
      limit: '1000',
    });
    // Every active listing comes back; the service applies the other filters on the device.
    expect(found).toHaveLength(6);
  });

  it('adds forecasts when unverified listings are wanted and closed ones when expired are', async () => {
    const unverified = replay([active, activeAndForecasted, closed]);
    await caGrantsPortalAdapter.search(filters({ statuses: ['active', 'unverified'] }), context(unverified.http));
    expect(unverified.calls.map((call) => call.url)).toEqual([activeAndForecasted.request.url]);
    expect(params(unverified.calls[0]!).filters).toBe('{"Status":["active","forecasted"]}');

    const expired = replay([active, activeAndForecasted, closed]);
    await caGrantsPortalAdapter.search(filters({ statuses: ['expired'] }), context(expired.http));
    // Active listings are still read: one whose deadline has passed is expired too.
    expect(expired.calls.map((call) => call.url)).toEqual([active.request.url, closed.request.url]);
    expect(params(expired.calls[1]!)).toEqual({
      resource_id: '111c8c88-21f6-453c-ae2c-b4785a0624f5',
      filters: '{"Status":["closed"]}',
      limit: '300',
      sort: 'ApplicationDeadline desc',
    });

    const all = replay([active, activeAndForecasted, closed]);
    const found = await caGrantsPortalAdapter.search(filters({ statuses: [] }), context(all.http));
    expect(all.calls.map((call) => call.url)).toEqual([activeAndForecasted.request.url, closed.request.url]);
    expect(found.map((listing) => listing.id)).toEqual([
      'ca-grants-portal:191046',
      'ca-grants-portal:192057',
      'ca-grants-portal:190194',
      'ca-grants-portal:171777',
      'ca-grants-portal:190497',
      'ca-grants-portal:173037',
    ]);
  });

  it('does not ask at all when only contract solicitations are wanted', async () => {
    const source = replay([active]);
    expect(await caGrantsPortalAdapter.search(filters({ kinds: ['contract_solicitation'] }), context(source.http))).toEqual([]);
    expect(source.calls).toHaveLength(0);
  });

  it('reads a complete listing', async () => {
    const found = await find([active]);
    expect(byId(found, '191046')).toEqual({
      id: 'ca-grants-portal:191046',
      sourceId: 'ca-grants-portal',
      sourceName: 'California Grants Portal',
      funder: 'Department of Parks and Recreation',
      kind: 'grant',
      level: 'state',
      country: 'US',
      region: 'CA',
      jurisdiction: 'California',
      geographyNote: 'All Projects shall reside on public lands within the State of California.',
      title: 'The Recreational Trails Program (RTP) – R27',
      summary: expect.stringMatching(
        /^The purpose of the Recreational Trails Program is to provide for well managed OHV Recreation .* long-term OHV Recreation\.$/,
      ) as string,
      number: '',
      applicantTypes: ['nonprofit', 'local_government', 'state_government', 'education'],
      applicantNote:
        'Cities, counties, districts, state and federal agencies, and 501(c)(3) nonprofit organizations.',
      categories: ['education', 'environment_natural_resources'],
      awardFloor: null,
      awardCeiling: null,
      totalFunding: 3_000_000,
      currency: 'USD',
      openDate: '2026-10-02',
      closeDate: '2026-11-02',
      closeDateText: 'November 2, 2026 at 5:00 PM',
      status: 'active',
      statusReason: expect.stringMatching(/Closes November 2, 2026\.$/) as string,
      unverifiedReason: null,
      sourceStatus: 'active',
      officialUrl: 'https://www.grants.ca.gov/?p=191046',
      fetchedAt: NOW,
      match: null,
    });
  });

  it('reads a sparse listing without filling in what the funder left out', async () => {
    const found = await find([active]);
    expect(byId(found, '152751')).toMatchObject({
      funder: 'CA Department of Education',
      title: '2025–26 After School Education and Safety grant program (Round 2)',
      number: '',
      geographyNote: '',
      applicantNote: '',
      applicantTypes: ['local_government', 'state_government', 'education'],
      categories: ['community_development', 'education'],
      awardFloor: 50_000,
      awardCeiling: 203_500,
      totalFunding: 30_000_000,
      // A deadline at midnight is a date with no time of day.
      closeDate: '2026-12-03',
      closeDateText: 'December 3, 2026',
      status: 'active',
    });
    // A loan with no total stated.
    expect(byId(found, '3300')).toMatchObject({ totalFunding: null, awardFloor: null, awardCeiling: null });
  });

  it('reads amounts as the funder means them, and never as zero', async () => {
    const found = await find([active]);
    // "Between $1.00 and $750,000.00": the dollar is a placeholder, not a floor.
    expect(byId(found, '192465')).toMatchObject({ awardFloor: null, awardCeiling: 750_000, totalFunding: 15_000_000 });
    // A single figure is an estimate per award: a ceiling, never a floor.
    expect(byId(found, '190254')).toMatchObject({ awardFloor: null, awardCeiling: 500_000, totalFunding: 5_000_000 });
    // "Dependant on number of submissions received, application process, etc."
    expect(byId(found, '191046')).toMatchObject({ awardFloor: null, awardCeiling: null });
    for (const listing of found) {
      for (const amount of [listing.awardFloor, listing.awardCeiling, listing.totalFunding]) {
        expect(amount === null || amount > 1).toBe(true);
      }
    }
  });

  it('says when a listing is a loan, since the app has no separate kind for one', async () => {
    const found = await find([active]);
    expect(byId(found, '3300').summary).toMatch(/^Loan\. The Recycling Market Development Zone \(RMDZ\) program/);
    expect(byId(found, '117471').summary).toMatch(/^Grant and loan\. The California Drought, Water, Parks/);
    expect(byId(found, '191046').summary).toMatch(/^The purpose of/);
    expect(found.every((listing) => listing.kind === 'grant')).toBe(true);
    expect(byId(found, '3300').applicantTypes).toEqual([
      'nonprofit',
      'small_business',
      'for_profit',
      'local_government',
      'state_government',
      'education',
    ]);
  });

  it('gives each listing the status the rule allows', async () => {
    const found = await find([activeAndForecasted, closed, active], { statuses: [] });
    const current = await find([active]);

    // Still "active" at the source a day after its deadline: the table lags.
    expect(byId(current, '190254')).toMatchObject({
      status: 'expired',
      statusReason: 'The deadline passed on October 5, 2026.',
      unverifiedReason: null,
      sourceStatus: 'active',
      closeDate: '2026-10-05',
      number: '7612',
    });

    // "Ongoing" is the source saying there is no closing date.
    const ongoing = byId(current, '117471');
    expect(ongoing).toMatchObject({ status: 'active', closeDate: null, closeDateText: 'Ongoing', unverifiedReason: null });
    expect(ongoing.statusReason).toMatch(/with no closing date\.$/);

    // A forecast is never active, and its opening date is read only when it is a date.
    expect(byId(found, '192057')).toMatchObject({
      status: 'unverified',
      unverifiedReason: 'forecast',
      sourceStatus: 'forecasted',
      openDate: '2026-10-01',
      closeDate: null,
      closeDateText: '',
    });
    expect(byId(found, '190194')).toMatchObject({ unverifiedReason: 'forecast', openDate: null });
    expect(byId(found, '171777')).toMatchObject({ unverifiedReason: 'forecast', openDate: null });

    expect(byId(found, '190497')).toMatchObject({
      status: 'expired',
      statusReason: 'The source lists this as closed.',
      sourceStatus: 'closed',
      closeDate: '2026-10-01',
    });
    expect(byId(found, '173037')).toMatchObject({ status: 'expired', awardCeiling: 300_000, totalFunding: null });
  });

  it('never calls a listing active on a deadline it cannot read, or on one it does not have', async () => {
    // Changed: the deadline of an active listing, three ways.
    const worded = await find([withField('191046', 'ApplicationDeadline', 'Until funds are exhausted')]);
    expect(byId(worded, '191046')).toMatchObject({
      status: 'unverified',
      unverifiedReason: 'implausible_deadline',
      closeDate: null,
      closeDateText: 'Until funds are exhausted',
    });
    const missing = await find([withField('191046', 'ApplicationDeadline', null)]);
    expect(byId(missing, '191046')).toMatchObject({ status: 'unverified', unverifiedReason: 'no_deadline', closeDateText: '' });
    const placeholder = await find([withField('191046', 'ApplicationDeadline', '2099-12-31 23:59:00')]);
    expect(byId(placeholder, '191046')).toMatchObject({
      status: 'unverified',
      unverifiedReason: 'implausible_deadline',
      closeDate: '2099-12-31',
    });
    // A deadline written in words that are a date is read as one.
    const inWords = await find([withField('191046', 'ApplicationDeadline', 'November 2, 2026')]);
    expect(byId(inWords, '191046')).toMatchObject({ status: 'active', closeDate: '2026-11-02', closeDateText: 'November 2, 2026' });

    // Changed: a status the portal does not use.
    const paused = await find([withField('191046', 'Status', 'paused')]);
    expect(byId(paused, '191046')).toMatchObject({
      status: 'unverified',
      unverifiedReason: 'detail_unavailable',
      sourceStatus: 'paused',
    });
  });

  it('files a label it does not know under "other" rather than dropping the listing', async () => {
    // Changed: a category and an applicant type the portal does not have today.
    const found = await find([
      changed(active, (result) => {
        const record = result.records.find((item) => item.PortalID === '191046')!;
        record.Categories = 'Education; Space Exploration';
        record.ApplicantType = 'Nonprofit; Special District';
        record.Type = 'Tax Credit';
      }),
    ]);
    expect(byId(found, '191046')).toMatchObject({
      categories: ['education', 'other'],
      applicantTypes: ['nonprofit', 'other'],
    });
    expect(byId(found, '191046').summary).toMatch(/^Tax Credit\. The purpose of/);
  });

  it('removes markup and invisible characters from what the funder wrote', async () => {
    // Changed: a purpose carrying a script, an escaped tag and a right-to-left override.
    const found = await find([
      withField(
        '191046',
        'Purpose',
        `Trails <script>alert(1)</script>for &amp;lt;b&amp;gt;all&amp;lt;/b&amp;gt; communities${String.fromCodePoint(0x202e)}.`,
      ),
    ]);
    expect(byId(found, '191046').summary).toBe('Trails for all communities .');
  });

  it.each([
    ['says the search failed', (result: Loose) => result, { success: false }],
    ['names another dataset', (result: Loose) => (result.resource_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'), {}],
    ['used other filters', (result: Loose) => (result.filters = { Status: ['active', 'closed'] }), {}],
    ['used no filters', (result: Loose) => delete result.filters, {}],
    ['used another limit', (result: Loose) => (result.limit = 100), {}],
    ['started from another row', (result: Loose) => (result.offset = 100), {}],
    ['sorted when it was not asked to', (result: Loose) => (result.sort = 'Title asc'), {}],
  ])('refuses an answer that %s', async (_label, change, envelope) => {
    const altered = changed(active, change);
    Object.assign(altered.response, envelope);
    const failure = find([altered]);
    await expect(failure).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
    await expect(failure).rejects.toThrow(
      /^California Grants Portal could not be read: it (ran a different search|reported a problem)/,
    );
  });

  it.each([
    ['holds fewer listings than it counts', (result: Result) => (result.total = 9)],
    ['holds more listings than it counts', (result: Result) => (result.total = 2)],
    ['gives its count as text', (result: Loose) => (result.total = '6')],
    ['has no list of listings', (result: Loose) => delete result.records],
    [
      'no longer has a field the app reads',
      (result: Loose) => (result.fields = (result.fields as Loose[]).filter((field) => field.id !== 'ApplicationDeadline')),
    ],
    ['has a listing missing that field', (result: Result) => delete result.records[0]!.ApplicationDeadline],
    ['has a number where text belongs', (result: Result) => (result.records[0]!.EstAvailFunds = 3_000_000)],
    ['has a listing with no id', (result: Result) => (result.records[0]!.PortalID = null)],
    ['has a listing whose id is not a number', (result: Result) => (result.records[0]!.PortalID = '191046?p=1')],
    ['has a listing with no title', (result: Result) => (result.records[0]!.Title = '  ')],
    ['has a listing that is not a record', (result: Result) => (result.records[0] = 'row' as unknown as Loose)],
  ])('refuses an answer that %s, instead of returning partial rows', async (_label, change) => {
    const failure = find([changed(active, change as (result: Result) => void)]);
    await expect(failure).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
    await expect(failure).rejects.toThrow(/^California Grants Portal could not be read: /);
  });

  it('refuses an answer that is not a record at all', async () => {
    for (const response of [null, [], 'ok', { success: true }, { success: true, result: [] }]) {
      await expect(find([{ request: active.request, response }])).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
    }
  });

  it('reads a second page when the first is full, and gives up rather than show a short list', async () => {
    const template = active.response.result.records[0]!;
    // Changed: a full first page made of one recorded listing under 1,000
    // different ids, followed by a second page holding the six recorded ones.
    const firstPage = changed(active, (result) => {
      result.records = Array.from({ length: 1000 }, (_, at) => ({ ...template, PortalID: String(500_000 + at) }));
      result.total = 1006;
    });
    const secondPage = changed(active, (result) => {
      result.total = 1006;
      result.offset = 1000;
    });
    secondPage.request = { url: `${active.request.url}&offset=1000` };
    const source = replay([firstPage, secondPage]);
    const found = await caGrantsPortalAdapter.search(filters(), context(source.http));
    expect(source.calls.map((call) => call.url)).toEqual([active.request.url, `${active.request.url}&offset=1000`]);
    // The recorded listing 191046 is on both pages under its own id only once.
    expect(found).toHaveLength(1006);
    expect(new Set(found.map((listing) => listing.id)).size).toBe(1006);

    // Changed: the source counts more listings than three pages can hold.
    const endless = changed(firstPage, (result) => (result.total = 9000));
    const pages = [0, 1000, 2000].map((offset) => {
      const page = changed(endless, (result) => {
        if (offset > 0) result.offset = offset;
      });
      page.request = { url: offset > 0 ? `${active.request.url}&offset=${offset}` : active.request.url };
      return page;
    });
    await expect(find(pages)).rejects.toThrow(
      'California Grants Portal could not be read: it has more listings than can be read at once.',
    );
  });

  it('stops when the search is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      caGrantsPortalAdapter.search(filters(), context(replay([active]).http, NOW, controller.signal)),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});

describe('California Grants Portal listing', () => {
  it('re-reads one listing by its portal id and labels what the funder says', async () => {
    const recorded = recording('detail-191046');
    const source = replay([recorded]);
    const detail = await caGrantsPortalAdapter.detail('191046', context(source.http));

    expect(source.calls.map((call) => call.url)).toEqual([recorded.request.url]);
    expect(params(source.calls[0]!)).toEqual({
      resource_id: '111c8c88-21f6-453c-ae2c-b4785a0624f5',
      filters: '{"PortalID":["191046"]}',
      limit: '2',
    });

    expect(detail.opportunity).toMatchObject({ id: 'ca-grants-portal:191046', status: 'active', closeDate: '2026-11-02' });
    const [purpose, description, ...rest] = detail.description.split('\n\n');
    expect(purpose).toMatch(/^The purpose of the Recreational Trails Program/);
    expect(description).toMatch(/^The Recreational Trails Program \(RTP\) provides funds to develop and maintain/);
    expect(rest).toEqual([]);

    const fact = (label: string) => detail.facts.find((item) => item.label === label)?.value;
    expect(detail.facts.map((item) => item.label)).toEqual([
      'Type of funding',
      'Estimated total funding',
      'Estimated amount per award',
      'Estimated number of awards',
      'Matching funds',
      'Funding source',
      'How funds are paid',
      'Letter of intent required',
      'Award period',
      'Expected award date',
      'Eligible applicants at the source',
      'Categories at the source',
      'Last updated at the source',
      'Contact email',
      'Contact phone',
    ]);
    expect(fact('Type of funding')).toBe('Grant');
    expect(fact('Estimated total funding')).toBe('$3,000,000.00');
    expect(fact('Estimated amount per award')).toBe('Dependant on number of submissions received, application process, etc.');
    expect(fact('Matching funds')).toMatch(/^12%\. Matching funds must be at least 12% of total project costs\./);
    expect(fact('Funding source')).toBe('Federal. Bipartisan Infrastructure Law.');
    expect(fact('Eligible applicants at the source')).toBe('Nonprofit; Public Agency');
    expect(fact('Categories at the source')).toBe('Education; Environment & Water; Parks & Recreation');
    expect(fact('Contact email')).toBe('OHV.grants@parks.ca.gov');
    expect(fact('Contact phone')).toBe('1-916-324-4442');

    expect(detail.links).toEqual([
      { label: 'Listing on the California Grants Portal', url: 'https://www.grants.ca.gov/?p=191046' },
      { label: "Funding agency's page for this listing", url: 'https://ohv.parks.ca.gov/?page_id=24881' },
      { label: 'Online application', url: 'https://olga.ohv.parks.ca.gov/egrams_ohmvr/user/home.aspx' },
      { label: 'Funding agency', url: 'https://ohv.parks.ca.gov/' },
    ]);
  });

  it('keeps out links that are not web addresses, and shows a forecast opening date given in words', async () => {
    const recorded = recording('detail-191046');
    // Changed: the links, the contact and the opening date of the recorded listing.
    const altered = changed(recorded, (result) => {
      Object.assign(result.records[0]!, {
        GrantURL: 'javascript:alert(1)',
        AgencyURL: 'https://user:secret@ohv.parks.ca.gov/',
        ElecSubmission: 'email: OHV.grants@parks.ca.gov;',
        ContactInfo: 'name: OHV.grants@parks.ca.gov; email: OHV.grants@parks.ca.gov; tel: n/a;',
        OpenDate: 'Spring 2027',
      });
    });
    const detail = await caGrantsPortalAdapter.detail('191046', context(replay([altered]).http));
    expect(detail.links).toEqual([
      { label: 'Listing on the California Grants Portal', url: 'https://www.grants.ca.gov/?p=191046' },
    ]);
    const labels = detail.facts.map((item) => item.label);
    // The mailbox written in the name field is not repeated as a contact name.
    expect(labels).not.toContain('Contact');
    expect(labels).not.toContain('Contact phone');
    expect(detail.facts).toContainEqual({ label: 'Applications by email to', value: 'OHV.grants@parks.ca.gov' });
    expect(detail.facts).toContainEqual({ label: 'Expected to open', value: 'Spring 2027' });
    expect(detail.opportunity.openDate).toBeNull();
  });

  it('says so when the portal has no listing with that reference', async () => {
    const recorded = recording('detail-unknown');
    expect(recorded.response.result.records).toEqual([]);
    const failure = caGrantsPortalAdapter.detail('999999999', context(replay([recorded]).http));
    await expect(failure).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(failure).rejects.toThrow(/has no listing with that reference/);
  });

  it('refuses a reference that is not a portal id without asking the source', async () => {
    const source = replay([recording('detail-191046')]);
    for (const id of ['', '0', 'abc', '191046"]}', '../191046', '191046 ', '1234567890123']) {
      await expect(caGrantsPortalAdapter.detail(id, context(source.http))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
    expect(source.calls).toHaveLength(0);
  });

  it('refuses a different listing from the one asked for', async () => {
    // Changed: the answer carries another listing's id.
    const other = changed(recording('detail-191046'), (result) => (result.records[0]!.PortalID = '191047'));
    await expect(caGrantsPortalAdapter.detail('191046', context(replay([other]).http))).rejects.toThrow(
      /returned a different listing/,
    );
  });
});
