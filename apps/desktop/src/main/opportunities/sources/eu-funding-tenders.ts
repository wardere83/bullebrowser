// The EU Funding & Tenders Portal: the European Commission's listing of grant
// topics across every EU programme, of cascade-funding calls run by EU-funded
// projects, and of EU external-action calls for proposals. It is read through
// the search service behind the portal's own pages. Everything below was
// established by calling it on 6 October 2026.
//
//   - The service takes a POST whose form parts are each typed as JSON; any
//     other shape is answered with an internal error.
//   - Its "open" flag is not reliable: that day 374 grant topics were flagged
//     open and only 136 had a deadline still to come. So only listings with a
//     deadline from today on are asked for as open, and the status rule is
//     given the deadline read here, never the flag alone.
//   - The portal's earlier system left copies of old topics in the index. One
//     of them claimed a 2027 deadline that the topic's current record does not
//     have, so only current records are asked for.
//   - A topic can have several cut-off dates. Its deadline is the next one
//     still to come, or the last one once all have passed.
//   - Every value is a list of text values. Dates carry a +0000 offset and
//     are read as written; some also carry a time of day, which is left to the
//     official page because the portal shows its times in Brussels time.
//   - A whole answer runs to 2 MB for a hundred listings, so only the fields
//     that are read are asked for.
//   - At most a hundred listings come back at a time, and rows that tie in the
//     sort order can swap between pages: one reading returned six listings
//     twice and so missed six others. Each type of record is therefore read
//     on its own, sorted by the number that is unique to it.
//   - For a cascade call, the id and link the service gives belong to the EU
//     topic that pays for the project and are shared by every call under it.
//     The call's own number is its "callccm2Id", and its page is built from
//     that.
//   - The service matches any one whole word of a keyword, which is not the
//     app's rule, so the search entry is not sent and is applied on the device.

import type { Opportunity, OpportunityDetail } from '../../../shared/funding.js';
import { FundingError } from '../../funding/errors.js';
import { clampText, parseAmount, stripHtml } from '../normalize.js';
import { evaluateStatus, formatDate, normalizeIsoDate, todayIn, type StatusInput } from '../status.js';
import { opportunityId, type SourceAdapter, type SourceContext } from '../types.js';

const SOURCE_ID = 'eu-funding-tenders';
const SOURCE_NAME = 'EU Funding & Tenders Portal';
const SEARCH_URL = 'https://api.tech.ec.europa.eu/search-api/prod/rest/search';
const PORTAL = 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities';
/** The source writes every date with a +0000 offset. */
const TIME_ZONE = 'UTC';

const PAGE_SIZE = 100;
/**
 * Room for 1,000 listings of each type. When this was written the largest set,
 * topics announced but not yet open, had 290.
 */
const MAX_PAGES = 10;

const TITLE_LENGTH = 300;
const SUMMARY_LENGTH = 600;
const DESCRIPTION_LENGTH = 40_000;
const FACT_LENGTH = 600;
/** The most of any one field that is read, so an absurd answer cannot stall the app. */
const MAX_FIELD_LENGTH = 200_000;

type Kind = 'topic' | 'cascade' | 'external';
type SourceState = StatusInput['sourceState'];
type Json = Record<string, unknown>;

/** The source's record types that are grants, and the field that numbers each. */
const KINDS: Readonly<Record<string, { kind: Kind; key: 'identifier' | 'callccm2Id' | 'callIdentifier' }>> = {
  '1': { kind: 'topic', key: 'identifier' },
  '2': { kind: 'external', key: 'callIdentifier' },
  '8': { kind: 'cascade', key: 'callccm2Id' },
};
const TYPE_OF: Readonly<Record<Kind, string>> = { topic: '1', cascade: '8', external: '2' };

/** The portal's current system, as its records name it. Anything else is a leftover copy. */
const CURRENT_RECORDS = 'SEDIA';

const OPEN = '31094502';
const FORTHCOMING = '31094501';
const CLOSED = '31094503';
/** The source's status codes, with its own labels for them. */
const STATUSES: Readonly<Record<string, { state: SourceState; label: string }>> = {
  [FORTHCOMING]: { state: 'forecast', label: 'Forthcoming' },
  [OPEN]: { state: 'open', label: 'Open for submission' },
  [CLOSED]: { state: 'closed', label: 'Closed' },
};

/**
 * The source's programme codes with its own names for them, as its code table
 * gave them on 6 October 2026. That table drops the plus sign from "Erasmus+"
 * and "ESF+"; it is restored here.
 */
export const PROGRAMMES: Readonly<Record<string, string>> = {
  '111111': 'EU External Action - Prospect (RELEX-PROSPECT)',
  '31045243': 'Horizon 2020 Framework Programme (H2020 - 2014-2020)',
  '31059083': 'Creative Europe (CREA - 2014-2020)',
  '31059088': 'Europe For Citizens (EFC - 2014-2020)',
  '31059093': 'Erasmus+ Programme (EPLUS - 2014-2020)',
  '31059098': 'EU Aid Volunteers programme (EUAID - 2014-2020)',
  '31059643':
    'Programme for the Competitiveness of Enterprises and small and medium-sized enterprises (COSME - 2014-2020)',
  '31061225': 'Research Fund for Coal & Steel (RFCS - 2014-2020)',
  '31061266': '3rd Health Programme (3HP - 2014-2020)',
  '31061273': 'Consumer Programme (CP - 2014-2020)',
  '31070247': 'Justice Programme (JUST - 2014-2020)',
  '31072773': 'Promotion of Agricultural Products (AGRIP - 2014-2020)',
  '31075571': 'Intra-Africa Academic Mobility Scheme (PANAF - 2014-2020)',
  '31076817': 'Rights, Equality and Citizenship Programme (REC - 2014-2020)',
  '31077795': 'Asylum, Migration and Integration Fund (AMIF - 2014-2020)',
  '31077817': 'Internal Security Fund Police (ISFP - 2014-2020)',
  '31077833': 'Internal Security Fund Borders and Visa (ISFB - 2014-2020)',
  '31082527': 'Union Civil Protection Mechanism (UCPM - 2014-2020)',
  '31084250': 'Pilot Projects and Preparatory Actions (PPPA - 2014-2020)',
  '31084392': 'Hercule III (HERC - 2014-2020)',
  '31088049': 'European Statistics (ESTAT - 2014-2020)',
  '31098847': 'European Maritime and Fisheries Fund (EMFF - 2014-2020)',
  '31107710': 'Programme for the Environment and Climate Action (LIFE - 2014-2020)',
  '31109727': 'European Defence Industrial Development Programme (EDIDP - 2014-2020)',
  '42198993':
    'Support for information measures relating to the common agricultural policy (IMCAP - 2014-2020)',
  '42810547': 'EUROPE DIRECT (ED - 2014-2020)',
  '42992790': 'European Solidarity Corps (ESC - 2014-2020)',
  '43089234': 'Innovation Fund (INNOVFUND)',
  '43108390': 'Horizon Europe (HORIZON)',
  '43152860': 'Digital Europe Programme (DIGITAL)',
  '43251447': 'Asylum, Migration and Integration Fund (AMIF)',
  '43251530': 'Border Management and Visa Instrument (BMVI)',
  '43251567': 'Connecting Europe Facility (CEF)',
  '43251589': 'Citizens, Equality, Rights and Values programme (CERV)',
  '43251814': 'Creative Europe Programme (CREA)',
  '43251842': 'Union Anti-Fraud Programme (EUAF)',
  '43251882': 'Support for information measures relating to the common agricultural policy (IMCAP)',
  '43252368': 'Internal Security Fund (ISF)',
  '43252386': 'Justice Programme (JUST)',
  '43252405': 'Programme for the Environment and Climate Action (LIFE)',
  '43252433': 'Programme for the Protection of the Euro against Counterfeiting (PERICLES IV)',
  '43252449': 'Research Fund for Coal & Steel (RFCS)',
  '43252476': 'Single Market Programme (SMP)',
  '43252517': 'Social Prerogative and Specific Competencies Lines (SOCPL)',
  '43253967': 'Renewable Energy Financing Mechanism (RENEWFM)',
  '43254019': 'European Social Fund+ (ESF+)',
  '43254037': 'European Solidarity Corps (ESC)',
  '43298203': 'Union Civil Protection Mechanism (UCPM)',
  '43298664': 'Promotion of Agricultural Products (AGRIP)',
  '43298916': 'Euratom Research and Training Programme (EURATOM)',
  '43332642': 'EU4Health Programme (EU4H)',
  '43353764': 'Erasmus+ (ERASMUS+)',
  '43392145': 'European Maritime, Fisheries and Aquaculture Fund (EMFAF)',
  '43637601': 'Pilot Projects & Preparation Actions (PPPA)',
  '43697167': 'European Parliament (EP)',
  '44181033': 'European Defence Fund (EDF)',
  '44416173': 'Interregional Innovation Investments Instrument (I3)',
  '44773066': 'Just Transition Mechanism (JTM)',
  '44773133': 'Information Measures for the EU Cohesion policy (IMREG)',
  '45532249': 'EU Bodies and Agencies (EUBA)',
  '45876777':
    'Neighbourhood, Development and International Cooperation Instrument – Global Europe (NDICI)',
  '46324255': 'Technical assistance for ERDF, CF and JTF (ERDF-TA)',
  '47376280': 'EU External Action - eGrants (RELEX2027)',
  '47786028': 'Business and Consumer Surveys Programme (BCS)',
};

const SEARCH_FIELDS = [
  'identifier',
  'title',
  'type',
  'status',
  'startDate',
  'deadlineDate',
  'deadlineModel',
  'frameworkProgramme',
  'callIdentifier',
  'callTitle',
  'callccm2Id',
  'url',
  'descriptionByte',
  'description',
  'budgetOverview',
  'budget',
  'currency',
  'typesOfAction',
  'projectAcronym',
  'projectName',
  'DATASOURCE',
] as const;

const DETAIL_FIELDS = [
  ...SEARCH_FIELDS,
  'topicConditions',
  'furtherInformation',
  'beneficiaryAdministration',
  'duration',
  'links',
  'publicationDocuments',
] as const;

type Field = (typeof DETAIL_FIELDS)[number];

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const plain = (value: string, max: number): string => clampText(stripHtml(value), max);

const unavailable = (detail: string) =>
  new FundingError('SOURCE_UNAVAILABLE', `${SOURCE_NAME} could not be read: ${detail}`);
const UNEXPECTED_FORM = 'its answer was not in the expected form.';

interface Search {
  must: Json[];
  sort: { field: string; order: 'ASC' | 'DESC' };
  fields: readonly Field[];
  pageNumber: number;
  pageSize: number;
}

/** One record's metadata: every field a list of text values. */
type Hit = (field: Field) => string[];

async function readPage(search: Search, context: SourceContext): Promise<{ hits: Hit[]; total: number }> {
  const params = new URLSearchParams({
    apiKey: 'SEDIA',
    // Three asterisks are the source's own way of asking for everything.
    text: '***',
    pageSize: String(search.pageSize),
    pageNumber: String(search.pageNumber),
  });
  const form = new FormData();
  const part = (name: string, value: unknown) =>
    form.append(name, new Blob([JSON.stringify(value)], { type: 'application/json' }));
  part('query', { bool: { must: search.must } });
  part('languages', ['en']);
  part('sort', search.sort);
  part('displayFields', search.fields);

  const reply = await context.http.json<unknown>({
    url: `${SEARCH_URL}?${params.toString()}`,
    method: 'POST',
    body: form,
    signal: context.signal,
    source: SOURCE_NAME,
  });
  if (!isRecord(reply)) throw unavailable(UNEXPECTED_FORM);
  const { totalResults: total, results } = reply;
  if (!Array.isArray(results)) {
    throw unavailable(typeof reply.message === 'string' ? 'it reported a problem with the search.' : UNEXPECTED_FORM);
  }
  if (typeof total !== 'number' || !Number.isInteger(total) || total < 0) throw unavailable(UNEXPECTED_FORM);
  if (reply.pageNumber !== search.pageNumber || reply.pageSize !== search.pageSize) {
    throw unavailable('it ran a different search from the one that was sent.');
  }
  const expected = Math.min(search.pageSize, Math.max(0, total - (search.pageNumber - 1) * search.pageSize));
  if (results.length !== expected) {
    throw unavailable('it returned a different number of listings than it reported.');
  }

  const hits = results.map((result): Hit => {
    const metadata = isRecord(result) ? result.metadata : null;
    if (!isRecord(metadata)) throw unavailable(UNEXPECTED_FORM);
    return (field) => {
      const values = metadata[field];
      if (values === undefined || values === null) return [];
      if (!Array.isArray(values) || !values.every((value) => typeof value === 'string')) {
        throw unavailable(UNEXPECTED_FORM);
      }
      return (values as string[]).map((value) => value.slice(0, MAX_FIELD_LENGTH));
    };
  });
  return { hits, total };
}

/** Up to `maxPages` pages of a search, one after another. */
async function readPages(
  search: Omit<Search, 'pageNumber' | 'pageSize'>,
  maxPages: number,
  context: SourceContext,
): Promise<{ hits: Hit[]; total: number }> {
  const hits: Hit[] = [];
  let total = 0;
  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const page = await readPage({ ...search, pageNumber, pageSize: PAGE_SIZE }, context);
    // A count that moves between pages means rows may have been skipped or repeated.
    if (pageNumber > 1 && page.total !== total) {
      throw unavailable('its listings changed while they were being read. Search again.');
    }
    total = page.total;
    hits.push(...page.hits);
    if (hits.length >= total) break;
  }
  return { hits, total };
}

interface Deadline {
  date: string;
  /** True when the source gives a time of day as well as a date. */
  timed: boolean;
}

const DATE_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):\d{2}(?:\.\d{1,6})?(?:\+00:?00|Z)$/;

function readDate(written: string): Deadline | null {
  const match = DATE_RE.exec(written.trim());
  const date = match ? normalizeIsoDate(match[1]) : null;
  return match && date ? { date, timed: match[2] !== '00' || match[3] !== '00' } : null;
}

/** A listing as read from the source, before the status rule is applied. */
interface Listing {
  recordId: string;
  kind: Kind;
  /** The EU topic: the listing itself, or the one a cascade call belongs to. */
  topic: string;
  title: string;
  funder: string;
  programme: string;
  number: string;
  summary: string;
  statusCode: string;
  openDate: string | null;
  deadlines: Deadline[];
  /** A deadline the source gives that could not be read as a date. */
  unreadDeadline: string;
  awardFloor: number | null;
  awardCeiling: number | null;
  totalFunding: number | null;
  currency: string;
  officialUrl: string;
}

/** A link the source gives, only when it is on an EU institution's own site. */
function europaUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    const official = url.protocol === 'https:' && /(?:^|\.)europa\.eu$/.test(url.hostname);
    return official && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

interface BudgetLine {
  action: string;
  expectedGrants: number | null;
  floor: number | null;
  ceiling: number | null;
  /** Budget by year, as the source lists it. */
  years: [string, number][];
}

/**
 * A topic's lines in the budget table of its call. The table lists every
 * action of the call, so only lines that name this topic are kept.
 */
function budgetLines(overview: string, identifier: string): BudgetLine[] {
  let table: unknown;
  try {
    table = JSON.parse(overview);
  } catch {
    return [];
  }
  const actions = isRecord(table) && isRecord(table.budgetTopicActionMap) ? table.budgetTopicActionMap : {};
  const lines: BudgetLine[] = [];
  for (const group of Object.values(actions)) {
    for (const line of Array.isArray(group) ? group : []) {
      if (!isRecord(line) || typeof line.action !== 'string') continue;
      if (!line.action.toLowerCase().startsWith(identifier.toLowerCase())) continue;
      const years = Object.entries(isRecord(line.budgetYearMap) ? line.budgetYearMap : {})
        .map(([year, amount]): [string, number | null] => [year, parseAmount(amount)])
        .filter((entry): entry is [string, number] => entry[1] !== null);
      lines.push({
        action: plain(line.action, 200),
        expectedGrants:
          typeof line.expectedGrants === 'number' && line.expectedGrants > 0 ? line.expectedGrants : null,
        floor: parseAmount(line.minContribution),
        ceiling: parseAmount(line.maxContribution),
        years,
      });
    }
  }
  return lines;
}

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);
const smallest = (values: (number | null)[]): number | null => {
  const stated = values.filter((value): value is number => value !== null);
  return stated.length > 0 ? Math.min(...stated) : null;
};
const largest = (values: (number | null)[]): number | null => {
  const stated = values.filter((value): value is number => value !== null);
  return stated.length > 0 ? Math.max(...stated) : null;
};

function readListing(hit: Hit): Listing {
  const first = (field: Field): string => hit(field)[0]?.trim() ?? '';
  const type = KINDS[first('type')];
  // Only current records of the three grant types are ever asked for.
  if (!type || first('DATASOURCE') !== CURRENT_RECORDS) {
    throw unavailable('it ran a different search from the one that was sent.');
  }
  const { kind } = type;
  const key = first(type.key);
  const topic = first('identifier');
  const ownTitle = kind === 'cascade' ? first('callTitle') || first('title') : first('title');
  const title = plain(ownTitle, TITLE_LENGTH);
  if (!key || key.length > 150 || /[\p{Cc}\p{Cf}]/u.test(key) || !title) throw unavailable(UNEXPECTED_FORM);

  const programme = PROGRAMMES[first('frameworkProgramme')] ?? '';
  const project = [first('projectAcronym'), first('projectName')].map((part) => plain(part, 160)).filter(Boolean);
  const funder =
    kind === 'cascade' && project.length > 0
      ? `EU-funded project ${project[0]}${project[1] ? ` (${project[1]})` : ''}`
      : programme
        ? `European Commission, ${programme}`
        : 'European Commission';

  const text = stripHtml(kind === 'cascade' ? first('description') : first('descriptionByte'));
  const lead =
    kind === 'cascade'
      ? `Cascade funding call run by an EU-funded project${topic ? ` under the EU topic ${plain(topic, 120)}` : ''}.`
      : kind === 'external'
        ? 'Call for proposals under EU external action.'
        : '';

  const written = hit('deadlineDate');
  const deadlines = written
    .map(readDate)
    .filter((deadline): deadline is Deadline => deadline !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  const lines = kind === 'topic' ? budgetLines(first('budgetOverview'), topic) : [];
  const yearly = lines.flatMap((line) => line.years.map(([, amount]) => amount));
  const currency = first('currency');

  const officialUrl =
    kind === 'topic'
      ? `${PORTAL}/topic-details/${encodeURIComponent(key)}`
      : kind === 'cascade'
        ? `${PORTAL}/competitive-calls-cs/${encodeURIComponent(key)}`
        : europaUrl(first('url'));

  return {
    recordId: `${kind}-${key}`,
    kind,
    topic,
    title,
    funder: clampText(funder, 300),
    programme,
    number: kind === 'cascade' ? '' : plain(topic, 120),
    summary: clampText([lead, text].filter(Boolean).join(' '), SUMMARY_LENGTH),
    statusCode: first('status'),
    openDate: readDate(first('startDate'))?.date ?? null,
    deadlines,
    unreadDeadline: deadlines.length === 0 ? (written[0]?.trim() ?? '') : '',
    awardFloor: smallest(lines.map((line) => line.floor)),
    awardCeiling: largest(lines.map((line) => line.ceiling)),
    totalFunding: kind !== 'topic' ? parseAmount(first('budget')) : yearly.length > 0 ? sum(yearly) : null,
    currency: /^[A-Z]{3}$/.test(currency) ? currency : 'EUR',
    officialUrl,
  };
}

/** The deadline that counts today: the next still to come, or the last once all have passed. */
function deadlineOf(listing: Listing, today: string): Deadline | null {
  const { deadlines } = listing;
  return deadlines.find((deadline) => deadline.date >= today) ?? deadlines[deadlines.length - 1] ?? null;
}

function toOpportunity(listing: Listing, now: number): Opportunity {
  const deadline = deadlineOf(listing, todayIn(TIME_ZONE, now));
  const known = STATUSES[listing.statusCode];
  const status = evaluateStatus({
    sourceState: known?.state ?? 'unknown',
    // Wording that is not a date is passed on as written, so that it is
    // reported as unreadable rather than as missing.
    closeDate: deadline?.date ?? (listing.unreadDeadline || null),
    ongoing: false,
    hasOfficialUrl: listing.officialUrl !== '',
    contradiction: '',
    detailChecked: null,
    fetchedAt: now,
    now,
    timeZone: TIME_ZONE,
  });

  const wording: string[] = [];
  if (deadline) {
    wording.push(formatDate(deadline.date));
    if (deadline.timed) wording.push('The official page gives the time of day.');
    if (listing.deadlines.length > 1) {
      const all = listing.deadlines.map((each) => each.date).join(', ');
      wording.push(`One of ${listing.deadlines.length} cut-off dates: ${all}.`);
    }
  } else if (listing.unreadDeadline) {
    wording.push(plain(listing.unreadDeadline, 120));
  }
  const [date, ...notes] = wording;

  return {
    id: opportunityId(SOURCE_ID, listing.recordId),
    sourceId: SOURCE_ID,
    sourceName: SOURCE_NAME,
    funder: listing.funder,
    kind: 'grant',
    level: 'international',
    country: '',
    region: '',
    jurisdiction: 'European Union',
    geographyNote: '',
    title: listing.title,
    summary: listing.summary,
    number: listing.number,
    applicantTypes: [],
    applicantNote: '',
    categories: [],
    awardFloor: listing.awardFloor,
    awardCeiling: listing.awardCeiling,
    totalFunding: listing.totalFunding,
    currency: listing.currency,
    openDate: listing.openDate,
    closeDate: deadline?.date ?? null,
    closeDateText: date ? clampText(notes.length > 0 ? `${date}. ${notes.join(' ')}` : date, 400) : '',
    ...status,
    sourceStatus: known?.label ?? listing.statusCode,
    officialUrl: listing.officialUrl,
    fetchedAt: now,
    match: null,
  };
}

const CURRENT_ONLY = { terms: { DATASOURCE: [CURRENT_RECORDS] } };

/** Listings read for one status, each checked to carry that status. */
function readListings(hits: Hit[], statusCode: string): Listing[] {
  const listings = hits.map(readListing);
  if (listings.some((listing) => listing.statusCode !== statusCode)) {
    throw unavailable('it ran a different search from the one that was sent.');
  }
  return listings;
}

/** Every listing with a status and a date from today on, one record type at a time. */
async function readEvery(statusCode: string, range: Json, context: SourceContext): Promise<Listing[]> {
  const listings: Listing[] = [];
  for (const [type, { key }] of Object.entries(KINDS)) {
    const { hits, total } = await readPages(
      {
        must: [{ terms: { type: [type] } }, CURRENT_ONLY, { terms: { status: [statusCode] } }, { range }],
        sort: { field: key, order: 'ASC' },
        fields: SEARCH_FIELDS,
      },
      MAX_PAGES,
      context,
    );
    if (total > hits.length) throw unavailable('it has more listings than can be read at once.');
    listings.push(...readListings(hits, statusCode));
  }
  return listings;
}

/** The hundred listings that closed most recently, whatever their type. */
async function readLatestClosed(context: SourceContext): Promise<Listing[]> {
  const { hits } = await readPage(
    {
      must: [{ terms: { type: Object.keys(KINDS).sort() } }, CURRENT_ONLY, { terms: { status: [CLOSED] } }],
      sort: { field: 'deadlineDate', order: 'DESC' },
      fields: SEARCH_FIELDS,
      pageNumber: 1,
      pageSize: PAGE_SIZE,
    },
    context,
  );
  return readListings(hits, CLOSED);
}

/** Plain text that keeps the paragraphs of the source's description. */
function paragraphs(html: string): string[] {
  return html
    .replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .split(/<\/(?:p|div|li|tr|h[1-6])\s*>|<br\s*\/?>/i)
    .map(stripHtml)
    .filter(Boolean);
}

const money = (amount: number, currency: string): string =>
  `${currency} ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(amount)}`;

/** The JSON list the source packs into one text value, or nothing when it cannot be read. */
function packedList(value: string): Json[] {
  try {
    const list: unknown = JSON.parse(value);
    return Array.isArray(list) ? list.filter(isRecord) : [];
  } catch {
    return [];
  }
}

function detailOf(hit: Hit, listing: Listing, now: number): OpportunityDetail {
  const first = (field: Field): string => hit(field)[0]?.trim() ?? '';
  const opportunity = toOpportunity(listing, now);
  const facts: OpportunityDetail['facts'] = [];
  const fact = (label: string, value: string) => {
    if (value) facts.push({ label, value: clampText(value, FACT_LENGTH) });
  };

  const titled = (id: string, title: string) => [plain(id, 120), plain(title, 200)].filter(Boolean).join(': ');
  fact('Programme', listing.programme);
  if (listing.kind === 'cascade') {
    fact('EU topic this call belongs to', titled(listing.topic, first('title')));
    fact('Duration', plain(first('duration'), 120));
  } else {
    fact('Call', titled(first('callIdentifier'), first('callTitle')));
  }
  fact('Type of action', hit('typesOfAction').map((action) => plain(action, 120)).filter(Boolean).join('; '));
  fact('Deadline model', plain(first('deadlineModel'), 60));
  if (listing.deadlines.length > 1) {
    fact('Cut-off dates', listing.deadlines.map((deadline) => formatDate(deadline.date)).join('; '));
  }
  fact('Status at the source', opportunity.sourceStatus);

  const lines = listing.kind === 'topic' ? budgetLines(first('budgetOverview'), listing.topic) : [];
  for (const line of lines) {
    const parts = [
      line.expectedGrants ? `${line.expectedGrants} expected ${line.expectedGrants === 1 ? 'grant' : 'grants'}` : '',
      line.floor ? `contribution from ${money(line.floor, listing.currency)}` : '',
      line.ceiling ? `contribution up to ${money(line.ceiling, listing.currency)}` : '',
      ...line.years.map(([year, amount]) => `${plain(year, 12)} budget ${money(amount, listing.currency)}`),
    ].filter(Boolean);
    fact(`Budget line: ${line.action}`, parts.join('; '));
  }
  if (listing.kind !== 'topic' && listing.totalFunding) {
    fact('Budget of the call', money(listing.totalFunding, listing.currency));
  }

  const links: OpportunityDetail['links'] = [];
  const link = (label: string, value: string) => {
    const url = europaUrl(value);
    if (url && !links.some((held) => held.url === url)) links.push({ label: clampText(label, 160), url });
  };
  link(`Listing on the ${SOURCE_NAME}`, listing.officialUrl);
  if (listing.kind === 'cascade' && listing.topic) {
    link('EU topic this call belongs to', `${PORTAL}/topic-details/${encodeURIComponent(listing.topic)}`);
  }
  for (const item of packedList(first('links')).slice(0, 4)) {
    if (typeof item.url !== 'string') continue;
    const action = typeof item.criterionDescription === 'string' ? plain(item.criterionDescription, 80) : '';
    link(action ? `Submission service: ${action}` : 'Submission service', item.url);
  }
  for (const item of packedList(first('publicationDocuments')).slice(0, 12)) {
    if (typeof item.docUrl !== 'string') continue;
    const name = typeof item.nameDoc === 'string' ? plain(item.nameDoc, 120) : '';
    link(name ? `Document: ${name}` : 'Document', item.docUrl);
  }

  const sections: [string, string[]][] =
    listing.kind === 'cascade'
      ? [
          ['', paragraphs(first('description'))],
          ['Further information', paragraphs(first('furtherInformation'))],
          ['How the project administers the call', paragraphs(first('beneficiaryAdministration'))],
        ]
      : [
          ['', paragraphs(first('descriptionByte'))],
          ['Conditions', paragraphs(first('topicConditions'))],
        ];
  const description = sections
    .filter(([, blocks]) => blocks.length > 0)
    .flatMap(([heading, blocks]) => (heading ? [heading, ...blocks] : blocks))
    .join('\n\n');

  return { opportunity, description: clampText(description, DESCRIPTION_LENGTH), facts, links };
}

export const euFundingTendersAdapter: SourceAdapter = {
  info: {
    id: SOURCE_ID,
    name: SOURCE_NAME,
    operator: 'European Commission',
    level: 'international',
    jurisdiction: 'European Union',
    coverage: { country: '', region: '', county: '', city: '' },
    kinds: ['grant'],
    homepageUrl: `${PORTAL}/calls-for-proposals`,
    attribution:
      '© European Union. Reused under the Creative Commons Attribution 4.0 International (CC BY 4.0) licence.',
    note:
      'The portal applies the status filter itself; every other filter, including the keyword, is applied on this device. ' +
      "A listing counts as open only while one of its deadlines is still to come, whatever the portal's own flag says. " +
      'Closed listings are limited to the 100 that closed most recently. ' +
      'Amounts are in euros. The portal does not record who may apply as data, so read the conditions on the official page, ' +
      'and check the time of day of a deadline there.',
  },

  async search(filters, context) {
    if (filters.kinds.length > 0 && !filters.kinds.includes('grant')) return [];
    const { statuses } = filters;
    const today = `${todayIn(TIME_ZONE, context.now)}T00:00:00.000+0000`;
    const wants = (status: 'unverified' | 'expired') => statuses.length === 0 || statuses.includes(status);

    // Open listings are always read: one can turn out active, unverified or
    // expired. A forthcoming topic whose opening date has passed is left out;
    // the portal's flag for it is as unreliable as its open one.
    const open = await readEvery(OPEN, { deadlineDate: { gte: today } }, context);
    const forecast = wants('unverified')
      ? await readEvery(FORTHCOMING, { startDate: { gte: today } }, context)
      : [];
    const closed = wants('expired') ? await readLatestClosed(context) : [];

    const listings = new Map<string, Listing>();
    for (const listing of [...open, ...forecast, ...closed]) {
      if (!listings.has(listing.recordId)) listings.set(listing.recordId, listing);
    }
    return [...listings.values()].map((listing) => toOpportunity(listing, context.now));
  },

  async detail(recordId, context) {
    const parts = /^(topic|cascade|external)-(.{1,150})$/su.exec(recordId);
    const key = parts?.[2];
    if (!parts || !key || /[\p{Cc}\p{Cf}]/u.test(recordId)) {
      throw new FundingError('INVALID_INPUT', 'That listing reference is not valid.');
    }
    const type = TYPE_OF[parts[1] as Kind];
    const { hits } = await readPage(
      {
        must: [{ terms: { type: [type] } }, CURRENT_ONLY, { terms: { [KINDS[type]!.key]: [key] } }],
        sort: { field: 'deadlineDate', order: 'DESC' },
        fields: DETAIL_FIELDS,
        pageNumber: 1,
        pageSize: 10,
      },
      context,
    );
    const record = hits
      .map((hit) => ({ hit, listing: readListing(hit) }))
      .find(({ listing }) => listing.recordId === recordId);
    if (!record) {
      throw new FundingError(
        'NOT_FOUND',
        `The ${SOURCE_NAME} has no listing with that reference. It may have been withdrawn.`,
      );
    }
    return detailOf(record.hit, record.listing, context.now);
  },
};
