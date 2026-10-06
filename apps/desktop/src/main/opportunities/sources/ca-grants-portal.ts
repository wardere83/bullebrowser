// The California Grants Portal: the grants and loans that California's state
// agencies offer, which the State Library publishes in one place. The app
// reads the copy on the state's open-data portal, the "Grants Offered"
// dataset. Everything below was established by calling it on 6 October 2026.
//
//   - Status is active, forecasted or closed, and the table is rebuilt once a
//     day, so it lags: that day one listing was still "active" a day after its
//     deadline. The status rule catches that.
//   - Three quarters of the active listings give the word "Ongoing" as their
//     deadline. That is the source saying there is no closing date.
//   - Every value is text. Deadlines are written without a time zone; the
//     portal itself works in Pacific time.
//   - Amounts are phrases. "Between $1.00 and $750,000.00" means up to
//     $750,000: the dollar is a placeholder. A single figure is the funder's
//     estimate for each award. It is read as the most an award may be and
//     never as the least, so a search by amount cannot hide the listing.
//   - Loans are listed beside grants. The app has no separate kind for them,
//     so a loan's summary begins by saying what it is.
//   - The answer repeats the dataset and filters it used. Both are compared
//     with what was sent before a row is read.

import { isDeepStrictEqual } from 'node:util';
import {
  APPLICANT_TYPE_LABELS,
  FUNDING_CATEGORY_LABELS,
  type ApplicantType,
  type FundingCategory,
  type Opportunity,
  type OpportunityDetail,
} from '../../../shared/funding.js';
import { FundingError } from '../../funding/errors.js';
import { clampText, parseAmount, parseDate, stripHtml } from '../normalize.js';
import { evaluateStatus, formatDate, normalizeIsoDate, type StatusInput } from '../status.js';
import { opportunityId, type SourceAdapter, type SourceContext } from '../types.js';

const SOURCE_ID = 'ca-grants-portal';
const SOURCE_NAME = 'California Grants Portal';
const ENDPOINT = 'https://data.ca.gov/api/3/action/datastore_search';
const RESOURCE_ID = '111c8c88-21f6-453c-ae2c-b4785a0624f5';
const TIME_ZONE = 'America/Los_Angeles';

const PAGE_ROWS = 1000;
/** Room for 3,000 open and forecast listings; there were 169 when this was written. */
const MAX_PAGES = 3;
/** Closed listings go back to 1989 (1,848 of them), so only the latest to close are read. */
const CLOSED_ROWS = 300;

const TITLE_LENGTH = 300;
const SUMMARY_LENGTH = 600;
const DESCRIPTION_LENGTH = 20_000;
const NOTE_LENGTH = 600;
const FACT_LENGTH = 600;
/** The most of any one field that is read, so an absurd answer cannot stall the app. */
const MAX_FIELD_LENGTH = 80_000;

const EVERY_APPLICANT = Object.keys(APPLICANT_TYPE_LABELS) as ApplicantType[];
const EVERY_CATEGORY = Object.keys(FUNDING_CATEGORY_LABELS) as FundingCategory[];

/**
 * The portal's six applicant types as the app's. It does not tell businesses
 * apart by size, and its public agencies include schools, colleges and state
 * bodies as well as local government.
 */
export const APPLICANT_TYPES: Readonly<Record<string, readonly ApplicantType[]>> = {
  Business: ['small_business', 'for_profit'],
  Individual: ['individual'],
  Nonprofit: ['nonprofit'],
  'Other Legal Entity': ['other'],
  'Public Agency': ['local_government', 'state_government', 'education'],
  'Tribal Government': ['tribal'],
};

/**
 * The portal's eighteen categories as the app's. One with no counterpart is
 * filed under "other" rather than forced into a near miss; the portal's own
 * wording is always shown in the listing's facts.
 */
export const CATEGORIES: Readonly<Record<string, readonly FundingCategory[]>> = {
  Agriculture: ['agriculture_food'],
  'Animal Services': ['other'],
  'Consumer Protection': ['other'],
  'Disadvantaged Communities': ['community_development'],
  'Disaster Prevention & Relief': ['disaster_emergency'],
  Education: ['education'],
  'Employment, Labor & Training': ['employment_workforce'],
  Energy: ['energy'],
  'Environment & Water': ['environment_natural_resources'],
  'Food & Nutrition': ['agriculture_food'],
  'Health & Human Services': ['health', 'human_services'],
  'Housing, Community and Economic Development': [
    'housing',
    'community_development',
    'business_economic_development',
  ],
  'Law, Justice, and Legal Services': ['justice_public_safety'],
  'Libraries and Arts': ['arts_culture_humanities'],
  'Parks & Recreation': ['environment_natural_resources'],
  'Science, Technology, and Research & Development': ['science_technology_research'],
  Transportation: ['transportation_infrastructure'],
  'Veterans & Military': ['other'],
};

const COLUMNS = [
  'PortalID',
  'GrantID',
  'Status',
  'LastUpdated',
  'AgencyDept',
  'Title',
  'Type',
  'LOI',
  'Categories',
  'Purpose',
  'Description',
  'ApplicantType',
  'ApplicantTypeNotes',
  'Geography',
  'FundingSource',
  'FundingSourceNotes',
  'MatchingFunds',
  'MatchingFundsNotes',
  'EstAvailFunds',
  'EstAwards',
  'EstAmounts',
  'FundingMethod',
  'FundingMethodNotes',
  'OpenDate',
  'ApplicationDeadline',
  'AwardPeriod',
  'ExpAwardDate',
  'ElecSubmission',
  'GrantURL',
  'AgencyURL',
  'AgencySubscribeURL',
  'GrantEventsURL',
  'ContactInfo',
] as const;

/** One listing as the source gives it: every column as text, empty where it has none. */
type Row = Record<(typeof COLUMNS)[number], string>;
type Json = Record<string, unknown>;
type SourceState = StatusInput['sourceState'];

const STATES = new Map<string, SourceState>([
  ['active', 'open'],
  ['forecasted', 'forecast'],
  ['closed', 'closed'],
]);

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const plain = (value: string, max: number): string => clampText(stripHtml(value), max);

const unavailable = (detail: string) =>
  new FundingError('SOURCE_UNAVAILABLE', `${SOURCE_NAME} could not be read: ${detail}`);
const UNEXPECTED_FORM = 'its answer was not in the expected form.';

const officialUrl = (id: string) => `https://www.grants.ca.gov/?p=${id}`;

interface PageRequest {
  filters: Record<string, string[]>;
  limit: number;
  offset: number;
  /** '' leaves the rows in the source's own order. */
  sort: string;
}

function requestUrl(request: PageRequest): string {
  const params = new URLSearchParams();
  params.set('resource_id', RESOURCE_ID);
  params.set('filters', JSON.stringify(request.filters));
  params.set('limit', String(request.limit));
  if (request.offset > 0) params.set('offset', String(request.offset));
  if (request.sort) params.set('sort', request.sort);
  return `${ENDPOINT}?${params.toString()}`;
}

function readRow(record: unknown): Row {
  if (!isRecord(record)) throw unavailable(UNEXPECTED_FORM);
  const row = {} as Row;
  for (const column of COLUMNS) {
    const value = record[column];
    // The source writes an empty field as null. A missing one is a renamed column.
    if (value !== null && typeof value !== 'string') throw unavailable(UNEXPECTED_FORM);
    row[column] = typeof value === 'string' ? value.slice(0, MAX_FIELD_LENGTH).trim() : '';
  }
  if (!/^[1-9]\d{0,11}$/.test(row.PortalID) || !stripHtml(row.Title)) throw unavailable(UNEXPECTED_FORM);
  return row;
}

async function readPage(request: PageRequest, context: SourceContext): Promise<{ rows: Row[]; total: number }> {
  const reply = await context.http.json<unknown>({
    url: requestUrl(request),
    signal: context.signal,
    source: SOURCE_NAME,
  });
  if (!isRecord(reply)) throw unavailable(UNEXPECTED_FORM);
  if (reply.success !== true) throw unavailable('it reported a problem with the search.');
  const result = reply.result;
  if (!isRecord(result)) throw unavailable(UNEXPECTED_FORM);

  const sameSearch =
    result.resource_id === RESOURCE_ID &&
    isDeepStrictEqual(result.filters, request.filters) &&
    result.limit === request.limit &&
    (result.offset ?? 0) === request.offset &&
    (result.sort ?? '') === request.sort;
  if (!sameSearch) throw unavailable('it ran a different search from the one that was sent.');

  const named = new Set(
    (Array.isArray(result.fields) ? result.fields : []).map((field) => (isRecord(field) ? field.id : null)),
  );
  if (!COLUMNS.every((column) => named.has(column))) {
    throw unavailable('its listings no longer have the fields the app reads.');
  }

  const { total, records } = result;
  if (typeof total !== 'number' || !Number.isInteger(total) || total < 0 || !Array.isArray(records)) {
    throw unavailable(UNEXPECTED_FORM);
  }
  if (records.length !== Math.min(request.limit, Math.max(0, total - request.offset))) {
    throw unavailable('it returned a different number of listings than it reported.');
  }
  return { rows: records.map(readRow), total };
}

/** Every row for a set of statuses. More than can be read is an error, never a short list. */
async function readEvery(statuses: string[], context: SourceContext): Promise<Row[]> {
  const rows: Row[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { rows: read, total } = await readPage(
      { filters: { Status: statuses }, limit: PAGE_ROWS, offset: page * PAGE_ROWS, sort: '' },
      context,
    );
    rows.push(...read);
    if (rows.length >= total) return rows;
  }
  throw unavailable('it has more listings than can be read at once.');
}

interface Deadline {
  /** ISO date, or null when the source gives none that can be read. */
  date: string | null;
  /** What the status rule is told: the date, or the unreadable wording itself. */
  forStatus: string | null;
  ongoing: boolean;
  text: string;
}

const TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):\d{2}$/;

/** "November 2, 2026 at 5:00 PM" for a timestamp; any other wording as the source has it. */
function dateWording(written: string): string {
  const match = TIMESTAMP_RE.exec(written);
  const date = match ? normalizeIsoDate(match[1]) : null;
  if (!match || !date) return plain(written, 120);
  const hours = Number(match[2]);
  const minutes = match[3]!;
  if (hours === 0 && minutes === '00') return formatDate(date);
  return `${formatDate(date)} at ${hours % 12 === 0 ? 12 : hours % 12}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`;
}

function readDeadline(written: string): Deadline {
  if (!written) return { date: null, forStatus: null, ongoing: false, text: '' };
  if (/^ongoing$/i.test(written)) return { date: null, forStatus: null, ongoing: true, text: written };
  const date = parseDate(written);
  // Wording that is not a date is passed on as written, so that it is reported
  // as unreadable rather than as missing.
  return { date, forStatus: date ?? written, ongoing: false, text: dateWording(written) };
}

/** The award range in the source's "Between … and …" phrase, or its single figure as the ceiling. */
function readAwardRange(written: string): { floor: number | null; ceiling: number | null } {
  const between = /^between\s+(\S+)\s+and\s+(\S+)$/i.exec(written);
  if (between) return { floor: parseAmount(between[1]), ceiling: parseAmount(between[2]) };
  return { floor: null, ceiling: parseAmount(written) };
}

const listed = (value: string): string[] =>
  value
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);

/** The app's values for the source's labels, in the app's own order. An unknown label is "other". */
function valuesFor<T extends string>(
  table: Readonly<Record<string, readonly T[]>>,
  labels: string[],
  order: readonly T[],
): T[] {
  const found = new Set(
    labels.flatMap<string>((label) => (Object.hasOwn(table, label) ? table[label]! : ['other'])),
  );
  return order.filter((value) => found.has(value));
}

/** What a listing is when it is not simply a grant, as the start of its summary. */
function kindNote(type: string): string {
  const kinds = listed(type).map((kind) => kind.toLowerCase());
  if (kinds.length === 0 || (kinds.length === 1 && kinds[0] === 'grant')) return '';
  if (kinds.length === 1 && kinds[0] === 'loan') return 'Loan.';
  if (kinds.length === 2 && kinds.includes('grant') && kinds.includes('loan')) return 'Grant and loan.';
  return `${plain(type, 60)}.`;
}

function toOpportunity(row: Row, now: number): Opportunity {
  const deadline = readDeadline(row.ApplicationDeadline);
  const award = readAwardRange(row.EstAmounts);
  const sourceStatus = row.Status.toLowerCase();
  const status = evaluateStatus({
    sourceState: STATES.get(sourceStatus) ?? 'unknown',
    closeDate: deadline.forStatus,
    ongoing: deadline.ongoing,
    hasOfficialUrl: true,
    contradiction: '',
    detailChecked: null,
    fetchedAt: now,
    now,
    timeZone: TIME_ZONE,
  });

  return {
    id: opportunityId(SOURCE_ID, row.PortalID),
    sourceId: SOURCE_ID,
    sourceName: SOURCE_NAME,
    funder: plain(row.AgencyDept, 200),
    kind: 'grant',
    level: 'state',
    country: 'US',
    region: 'CA',
    jurisdiction: 'California',
    geographyNote: plain(row.Geography, 300),
    title: plain(row.Title, TITLE_LENGTH),
    summary: clampText(
      [kindNote(row.Type), stripHtml(row.Purpose || row.Description)].filter(Boolean).join(' '),
      SUMMARY_LENGTH,
    ),
    number: plain(row.GrantID, 120),
    applicantTypes: valuesFor(APPLICANT_TYPES, listed(row.ApplicantType), EVERY_APPLICANT),
    applicantNote: plain(row.ApplicantTypeNotes, NOTE_LENGTH),
    categories: valuesFor(CATEGORIES, listed(row.Categories), EVERY_CATEGORY),
    awardFloor: award.floor,
    awardCeiling: award.ceiling,
    totalFunding: parseAmount(row.EstAvailFunds),
    currency: 'USD',
    openDate: parseDate(row.OpenDate),
    closeDate: deadline.date,
    closeDateText: deadline.text,
    ...status,
    sourceStatus,
    officialUrl: officialUrl(row.PortalID),
    fetchedAt: now,
    match: null,
  };
}

/** Plain text that keeps the paragraphs the source marks with a run of spaces. */
function paragraphs(text: string): string[] {
  return text
    .split(/\s{2,}/)
    .map(stripHtml)
    .filter(Boolean);
}

/** A link the source attaches, only when it is an ordinary web address. */
function webAddress(value: string): string | null {
  const written = value.trim();
  if (!written || written.length > 2000) return null;
  try {
    const url = new URL(written);
    const web = url.protocol === 'https:' || url.protocol === 'http:';
    return web && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

/** The source's "name: …; email: …; tel: …;" notation as its parts. */
function labelled(value: string): Map<string, string> {
  const parts = new Map<string, string>();
  for (const item of listed(value)) {
    const at = item.indexOf(':');
    if (at > 0) parts.set(item.slice(0, at).trim().toLowerCase(), item.slice(at + 1).trim());
  }
  return parts;
}

function detailOf(row: Row, opportunity: Opportunity): OpportunityDetail {
  const facts: OpportunityDetail['facts'] = [];
  // A value and the funder's note on it are shown together: "12%. Matching funds must be…".
  const fact = (label: string, ...values: string[]) => {
    const stated = values.map((item) => stripHtml(item)).filter(Boolean);
    const value = stated.map((item, at) => (at < stated.length - 1 ? item.replace(/\.$/, '') : item)).join('. ');
    if (value) facts.push({ label, value: clampText(value, FACT_LENGTH) });
  };

  fact('Type of funding', listed(row.Type).join(' and '));
  fact('Estimated total funding', row.EstAvailFunds);
  fact('Estimated amount per award', row.EstAmounts);
  fact('Estimated number of awards', row.EstAwards);
  fact('Matching funds', row.MatchingFunds, row.MatchingFundsNotes);
  fact('Funding source', row.FundingSource, row.FundingSourceNotes);
  fact('How funds are paid', row.FundingMethod, row.FundingMethodNotes);
  fact('Letter of intent required', row.LOI);
  // A forecast gives its opening date in words, which the listing's own date field cannot hold.
  if (!opportunity.openDate) fact('Expected to open', row.OpenDate);
  fact('Award period', row.AwardPeriod);
  fact('Expected award date', row.ExpAwardDate);
  fact('Eligible applicants at the source', listed(row.ApplicantType).join('; '));
  fact('Categories at the source', listed(row.Categories).join('; '));
  fact('Last updated at the source', row.LastUpdated);

  const contact = labelled(row.ContactInfo);
  const email = contact.get('email') ?? '';
  // Some agencies put their mailbox in the name field as well.
  const name = contact.get('name') ?? '';
  fact('Contact', name === email ? '' : name);
  if (/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) fact('Contact email', email);
  const phone = contact.get('tel') ?? '';
  if (phone.replace(/\D/g, '').length >= 7) fact('Contact phone', phone);
  const submission = labelled(row.ElecSubmission);
  fact('Applications by email to', submission.get('email') ?? '');

  const links: OpportunityDetail['links'] = [
    { label: 'Listing on the California Grants Portal', url: opportunity.officialUrl },
  ];
  const link = (label: string, value: string) => {
    const url = webAddress(value);
    if (url && !links.some((held) => held.url === url)) links.push({ label, url });
  };
  link("Funding agency's page for this listing", row.GrantURL);
  link('Online application', submission.get('url') ?? '');
  link('Funding agency', row.AgencyURL);
  link('Events for applicants', row.GrantEventsURL);
  link('Updates from the funding agency', row.AgencySubscribeURL);

  return {
    opportunity,
    description: clampText(
      [...paragraphs(row.Purpose), ...paragraphs(row.Description)].join('\n\n'),
      DESCRIPTION_LENGTH,
    ),
    facts,
    links,
  };
}

export const caGrantsPortalAdapter: SourceAdapter = {
  info: {
    id: SOURCE_ID,
    name: SOURCE_NAME,
    operator: 'California State Library',
    level: 'state',
    jurisdiction: 'California',
    coverage: { country: 'US', region: 'CA', county: '', city: '' },
    kinds: ['grant'],
    homepageUrl: 'https://www.grants.ca.gov/',
    attribution:
      'California State Library, California Grants Portal, from the State of California open-data portal. Public domain.',
    note:
      'The California Grants Portal applies the status filter itself; every other filter is applied on this device. ' +
      'Loans are listed beside grants, and a loan says so at the start of its summary. ' +
      'Closed listings are limited to the 300 with the latest deadlines. ' +
      "Where a grant may be used is given in the funder's own words, not as a list of counties.",
  },

  async search(filters, context) {
    if (filters.kinds.length > 0 && !filters.kinds.includes('grant')) return [];
    const { statuses } = filters;

    // An active listing can turn out active, unverified or expired, so active
    // listings are always read; forecasts only when unverified ones are wanted.
    const forecastsWanted = statuses.length === 0 || statuses.includes('unverified');
    const open = await readEvery(forecastsWanted ? ['active', 'forecasted'] : ['active'], context);
    const closed =
      statuses.length === 0 || statuses.includes('expired')
        ? (
            await readPage(
              { filters: { Status: ['closed'] }, limit: CLOSED_ROWS, offset: 0, sort: 'ApplicationDeadline desc' },
              context,
            )
          ).rows
        : [];

    const rows = new Map<string, Row>();
    for (const row of [...open, ...closed]) {
      if (!rows.has(row.PortalID)) rows.set(row.PortalID, row);
    }
    return [...rows.values()].map((row) => toOpportunity(row, context.now));
  },

  async detail(recordId, context) {
    if (!/^[1-9]\d{0,11}$/.test(recordId)) {
      throw new FundingError('INVALID_INPUT', 'That listing reference is not valid.');
    }
    const { rows } = await readPage(
      { filters: { PortalID: [recordId] }, limit: 2, offset: 0, sort: '' },
      context,
    );
    const row = rows[0];
    if (!row) {
      throw new FundingError(
        'NOT_FOUND',
        `${SOURCE_NAME} has no listing with that reference. It may have been withdrawn.`,
      );
    }
    if (rows.length > 1 || row.PortalID !== recordId) {
      throw unavailable('it returned a different listing from the one asked for.');
    }
    return detailOf(row, toOpportunity(row, context.now));
  },
};
