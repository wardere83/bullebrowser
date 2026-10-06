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
import { laRampAdapter } from './la-ramp.js';

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
    readFileSync(new URL(`../../../../test-fixtures/funding/sources/la-ramp/${name}.json`, import.meta.url), 'utf8'),
  ) as Recording;

/** Noon UTC on the day of recording: 5 a.m. in Los Angeles. */
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
        throw new FundingError('SOURCE_UNAVAILABLE', 'RAMP Los Angeles could not be read: it answered with status 400.');
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

const search = recording('search');
/** The recorded search with one row changed. */
const searchWith = (rampid: string, change: (row: Loose) => void) => {
  const copy = structuredClone(search);
  change(copy.response.find((row) => row.rampid === rampid)!);
  return copy;
};
const find = (http: HttpClient, now = NOW) => laRampAdapter.search(filters(), context(http, now));
const byId = (listings: Opportunity[], id: string): Opportunity => {
  const found = listings.find((listing) => listing.id === `la-ramp:${id}`);
  if (!found) throw new Error(`No listing ${id} in the result.`);
  return found;
};

describe('RAMP Los Angeles source', () => {
  it('describes itself as a city source of contract solicitations', () => {
    expect(laRampAdapter.info).toMatchObject({
      id: 'la-ramp',
      name: 'RAMP Los Angeles',
      operator: 'City of Los Angeles',
      level: 'city',
      jurisdiction: 'Los Angeles',
      coverage: { country: 'US', region: 'CA', county: '', city: 'Los Angeles' },
      kinds: ['contract_solicitation'],
      homepageUrl: 'https://www.rampla.org/s/',
    });
    expect(laRampAdapter.info.attribution).toMatch(/CC0 1\.0/);
    expect(laRampAdapter.info.note).toMatch(/every filter is applied on this device/);
    expect(laRampAdapter.info.note).toMatch(/not grants/);
  });
});

describe('RAMP Los Angeles search', () => {
  it('asks for every open row by column name and sends nothing about the search', async () => {
    const source = replay([search]);
    const found = await laRampAdapter.search(
      filters({ query: 'youth services', applicantTypes: ['nonprofit'], categories: ['human_services'] }),
      context(source.http),
    );

    expect(source.calls).toHaveLength(1);
    expect(source.calls[0]).toMatchObject({ url: search.request.url, source: 'RAMP Los Angeles' });
    expect(source.calls[0]!.body).toBeUndefined();
    const url = new URL(source.calls[0]!.url);
    expect(url.origin + url.pathname).toBe('https://data.lacity.org/resource/hf3r-utnq.json');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      $select: 'rampid,title,stagename,category,type,bidpost,closedate,department,url',
      $order: 'closedate ASC, rampid ASC',
      $limit: '5000',
    });
    // Everything comes back; the service applies the filters on the device.
    expect(found.map((listing) => listing.id)).toEqual(search.response.map((row) => `la-ramp:${String(row.rampid)}`));
  });

  it('does not ask at all when only grants are wanted', async () => {
    const source = replay([search]);
    expect(await laRampAdapter.search(filters({ kinds: ['grant'] }), context(source.http))).toEqual([]);
    expect(source.calls).toHaveLength(0);
    expect(await laRampAdapter.search(filters({ kinds: ['contract_solicitation'] }), context(source.http))).toHaveLength(12);
  });

  it('reads a complete row, giving its time in Los Angeles rather than UTC', async () => {
    const found = await find(replay([search]).http);
    expect(byId(found, '231883')).toEqual({
      id: 'la-ramp:231883',
      sourceId: 'la-ramp',
      sourceName: 'RAMP Los Angeles',
      funder: 'Cultural Affairs',
      kind: 'contract_solicitation',
      level: 'city',
      country: 'US',
      region: 'CA',
      jurisdiction: 'Los Angeles',
      geographyNote: '',
      title:
        'Neighborhood Engagement Artist Residency (NEAR) and Creative Optimism-Uplifting Promises (CO-UP) Grants (2027-28)',
      summary: 'Category: Personal Services. Solicitation type: RFP - Request For Proposal.',
      number: '231883',
      applicantTypes: [],
      applicantNote: '',
      categories: [],
      awardFloor: null,
      awardCeiling: null,
      totalFunding: null,
      currency: 'USD',
      openDate: '2026-09-18',
      // 06:45 UTC on 31 October is 11:45 pm on the 30th in Los Angeles.
      closeDate: '2026-10-30',
      closeDateText: 'October 30, 2026 at 11:45 PM, Los Angeles time',
      status: 'active',
      statusReason: expect.stringMatching(/Closes October 30, 2026\.$/) as string,
      unverifiedReason: null,
      sourceStatus: 'Open',
      officialUrl: 'https://www.rampla.org/s/opportunity-details?id=006Ql00000lDYK9IAO',
      fetchedAt: NOW,
      match: null,
    });
  });

  it('agrees with the closing time the County writes in its own title', async () => {
    const found = await find(replay([search]).http);
    const county = byId(found, '232376');
    expect(county.title).toMatch(/Closing: 10\/14\/2026 3:00 PM$/);
    expect(county.closeDateText).toBe('October 14, 2026 at 3:00 PM, Los Angeles time');
    // Posted at 02:30 UTC on the 6th, which is the evening of the 5th locally.
    expect(county.openDate).toBe('2026-10-05');
    // In December the same zone is an hour further from UTC.
    expect(byId(found, '232319').closeDateText).toBe('December 18, 2026 at 12:00 PM, Los Angeles time');
  });

  it('files a County posting as a county listing and names every other agency as the funder', async () => {
    const found = await find(replay([search]).http);
    expect(byId(found, '232376')).toMatchObject({
      funder: 'Los Angeles County',
      level: 'county',
      jurisdiction: 'Los Angeles County',
      region: 'CA',
      // The source writes "None" where it has no type.
      summary: 'Category: Personal Services.',
    });
    expect(byId(found, '231831')).toMatchObject({ funder: 'Port of Long Beach', level: 'city', jurisdiction: 'Los Angeles' });
    expect(byId(found, '232195').funder).toBe('Metro');
    expect(byId(found, '231906')).toMatchObject({
      funder: 'LAUSD',
      summary: 'Solicitation type: RFP - Request For Proposal.',
    });
  });

  it('gives each row the status the rule allows', async () => {
    const found = await find(replay([search]).http);
    const statusOf = (id: string) => {
      const { status, unverifiedReason } = byId(found, id);
      return unverifiedReason ? `${status}: ${unverifiedReason}` : status;
    };

    // Closing later today, in a few days, and in 2031: all still to come.
    expect(statusOf('232282')).toBe('active');
    expect(byId(found, '232282').closeDate).toBe('2026-10-06');
    expect(statusOf('232376')).toBe('active');
    expect(statusOf('217198')).toBe('active');
    // "Amended" is still open at the source.
    expect(byId(found, '232033')).toMatchObject({ status: 'active', sourceStatus: 'Amended' });

    // More than five years out reads as a placeholder: a standing list closing
    // in November 2031 and the practice listing closing in 2037.
    expect(statusOf('217104')).toBe('unverified: implausible_deadline');
    expect(byId(found, '217104').closeDate).toBe('2031-11-01');
    expect(statusOf('30751')).toBe('unverified: implausible_deadline');
    expect(byId(found, '30751').statusReason).toMatch(/June 30, 2037, which looks like a placeholder/);

    // Marked "Open", with no closing date and "*CANCELLED*" in its own title.
    const cancelled = byId(found, '229205');
    expect(cancelled).toMatchObject({
      status: 'unverified',
      unverifiedReason: 'source_contradiction',
      sourceStatus: 'Open',
      closeDate: null,
      closeDateText: '',
    });
    expect(cancelled.statusReason).toMatch(/its own text says: "\*CANCELLED\* BEST VALUE/);

    expect(found.filter((listing) => listing.status === 'active')).toHaveLength(9);
  });

  it('expires a row whose closing time has passed, even though the source still lists it', async () => {
    // The same answer read two weeks later.
    const later = Date.UTC(2026, 9, 20, 12, 0, 0);
    const found = await find(replay([search]).http, later);
    expect(byId(found, '232376')).toMatchObject({
      status: 'expired',
      statusReason: 'The deadline passed on October 14, 2026.',
      fetchedAt: later,
    });
    expect(byId(found, '231883').status).toBe('active');
  });

  it('never calls a row active without a closing date, a link on the marketplace or a stage it knows', async () => {
    // Changed: an ordinary open row with its closing date removed.
    const undated = await find(replay([searchWith('232319', (row) => delete row.closedate)]).http);
    expect(byId(undated, '232319')).toMatchObject({ status: 'unverified', unverifiedReason: 'no_deadline', closeDate: null });

    // Changed: the link points away from the marketplace's own site.
    const elsewhere = await find(
      replay([searchWith('232319', (row) => (row.url = { url: 'https://rampla.org.example.com/s/opportunity-details?id=1' }))]).http,
    );
    expect(byId(elsewhere, '232319')).toMatchObject({
      status: 'unverified',
      unverifiedReason: 'no_official_link',
      officialUrl: '',
    });
    // Changed: no link at all. The row is still returned.
    const unlinked = await find(replay([searchWith('232319', (row) => delete row.url)]).http);
    expect(byId(unlinked, '232319')).toMatchObject({ unverifiedReason: 'no_official_link', officialUrl: '' });

    // Changed: a stage the source has not used before.
    const staged = await find(replay([searchWith('232319', (row) => (row.stagename = 'Evaluation'))]).http);
    expect(byId(staged, '232319')).toMatchObject({
      status: 'unverified',
      unverifiedReason: 'detail_unavailable',
      sourceStatus: 'Evaluation',
    });
  });

  it('removes markup and invisible characters from what the source sends', async () => {
    // Changed: a title carrying a script, an entity and a zero-width space.
    const hostile = await find(
      replay([
        searchWith('232319', (row) => {
          row.title = `Family <script>alert(1)</script>Services &amp; Support${String.fromCodePoint(0x200b)}`;
        }),
      ]).http,
    );
    expect(byId(hostile, '232319').title).toBe('Family Services & Support');
  });

  it.each([
    ['an error object', { message: 'Invalid SoQL query', error: true }],
    ['a row with no id', [{ ...search.response[0], rampid: undefined }]],
    ['a row whose id is not a number', [{ ...search.response[0], rampid: '232282; DROP' }]],
    ['a row with no title', [{ ...search.response[0], title: '   ' }]],
    ['a closing date that is not a timestamp', [{ ...search.response[0], closedate: 'soon' }]],
  ])('refuses %s instead of returning partial rows', async (_label, response) => {
    const failure = find(replay([{ request: search.request, response }]).http);
    await expect(failure).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
    await expect(failure).rejects.toThrow(/^RAMP Los Angeles could not be read: /);
  });

  it('reports the source as unavailable when the request fails, and stops when cancelled', async () => {
    await expect(find(replay([]).http)).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
    const controller = new AbortController();
    controller.abort();
    await expect(
      laRampAdapter.search(filters(), context(replay([search]).http, NOW, controller.signal)),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});

describe('RAMP Los Angeles listing', () => {
  it('re-reads one row by its id and labels what the source says', async () => {
    const recorded = recording('detail-232376');
    const source = replay([recorded]);
    const detail = await laRampAdapter.detail('232376', context(source.http));

    expect(source.calls).toHaveLength(1);
    expect(source.calls[0]!.url).toBe(recorded.request.url);
    expect(new URL(source.calls[0]!.url).searchParams.get('$where')).toBe("rampid='232376'");

    expect(detail.opportunity).toMatchObject({
      id: 'la-ramp:232376',
      status: 'active',
      level: 'county',
      closeDate: '2026-10-14',
      officialUrl: 'https://www.rampla.org/s/opportunity-details?id=006Ql00000majhKIAQ',
    });
    expect(detail.description).toBe('');
    expect(detail.facts).toEqual([
      { label: 'Posting agency', value: 'Los Angeles County' },
      { label: 'Category at the source', value: 'Personal Services' },
      { label: 'Stage at the source', value: 'Open' },
      { label: 'Posted', value: 'October 5, 2026 at 7:30 PM, Los Angeles time' },
      { label: 'RAMP ID', value: '232376' },
    ]);
    expect(detail.links).toEqual([
      { label: 'Listing on RAMP', url: 'https://www.rampla.org/s/opportunity-details?id=006Ql00000majhKIAQ' },
    ]);
  });

  it('says a listing has gone when the source no longer has it', async () => {
    const recorded = recording('detail-unknown');
    expect(recorded.response).toEqual([]);
    const failure = laRampAdapter.detail('1', context(replay([recorded]).http));
    await expect(failure).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(failure).rejects.toThrow(/no longer lists this/);
  });

  it('refuses a reference that is not a RAMP id without asking the source', async () => {
    const source = replay([recording('detail-232376')]);
    for (const id of ['', 'abc', "232376' OR '1'='1", '../232376', '232376 ', '1234567890123']) {
      await expect(laRampAdapter.detail(id, context(source.http))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
    expect(source.calls).toHaveLength(0);
  });

  it('refuses a different row from the one asked for', async () => {
    const recorded = recording('detail-232376');
    // Changed: the answer carries another listing's id.
    const other = { request: recorded.request, response: [{ ...recorded.response[0], rampid: '232377' }] };
    await expect(laRampAdapter.detail('232376', context(replay([other]).http))).rejects.toThrow(
      /returned a different listing/,
    );
  });
});
