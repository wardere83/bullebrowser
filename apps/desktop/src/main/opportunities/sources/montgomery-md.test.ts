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
import { montgomeryMdAdapter } from './montgomery-md.js';

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
    readFileSync(new URL(`../../../../test-fixtures/funding/sources/montgomery-md/${name}.json`, import.meta.url), 'utf8'),
  ) as Recording;

/** Noon UTC on the day of recording: 8 a.m. in Montgomery County. */
const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);
const FORMAL_PAGE = 'https://www.montgomerycountymd.gov/office-procurement/solicitations-contracts/formal-solicitations';
const INFORMAL_PAGE =
  'https://www.montgomerycountymd.gov/office-procurement/solicitations-contracts/informal-open-solicitations';

/** A source that answers only the exact requests that were recorded. */
function replay(recordings: { request: { url: string }; response: unknown }[]) {
  const calls: HttpRequest[] = [];
  const http: HttpClient = {
    async json<T>(request: HttpRequest): Promise<T> {
      calls.push(request);
      if (request.signal.aborted) throw new FundingError('CANCELLED', 'Cancelled.');
      const match = recordings.find((item) => item.request.url === request.url);
      if (!match) {
        throw new FundingError(
          'SOURCE_UNAVAILABLE',
          'Montgomery County Solicitations could not be read: it answered with status 400.',
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
const where = (call: HttpRequest) => new URL(call.url).searchParams.get('$where');

const active = recording('search-active');
const closed = recording('search-closed');
/** The recorded Active rows with one row changed. */
const activeWith = (number: string, change: (row: Loose) => void) => {
  const copy = structuredClone(active);
  change(copy.response.find((row) => row.number === number)!);
  return copy;
};
const find = (http: HttpClient, now = NOW) => montgomeryMdAdapter.search(filters(), context(http, now));
const byId = (listings: Opportunity[], number: string): Opportunity => {
  const found = listings.find((listing) => listing.id === `montgomery-md:${number}`);
  if (!found) throw new Error(`No listing ${number} in the result.`);
  return found;
};

describe('Montgomery County source', () => {
  it('describes itself as a county source of contract solicitations', () => {
    expect(montgomeryMdAdapter.info).toMatchObject({
      id: 'montgomery-md',
      name: 'Montgomery County Solicitations',
      operator: 'Montgomery County Office of Procurement',
      level: 'county',
      jurisdiction: 'Montgomery County',
      coverage: { country: 'US', region: 'MD', county: 'Montgomery County', city: '' },
      kinds: ['contract_solicitation'],
      // The county states no licence for the dataset.
      attribution: '',
    });
    expect(montgomeryMdAdapter.info.homepageUrl).toMatch(/^https:\/\/www\.montgomerycountymd\.gov\//);
    expect(montgomeryMdAdapter.info.note).toMatch(/applies the status filter itself/);
    expect(montgomeryMdAdapter.info.note).toMatch(/not grants/);
  });
});

describe('Montgomery County search', () => {
  it('asks only for Active rows when expired listings are not wanted', async () => {
    const source = replay([active, closed]);
    const found = await montgomeryMdAdapter.search(
      filters({ query: 'security', statuses: ['active', 'unverified'] }),
      context(source.http),
    );

    expect(source.calls).toHaveLength(1);
    expect(source.calls[0]).toMatchObject({ url: active.request.url, source: 'Montgomery County Solicitations' });
    const url = new URL(source.calls[0]!.url);
    expect(url.origin + url.pathname).toBe('https://data.montgomerycountymd.gov/resource/eeq6-nnwe.json');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      $select:
        'status,type,number,description,issuancedate,closingdate,cancelledpostponed,construction,lsbrpindicator,buyer,department,deptcontact,bidtab',
      $where: "status='Active'",
      $order: 'closingdate ASC, number ASC',
      $limit: '2000',
    });
    // The keyword is not sent; every Active row comes back for the device to filter.
    expect(found).toHaveLength(16);
  });

  it('also asks for the latest dated Closed rows when expired listings are wanted', async () => {
    for (const statuses of [['expired'], []] as OpportunityFilters['statuses'][]) {
      const source = replay([active, closed]);
      const found = await montgomeryMdAdapter.search(filters({ statuses }), context(source.http));
      expect(source.calls.map((call) => call.url)).toEqual([active.request.url, closed.request.url]);
      expect(where(source.calls[1]!)).toBe("status='Closed' AND closingdate IS NOT NULL");
      expect(new URL(source.calls[1]!.url).searchParams.get('$order')).toBe('closingdate DESC, number DESC');
      expect(new URL(source.calls[1]!.url).searchParams.get('$limit')).toBe('200');
      expect(found).toHaveLength(20);
    }
  });

  it('does not ask at all when only grants are wanted', async () => {
    const source = replay([active]);
    expect(await montgomeryMdAdapter.search(filters({ kinds: ['grant'] }), context(source.http))).toEqual([]);
    expect(source.calls).toHaveLength(0);
  });

  it('reads a complete Active row', async () => {
    const found = await find(replay([active]).http);
    expect(byId(found, '1197772')).toEqual({
      id: 'montgomery-md:1197772',
      sourceId: 'montgomery-md',
      sourceName: 'Montgomery County Solicitations',
      funder: 'Department of General Services',
      kind: 'contract_solicitation',
      level: 'county',
      country: 'US',
      region: 'MD',
      jurisdiction: 'Montgomery County',
      geographyNote: '',
      title: 'Construction Services for North Bethesda Fire Station #43',
      summary: 'Request for Proposals (RFP). Issued by Department of General Services.',
      number: '1197772',
      applicantTypes: [],
      applicantNote: '',
      categories: [],
      awardFloor: null,
      awardCeiling: null,
      totalFunding: null,
      currency: 'USD',
      openDate: '2026-09-30',
      closeDate: '2026-11-06',
      closeDateText: 'November 6, 2026',
      status: 'active',
      statusReason: expect.stringMatching(/Closes November 6, 2026\.$/) as string,
      unverifiedReason: null,
      sourceStatus: 'Active',
      // The county has no page for one solicitation; this is its list of current ones.
      officialUrl: FORMAL_PAGE,
      fetchedAt: NOW,
      match: null,
    });
  });

  it('states who may respond only where the county does: its small business reserve', async () => {
    const found = await find(replay([active]).http);
    const reserved = byId(found, '1182845');
    expect(reserved.applicantTypes).toEqual(['small_business']);
    expect(reserved.applicantNote).toBe("Reserved under the county's Local Small Business Reserve Program.");
    expect(reserved.summary).toBe(
      "Request for Proposals (RFP). Issued by Department of Transportation. Reserved under the county's Local Small Business Reserve Program.",
    );
    expect(byId(found, '1192172')).toMatchObject({
      summary: 'Invitation for Bid (IFB). Issued by Department of General Services.',
      applicantTypes: [],
      applicantNote: '',
    });
    expect(found.filter((listing) => listing.applicantTypes.length > 0).map((listing) => listing.number)).toEqual([
      '1182845',
      '1199751',
    ]);
  });

  it('does not take the Active status at its word', async () => {
    const found = await find(replay([active]).http);
    expect(found.filter((listing) => listing.status === 'active')).toHaveLength(9);

    // Seven Active rows are also marked cancelled or postponed and have no closing date.
    const contradicted = found.filter((listing) => listing.unverifiedReason === 'source_contradiction');
    expect(contradicted.map((listing) => listing.number).sort()).toEqual([
      '1131334',
      '1131335',
      '1191538',
      '1191539',
      '1191540',
      '1191541',
      '1191542',
    ]);
    expect(byId(found, '1131334')).toMatchObject({
      status: 'unverified',
      sourceStatus: 'Active; Cancelled or Indefinitely Postponed',
      closeDate: null,
      closeDateText: '',
      openDate: '2022-01-05',
    });
    expect(byId(found, '1131334').statusReason).toBe(
      'The source lists this as open, but its own text says: "Cancelled or Indefinitely Postponed"',
    );
  });

  it('expires an Active row once its closing date has passed', async () => {
    // The same answer read four days later: the county keeps a solicitation
    // Active while it evaluates the responses.
    const later = Date.UTC(2026, 9, 10, 12, 0, 0);
    const found = await find(replay([active]).http, later);
    expect(byId(found, '1192172')).toMatchObject({
      status: 'expired',
      statusReason: 'The deadline passed on October 7, 2026.',
      sourceStatus: 'Active',
    });
    // Closing day itself still counts as open.
    expect(byId(await find(replay([active]).http, Date.UTC(2026, 9, 7, 16, 0, 0)), '1192172').status).toBe('active');
  });

  it('reads Closed rows as expired, with no link to a list they are no longer on', async () => {
    const found = await montgomeryMdAdapter.search(filters({ statuses: ['expired'] }), context(replay([active, closed]).http));
    // Closing today, and already Closed at the source.
    expect(byId(found, '1201132')).toMatchObject({
      status: 'expired',
      statusReason: 'The source lists this as closed.',
      unverifiedReason: null,
      sourceStatus: 'Closed',
      closeDate: '2026-10-06',
      officialUrl: '',
      funder: 'Department of Health & Human Svcs',
      summary:
        "Informal solicitation. Issued by Department of Health & Human Svcs. Reserved under the county's Local Small Business Reserve Program.",
      applicantTypes: ['small_business'],
    });
    expect(byId(found, '1183590').summary).toBe(
      'Request for Proposals (RFP) for construction. Issued by Department of Environmental Protection.',
    );
    expect(found.filter((listing) => listing.sourceStatus === 'Closed').every((listing) => listing.status === 'expired')).toBe(
      true,
    );
  });

  it('never calls a row active without a closing date or a status it knows', async () => {
    // Changed: an Active row with its closing date removed.
    const undated = await find(replay([activeWith('1197772', (row) => delete row.closingdate)]).http);
    expect(byId(undated, '1197772')).toMatchObject({ status: 'unverified', unverifiedReason: 'no_deadline' });

    // Changed: a status the county does not document.
    const pending = await find(replay([activeWith('1197772', (row) => (row.status = 'Pending'))]).http);
    expect(byId(pending, '1197772')).toMatchObject({
      status: 'unverified',
      unverifiedReason: 'no_official_link',
      sourceStatus: 'Pending',
      officialUrl: '',
    });
  });

  it('links an informal solicitation to the list of informal ones, and names the county when no department is given', async () => {
    // Changed: an Active row retyped as informal, with its department removed.
    const found = await find(
      replay([
        activeWith('1197772', (row) => {
          row.type = 'Informal';
          delete row.department;
        }),
      ]).http,
    );
    expect(byId(found, '1197772')).toMatchObject({
      officialUrl: INFORMAL_PAGE,
      funder: 'Montgomery County',
      summary: 'Informal solicitation.',
      status: 'active',
    });
  });

  it.each([
    ['an error object', { message: 'Invalid SoQL query', error: true }],
    ['a row with no number', [{ ...active.response[0], number: undefined }]],
    ['a row with no title', [{ ...active.response[0], description: '' }]],
    ['a closing date that is not a timestamp', [{ ...active.response[0], closingdate: '10/07/2026' }]],
    ['a number that could not be one', [{ ...active.response[0], number: "1192172' OR '1'='1" }]],
  ])('refuses %s instead of returning partial rows', async (_label, response) => {
    const failure = find(replay([{ request: active.request, response }]).http);
    await expect(failure).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
    await expect(failure).rejects.toThrow(/^Montgomery County Solicitations could not be read: /);
  });

  it('fails as a whole when the Closed rows cannot be read', async () => {
    const failure = montgomeryMdAdapter.search(filters({ statuses: [] }), context(replay([active]).http));
    await expect(failure).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
  });
});

describe('Montgomery County listing', () => {
  it('re-reads one solicitation by its number', async () => {
    const recorded = recording('detail-1197772');
    const source = replay([recorded]);
    const detail = await montgomeryMdAdapter.detail('1197772', context(source.http));

    expect(source.calls.map((call) => call.url)).toEqual([recorded.request.url]);
    expect(where(source.calls[0]!)).toBe("number='1197772'");
    expect(detail.opportunity).toMatchObject({ id: 'montgomery-md:1197772', status: 'active', closeDate: '2026-11-06' });
    expect(detail.description).toBe('');
    expect(detail.facts).toEqual([
      { label: 'Solicitation type', value: 'Request for Proposals (RFP)' },
      { label: 'Issuing department', value: 'Department of General Services' },
      { label: 'Status at the source', value: 'Active' },
      { label: 'Issued', value: 'September 30, 2026' },
      { label: 'Local Small Business Reserve Program', value: 'Not reserved' },
    ]);
    expect(detail.links).toEqual([
      { label: "The county's list of current solicitations", url: FORMAL_PAGE },
      {
        label: 'Montgomery County Office of Procurement',
        url: 'https://www.montgomerycountymd.gov/office-procurement/solicitations-contracts',
      },
    ]);
  });

  it('gives a closed solicitation its bid results and the contact the county names', async () => {
    const recorded = recording('detail-1201355');
    const detail = await montgomeryMdAdapter.detail('1201355', context(replay([recorded]).http));
    expect(detail.opportunity).toMatchObject({ status: 'expired', sourceStatus: 'Closed', officialUrl: '' });
    expect(detail.facts).toContainEqual({ label: 'Department contact', value: 'DEP Procurement Team' });
    expect(detail.links).toEqual([
      {
        label: 'Bid results',
        url: 'https://apps.montgomerycountymd.gov/prosolicitation/BidTabDetail.aspx?type=bidtab&solnumber=1201355',
      },
      {
        label: 'Montgomery County Office of Procurement',
        url: 'https://www.montgomerycountymd.gov/office-procurement/solicitations-contracts',
      },
    ]);

    // Changed: the procurement specialist as the county writes it when it names
    // no one, and a results link that leaves the county's sites.
    const altered = {
      request: recorded.request,
      response: [{ ...recorded.response[0], buyer: '--', bidtab: { url: 'https://example.com/bidtab?solnumber=1201355' } }],
    };
    const plain = await montgomeryMdAdapter.detail('1201355', context(replay([altered]).http));
    expect(plain.facts.map((fact) => fact.label)).not.toContain('Procurement specialist');
    expect(plain.links.map((link) => link.label)).toEqual(['Montgomery County Office of Procurement']);
  });

  it('says so when the county has no solicitation with that number', async () => {
    const recorded = recording('detail-unknown');
    expect(recorded.response).toEqual([]);
    const failure = montgomeryMdAdapter.detail('0000000', context(replay([recorded]).http));
    await expect(failure).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(failure).rejects.toThrow(/has no solicitation with that number/);
  });

  it('refuses a reference that could not be a solicitation number without asking the source', async () => {
    const source = replay([recording('detail-1197772')]);
    for (const id of ['', "1197772' OR '1'='1", '../1197772', '1197772\n', 'x'.repeat(41), '$where=1']) {
      await expect(montgomeryMdAdapter.detail(id, context(source.http))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
    expect(source.calls).toHaveLength(0);
  });
});
