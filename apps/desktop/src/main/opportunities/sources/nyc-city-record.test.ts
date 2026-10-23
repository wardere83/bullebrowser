import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPPORTUNITY_FILTERS,
  type Opportunity,
  type OpportunityFilters,
} from '../../../shared/funding.js';
import { FundingError } from '../../funding/errors.js';
import type { HttpClient, HttpRequest } from '../http.js';
import type { SourceContext } from '../types.js';
import { nycCityRecordAdapter, SERVICE_CATEGORIES } from './nyc-city-record.js';

// Every answer below was recorded from the live source on 6 October 2026 (see
// the README beside the fixtures). Where a test needs an answer the source did
// not give that day, it changes one field of a recorded row and says so.

type Loose = Record<string, unknown>;

interface Recording {
  recordedOn: string;
  request: { url: string };
  response: Loose[];
}

const recording = (name: string): Recording =>
  JSON.parse(
    readFileSync(new URL(`../../../../test-fixtures/funding/sources/nyc-city-record/${name}.json`, import.meta.url), 'utf8'),
  ) as Recording;

/** Noon UTC on the day of recording: 8 a.m. in New York. */
const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);
const NOTICE = 'https://a856-cityrecord.nyc.gov/RequestDetail/';
const PASSPORT = {
  label: "PASSPort, the City's procurement portal",
  url: 'https://passport.cityofnewyork.us/page.aspx/en/rfp/request_browse_public',
};

/** A source that answers only the exact requests that were recorded. */
function replay(recordings: { request: { url: string }; response: unknown }[]) {
  const calls: HttpRequest[] = [];
  const http: HttpClient = {
    async json<T>(request: HttpRequest): Promise<T> {
      calls.push(request);
      if (request.signal.aborted) throw new FundingError('CANCELLED', 'Cancelled.');
      const match = recordings.find((item) => item.request.url === request.url);
      if (!match) {
        throw new FundingError('SOURCE_UNAVAILABLE', 'NYC City Record Online could not be read: it answered with status 400.');
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
const param = (call: HttpRequest, name: string) => new URL(call.url).searchParams.get(name);

const open = recording('search-open');
const outline = recording('search-past-outline');
const past = recording('search-past');
/** A recording with one of its rows changed. */
const changed = (original: Recording, id: string, change: (row: Loose) => void): Recording => {
  const copy = structuredClone(original);
  change(copy.response.find((row) => row.request_id === id)!);
  return copy;
};
const find = (recordings: Recording[], patch: Partial<OpportunityFilters> = {}, now = NOW) =>
  nycCityRecordAdapter.search(filters(patch), context(replay(recordings).http, now));
const byId = (listings: Opportunity[], id: string): Opportunity => {
  const found = listings.find((listing) => listing.id === `nyc-city-record:${id}`);
  if (!found) throw new Error(`No listing ${id} in the result.`);
  return found;
};
const ids = (listings: Opportunity[]) => listings.map((listing) => listing.id.replace('nyc-city-record:', ''));

const SCOPE =
  "section_name='Procurement' AND type_of_notice_description='Solicitation' AND " +
  "category_description in('Human Services/Client Services','Services (other than human services)','Goods and Services')";

describe('NYC City Record source', () => {
  it('describes itself as a city source of contract solicitations', () => {
    expect(nycCityRecordAdapter.info).toMatchObject({
      id: 'nyc-city-record',
      name: 'NYC City Record Online',
      operator: 'New York City Department of Citywide Administrative Services',
      level: 'city',
      jurisdiction: 'New York City',
      coverage: { country: 'US', region: 'NY', county: '', city: 'New York' },
      kinds: ['contract_solicitation'],
      homepageUrl: 'https://a856-cityrecord.nyc.gov/',
    });
    expect(nycCityRecordAdapter.info.attribution).toMatch(/Public domain/);
    expect(nycCityRecordAdapter.info.note).toMatch(/every filter is applied on this device/);
    expect(nycCityRecordAdapter.info.note).toMatch(/not grants/);
    expect(SERVICE_CATEGORIES).toEqual([
      'Human Services/Client Services',
      'Services (other than human services)',
      'Goods and Services',
    ]);
  });
});

describe('NYC City Record search', () => {
  it('asks for open solicitations in the service categories, and for recent past ones in outline', async () => {
    const source = replay([open, outline, past]);
    const found = await nycCityRecordAdapter.search(
      filters({ query: 'supportive housing', applicantTypes: ['nonprofit'], categories: ['housing'] }),
      context(source.http),
    );

    expect(source.calls.map((call) => call.url)).toEqual([open.request.url, outline.request.url]);
    expect(source.calls.every((call) => call.source === 'NYC City Record Online' && call.body === undefined)).toBe(true);

    const first = new URL(source.calls[0]!.url);
    expect(first.origin + first.pathname).toBe('https://data.cityofnewyork.us/resource/dg92-zbpx.json');
    // Awards and intents to award are never asked for, and nothing about the search is sent.
    expect(param(source.calls[0]!, '$where')).toBe(`${SCOPE} AND due_date >= '2026-10-06T00:00:00'`);
    expect(param(source.calls[0]!, '$order')).toBe('due_date ASC, request_id ASC');
    expect(param(source.calls[0]!, '$limit')).toBe('2000');
    expect(param(source.calls[0]!, '$select')).toMatch(/^request_id,start_date,end_date,agency_name,/);

    expect(param(source.calls[1]!, '$where')).toBe(`${SCOPE} AND due_date < '2026-10-06T00:00:00'`);
    expect(param(source.calls[1]!, '$order')).toBe('due_date DESC, request_id DESC');
    expect(param(source.calls[1]!, '$limit')).toBe('200');
    expect(param(source.calls[1]!, '$select')).toBe('request_id,start_date,agency_name,pin,due_date,short_title');

    expect(found).toHaveLength(10);
  });

  it("dates the query by New York's calendar, not UTC's", async () => {
    // 02:00 UTC on 7 October is still the evening of the 6th in New York.
    const source = replay([open, outline]);
    await nycCityRecordAdapter.search(filters(), context(source.http, Date.UTC(2026, 9, 7, 2, 0, 0)));
    expect(param(source.calls[0]!, '$where')).toMatch(/due_date >= '2026-10-06T00:00:00'$/);
  });

  it('reads past solicitations in full when expired listings are wanted', async () => {
    for (const statuses of [['expired'], []] as OpportunityFilters['statuses'][]) {
      const source = replay([open, outline, past]);
      const found = await nycCityRecordAdapter.search(filters({ statuses }), context(source.http));
      // The open ones are still read: one of them may be the latest word on a past notice.
      expect(source.calls.map((call) => call.url)).toEqual([open.request.url, past.request.url]);
      expect(found).toHaveLength(13);
    }
  });

  it('does not ask at all when only grants are wanted', async () => {
    const source = replay([open, outline]);
    expect(await nycCityRecordAdapter.search(filters({ kinds: ['grant'] }), context(source.http))).toEqual([]);
    expect(source.calls).toHaveLength(0);
  });

  it('reads a complete notice, with the City category as context rather than as a funding category', async () => {
    const listing = byId(await find([open, outline]), '20260924014');
    expect(listing).toMatchObject({
      id: 'nyc-city-record:20260924014',
      sourceId: 'nyc-city-record',
      sourceName: 'NYC City Record Online',
      funder: 'NYC Health + Hospitals',
      kind: 'contract_solicitation',
      level: 'city',
      country: 'US',
      region: 'NY',
      jurisdiction: 'New York City',
      geographyNote: '',
      title: 'Medical Malpractice Defense Services',
      number: '2872',
      applicantTypes: [],
      applicantNote: '',
      categories: [],
      awardFloor: null,
      awardCeiling: null,
      totalFunding: null,
      currency: 'USD',
      openDate: '2026-10-01',
      closeDate: '2026-11-02',
      closeDateText: 'November 2, 2026 at 5:00 PM',
      status: 'active',
      unverifiedReason: null,
      sourceStatus: 'Solicitation',
      officialUrl: `${NOTICE}20260924014`,
      fetchedAt: NOW,
      match: null,
    });
    expect(listing.statusReason).toMatch(/Closes November 2, 2026\.$/);
    expect(listing.summary).toMatch(
      /^Human Services\/Client Services\. Request for Proposals\. NYC Health \+ Hospitals seeks to obtain proposals from law firms/,
    );
    // The description arrives as styled HTML of about 3,000 characters.
    expect(listing.summary).not.toMatch(/[<>]|font-family|&nbsp;/);
    expect(listing.summary.length).toBeLessThanOrEqual(601);
    expect(listing.summary.endsWith('…')).toBe(true);
  });

  it('reads a sparse notice without inventing what it leaves out', async () => {
    const listing = byId(await find([open, outline]), '20260903027');
    expect(listing).toMatchObject({
      funder: 'Parks and Recreation',
      title: 'CNYG-2124M Industrial Hygiene Svcs at Various Park Locations',
      number: '84626B0096',
      closeDate: '2026-10-08',
      closeDateText: 'October 8, 2026 at 10:30 AM',
      status: 'active',
      totalFunding: null,
      applicantTypes: [],
      categories: [],
    });
    expect(listing.summary).toMatch(
      /^Services \(other than human services\)\. Competitive Sealed Bids\. This Procurement is subject to Section 6-129/,
    );
  });

  it('shows only the latest notice for a procurement', async () => {
    const found = await find([open, outline]);
    // Three notices for the same supportive-housing procurement were open that
    // day, due in 2026, 2034 and 2034. The latest one says 31 December 2026.
    expect(ids(found)).toEqual([
      '20260903027',
      '20260825032',
      '20260923001',
      '20260924014',
      '20260408021',
      '20221021120',
      '20260415039',
      '20220805113',
      '20210623125',
      '20200727109',
    ]);
    expect(byId(found, '20260408021')).toMatchObject({
      // The City's title has a control character where a dash once was.
      title: 'OPEN-ENDED JUSTICE INVOLVED SUPPORTIVE HOUSING (JISH)',
      number: '81622P0004',
      closeDate: '2026-12-31',
      closeDateText: 'December 31, 2026 at 11:59 PM',
      status: 'active',
    });
    // The extension of a board's solicitation replaces the notice it extends,
    // which fell due a week earlier and is among the past ones.
    expect(byId(found, '20260923001').closeDate).toBe('2026-10-30');
    expect(ids(await find([open, outline, past], { statuses: [] }))).not.toContain('20260811020');
  });

  it('keeps notices apart when their procurement number is a label, not a number', async () => {
    const found = await find([open, outline]);
    // Both carry "Emergency Solicitati" where the number belongs.
    expect(byId(found, '20221021120').number).toBe('Emergency Solicitati');
    expect(byId(found, '20220805113').number).toBe('Emergency Solicitati');
  });

  it('lets a later past notice withdraw an earlier one that still looks open', async () => {
    // Changed: the past notice for the board's procurement is dated after the open one.
    const later = (recorded: Recording) =>
      changed(recorded, '20260811020', (row) => (row.start_date = '2026-10-02T00:00:00.000'));
    expect(ids(await find([open, later(outline)]))).not.toContain('20260923001');

    const withExpired = await find([open, later(past)], { statuses: [] });
    expect(ids(withExpired)).not.toContain('20260923001');
    expect(byId(withExpired, '20260811020')).toMatchObject({
      status: 'expired',
      statusReason: 'The deadline passed on September 30, 2026.',
    });
  });

  it('gives each notice the status the rule allows', async () => {
    const found = await find([open, outline]);
    const statusOf = (id: string) => {
      const { status, unverifiedReason } = byId(found, id);
      return unverifiedReason ? `${status}: ${unverifiedReason}` : status;
    };

    expect(statusOf('20260903027')).toBe('active');
    // An emergency solicitation due in 2028 is within reach of a real deadline.
    expect(statusOf('20221021120')).toBe('active');

    // Open-ended solicitations carry placeholder dates, passed on as written.
    expect(statusOf('20260415039')).toBe('unverified: implausible_deadline');
    expect(byId(found, '20260415039')).toMatchObject({ closeDate: '2099-12-31', closeDateText: 'December 31, 2099' });
    expect(byId(found, '20260415039').statusReason).toMatch(/December 31, 2099, which looks like a placeholder/);
    expect(statusOf('20220805113')).toBe('unverified: implausible_deadline');

    // Due in the year 9999, and its own text says it is over.
    const over = byId(found, '20210623125');
    expect(over).toMatchObject({ status: 'unverified', unverifiedReason: 'source_contradiction', closeDate: '9999-01-04' });
    expect(over.statusReason).toBe(
      'The source lists this as open, but its own text says: "This notification is to announce that this Request for Proposals is now closed."',
    );
    // Typed "Solicitation", titled "Cancellation".
    const cancelled = byId(found, '20200727109');
    expect(cancelled).toMatchObject({ status: 'unverified', unverifiedReason: 'source_contradiction' });
    expect(cancelled.statusReason).toMatch(/its own text says: "Cancellation: LANDSCAPE MAINTENANCE"/);

    expect(found.filter((listing) => listing.status === 'active')).toHaveLength(6);
  });

  it('expires a notice whose due date has passed, whatever else it says', async () => {
    const found = await find([open, past], { statuses: ['expired'] });
    expect(byId(found, '20260825023')).toMatchObject({
      status: 'expired',
      statusReason: 'The deadline passed on September 30, 2026.',
      title: 'Correction: Post Acute Care Debt Collection Services',
      closeDateText: 'September 30, 2026 at 5:00 PM',
    });
    // A cancellation notice whose date has passed is simply expired.
    expect(byId(found, '20260319029')).toMatchObject({ status: 'expired', unverifiedReason: null });
    // The bid extension is hidden behind the later notice for the same number.
    expect(ids(found)).toContain('20260429002');
    expect(ids(found)).not.toContain('20260227028');
  });

  it('does not rely on the City to leave out what has passed', async () => {
    // Changed: the same rows, given as the answer to the query of a month later.
    const aMonthOn = (recorded: Recording): Recording => ({
      ...recorded,
      request: { url: recorded.request.url.replace('2026-10-06T00%3A00%3A00', '2026-11-06T00%3A00%3A00') },
    });
    const found = await find([aMonthOn(open), aMonthOn(outline)], {}, Date.UTC(2026, 10, 6, 12, 0, 0));
    expect(byId(found, '20260924014')).toMatchObject({
      status: 'expired',
      statusReason: 'The deadline passed on November 2, 2026.',
    });
    expect(byId(found, '20260408021').status).toBe('active');
  });

  it('does not mistake an ordinary deadline rule for a closed solicitation', async () => {
    // Changed: the description ends with the rule every solicitation carries.
    const ruled = changed(open, '20260903027', (row) => {
      row.additional_description_1 =
        `${String(row.additional_description_1)}<p>Late bids will no longer be accepted after the due date.</p>`;
    });
    expect(byId(await find([ruled, outline]), '20260903027').status).toBe('active');
    // Changed: the description says the agency has stopped taking proposals.
    const stopped = changed(open, '20260903027', (row) => {
      row.additional_description_1 = '<p>Please note: the Agency is no longer accepting proposals.</p>';
    });
    expect(byId(await find([stopped, outline]), '20260903027')).toMatchObject({
      status: 'unverified',
      unverifiedReason: 'source_contradiction',
    });
  });

  it('removes markup, scripts and invisible characters from what the City sends', async () => {
    // Changed: a description carrying a script and an escaped tag.
    const hostile = changed(open, '20260903027', (row) => {
      row.additional_description_1 =
        "<p>Hygiene <script>fetch('https://evil.example')</script>services " +
        `&amp;lt;img src=x onerror=alert(1)&amp;gt; citywide${String.fromCodePoint(0x202e)}</p>`;
    });
    const listing = byId(await find([hostile, outline]), '20260903027');
    expect(listing.summary).toBe(
      'Services (other than human services). Competitive Sealed Bids. Hygiene services citywide',
    );
  });

  it.each([
    ['an error object', { message: 'Invalid SoQL query', error: true }],
    ['a notice with no id', [{ ...open.response[0], request_id: undefined }]],
    ['a notice whose id is not a number', [{ ...open.response[0], request_id: '2026-09-03' }]],
    ['a notice with no title', [{ ...open.response[0], short_title: '' }]],
    ['a due date that is not a timestamp', [{ ...open.response[0], due_date: 'TBD' }]],
  ])('refuses %s instead of returning partial rows', async (_label, response) => {
    const failure = find([{ ...open, response: response as Loose[] }, outline]);
    await expect(failure).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
    await expect(failure).rejects.toThrow(/^NYC City Record Online could not be read: /);
  });

  it.each([
    ['an award', { type_of_notice_description: 'Award' }],
    ['a notice from another section', { section_name: 'Public Hearings and Meetings' }],
    ['a category that was not asked for', { category_description: 'Goods' }],
  ])('refuses the whole answer when it holds %s', async (_label, patch) => {
    // Changed: one field of the first open row.
    const failure = find([{ ...open, response: [{ ...open.response[0], ...patch }] }, outline]);
    await expect(failure).rejects.toThrow('NYC City Record Online could not be read: it returned notices that were not asked for.');
  });

  it('stops when the search is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      nycCityRecordAdapter.search(filters(), context(replay([open, outline]).http, NOW, controller.signal)),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});

describe('NYC City Record listing', () => {
  it('re-reads one notice and labels what the City says', async () => {
    const recorded = recording('detail-20260924014');
    const source = replay([recorded]);
    const detail = await nycCityRecordAdapter.detail('20260924014', context(source.http));

    // Its procurement number is too short to tie it to other notices, so nothing else is asked.
    expect(source.calls.map((call) => call.url)).toEqual([recorded.request.url]);
    expect(param(source.calls[0]!, '$where')).toBe(
      "section_name='Procurement' AND type_of_notice_description='Solicitation' AND request_id=20260924014",
    );

    expect(detail.opportunity).toMatchObject({ id: 'nyc-city-record:20260924014', status: 'active', closeDate: '2026-11-02' });
    expect(detail.facts).toEqual([
      { label: 'Category at the source', value: 'Human Services/Client Services' },
      { label: 'Selection method', value: 'Request for Proposals' },
      { label: 'First published in the City Record', value: 'October 1, 2026' },
      { label: 'Where to request the solicitation', value: '50 Water Street, 5th Floor, New York, NY 10004' },
      { label: 'Contact email', value: 'rfp_contacts@nychhc.org' },
    ]);
    expect(detail.links).toEqual([{ label: 'Notice in the City Record Online', url: `${NOTICE}20260924014` }, PASSPORT]);
    const paragraphs = detail.description.split('\n\n');
    expect(paragraphs[0]).toMatch(/^NYC Health \+ Hospitals seeks to obtain proposals from law firms/);
    expect(paragraphs.length).toBeGreaterThan(3);
    expect(detail.description).not.toMatch(/[<>]/);
  });

  it('points to the later notice when the City has issued one for the same procurement', async () => {
    const recorded = recording('detail-20250206003');
    const latest = recording('latest-notice-81622P0004');
    const source = replay([recorded, latest]);
    const detail = await nycCityRecordAdapter.detail('20250206003', context(source.http));

    expect(source.calls.map((call) => call.url)).toEqual([recorded.request.url, latest.request.url]);
    expect(param(source.calls[1]!, '$where')).toBe(
      "section_name='Procurement' AND type_of_notice_description='Solicitation' AND agency_name='Health and Mental Hygiene' AND pin='81622P0004'",
    );
    expect(param(source.calls[1]!, '$order')).toBe('start_date DESC, request_id DESC');
    expect(param(source.calls[1]!, '$limit')).toBe('1');

    // This notice still says 2034; it is reported as it stands, with the way to the later one.
    expect(detail.opportunity).toMatchObject({
      status: 'unverified',
      unverifiedReason: 'implausible_deadline',
      closeDate: '2034-12-29',
    });
    expect(detail.facts[0]).toEqual({
      label: 'Later notice for this procurement',
      value:
        'OPEN-ENDED JUSTICE INVOLVED SUPPORTIVE HOUSING (JISH), published April 15, 2026, due December 31, 2026 at 11:59 PM',
    });
    expect(detail.links).toEqual([
      { label: 'Notice in the City Record Online', url: `${NOTICE}20250206003` },
      { label: 'Latest notice for this procurement', url: `${NOTICE}20260408021` },
      PASSPORT,
    ]);
  });

  it('lists the documents the City attaches, and says nothing of a later notice when this is the latest', async () => {
    const source = replay([recording('detail-20200727109'), recording('latest-notice-85620B0005')]);
    const detail = await nycCityRecordAdapter.detail('20200727109', context(source.http));

    expect(source.calls).toHaveLength(2);
    expect(detail.facts.map((fact) => fact.label)).not.toContain('Later notice for this procurement');
    expect(detail.opportunity).toMatchObject({ status: 'unverified', unverifiedReason: 'source_contradiction' });
    // Six addresses arrive packed into one value, with "&" written as an entity.
    const documents = detail.links.filter((link) => link.label.startsWith('Document attached'));
    expect(documents).toHaveLength(6);
    expect(documents[0]).toEqual({
      label: 'Document attached to the notice (1)',
      url: 'https://a856-cityrecord.nyc.gov/Search/GetFile?SectionID=6&RequestStatus=Current&RequestID=20200727109&DocumentID=30276',
    });
    expect(documents[5]!.url).toMatch(/DocumentID=30897$/);
    expect(detail.links[detail.links.length - 1]).toEqual(PASSPORT);
  });

  it('leaves out an attached address that is not on a City site', async () => {
    const recorded = recording('detail-20200727109');
    // Changed: the attached addresses point elsewhere.
    const altered = {
      request: recorded.request,
      response: [
        {
          ...recorded.response[0],
          document_links: { url: 'https://nyc.gov.example.com/file?id=1,javascript:alert(1),http://a856-cityrecord.nyc.gov/x' },
        },
      ],
    };
    const detail = await nycCityRecordAdapter.detail(
      '20200727109',
      context(replay([altered, recording('latest-notice-85620B0005')]).http),
    );
    expect(detail.links.map((link) => link.label)).toEqual(['Notice in the City Record Online', PASSPORT.label]);
  });

  it('says so when the City has no solicitation with that reference', async () => {
    const recorded = recording('detail-unknown');
    expect(recorded.response).toEqual([]);
    const failure = nycCityRecordAdapter.detail('19990101001', context(replay([recorded]).http));
    await expect(failure).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(failure).rejects.toThrow(/has no solicitation with that reference/);
  });

  it('refuses a reference that is not a request id without asking the source', async () => {
    const source = replay([recording('detail-20260924014')]);
    for (const id of ['', 'abc', '20260924014 OR 1=1', "20260924014'", '../20260924014', '12345', '123456789012345']) {
      await expect(nycCityRecordAdapter.detail(id, context(source.http))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
    expect(source.calls).toHaveLength(0);
  });

  it('refuses a different notice from the one asked for', async () => {
    const recorded = recording('detail-20260924014');
    // Changed: the answer carries another notice's id.
    const other = { request: recorded.request, response: [{ ...recorded.response[0], request_id: '20260924015' }] };
    await expect(nycCityRecordAdapter.detail('20260924014', context(replay([other]).http))).rejects.toThrow(
      /returned a different listing/,
    );
  });
});
