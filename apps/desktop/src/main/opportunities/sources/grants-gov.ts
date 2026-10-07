// Grants.gov: the United States government's listing of federal grant
// opportunities, read through its public search and listing-record services.
// Everything below was established by calling both on 6 October 2026.
//
// The source answers "success" even when it has ignored or rejected part of a
// request, so each answer is checked against what was asked before a single
// row is used:
//   - it echoes the filters it applied, and any difference from what was sent
//     means it searched for something else;
//   - an answer with no echo is what a keyword outside ASCII produces, so
//     keywords are folded to ASCII first;
//   - no rows together with a non-zero count for the statuses asked for is
//     what an unsupported sort produces, so only sorts seen to work are sent;
//   - several values are joined with a pipe; any other separator matches
//     nothing;
//   - a missing listing record still answers 200, so the record's id and error
//     list are read, never the HTTP status.
//
// Search rows carry no description, amounts or eligibility, and "posted" alone
// does not mean open: that day a listing posted the day before said in its own
// text that it was archived. So the most relevant rows are re-read one by one,
// and only a listing whose own record was read can be called active.

import {
  APPLICANT_TYPE_LABELS,
  FUNDING_CATEGORY_LABELS,
  type ApplicantType,
  type FundingCategory,
  type Opportunity,
  type OpportunityDetail,
  type OpportunityFilters,
  type OpportunityStatus,
} from '../../../shared/funding.js';
import { FundingError, isFundingError } from '../../funding/errors.js';
import { clampText, parseAmount, parseDate, queryTerms, stripHtml } from '../normalize.js';
import type { SourceHints } from '../service.js';
import { evaluateStatus, todayIn, type StatusInput } from '../status.js';
import { opportunityId, type SourceAdapter, type SourceContext } from '../types.js';

const SOURCE_ID = 'grants-gov';
const SOURCE_NAME = 'Grants.gov';
const SEARCH_URL = 'https://api.grants.gov/v1/api/search2';
const RECORD_URL = 'https://api.grants.gov/v1/api/fetchOpportunity';
/** Grants.gov gives its dates in Eastern Time. */
const TIME_ZONE = 'America/New_York';

/** Room for every open listing in one answer; there were 1,465 when this was written. */
const OPEN_ROWS = 5000;
/** Closed and archived listings go back two decades (82,060 of them); only the latest to close are read. */
const CLOSED_ROWS = 500;
const MAX_RECORD_READS = 40;
const RECORD_READS_AT_ONCE = 6;
/** A record normally arrives in half a second; one this slow is given up on. */
const RECORD_TIMEOUT_MS = 12_000;
/** Once reading records has taken this long, the rows not yet started stay unread. */
const RECORD_BUDGET_MS = 20_000;
const MAX_KEYWORD_TERMS = 12;

const TITLE_LENGTH = 300;
/** Long enough that a search term found by the source is usually found again on the device. */
const SUMMARY_LENGTH = 4000;
const DESCRIPTION_LENGTH = 40_000;
const NOTE_LENGTH = 1500;
const EXPLANATION_LENGTH = 1200;
const FACT_LENGTH = 600;
/** Lists of every eligible applicant type or category run long. */
const LIST_FACT_LENGTH = 2400;
/** The most of any one field that is read, so an absurd answer cannot stall the app. */
const MAX_FIELD_LENGTH = 80_000;

const EVERY_APPLICANT = Object.keys(APPLICANT_TYPE_LABELS) as ApplicantType[];
const EVERY_CATEGORY = Object.keys(FUNDING_CATEGORY_LABELS) as FundingCategory[];

/** Grants.gov's seventeen eligibility codes as the app's applicant types. */
export const ELIGIBILITY_CODES: Readonly<Record<string, readonly ApplicantType[]>> = {
  '00': ['state_government'],
  '01': ['local_government'],
  '02': ['local_government'],
  '04': ['local_government'],
  '05': ['education'],
  '06': ['education'],
  '07': ['tribal'],
  // Public housing authorities are local bodies; Indian housing authorities are tribal ones.
  '08': ['local_government', 'tribal'],
  '11': ['tribal'],
  '12': ['nonprofit'],
  '13': ['nonprofit'],
  '20': ['education'],
  '21': ['individual'],
  '22': ['for_profit'],
  '23': ['small_business'],
  // "Others": the listing's eligibility text says who.
  '25': ['other'],
  // "Unrestricted": open to every type above.
  '99': EVERY_APPLICANT,
};

/**
 * Grants.gov's twenty-eight funding categories as the app's. A code with no
 * counterpart is filed under "other" rather than forced into a near miss; the
 * source's own wording is always shown in the listing's facts.
 */
export const CATEGORY_CODES: Readonly<Record<string, readonly FundingCategory[]>> = {
  ACA: ['health'],
  AG: ['agriculture_food'],
  AR: ['arts_culture_humanities'],
  BC: ['business_economic_development'],
  CD: ['community_development'],
  CP: ['other'],
  DPR: ['disaster_emergency'],
  ED: ['education'],
  EIC: ['energy'],
  ELT: ['employment_workforce'],
  EN: ['energy'],
  ENV: ['environment_natural_resources'],
  FN: ['agriculture_food'],
  HL: ['health'],
  HO: ['housing'],
  HU: ['arts_culture_humanities'],
  IIJ: ['transportation_infrastructure'],
  IS: ['other'],
  ISS: ['human_services'],
  LJL: ['justice_public_safety'],
  NR: ['environment_natural_resources'],
  O: ['other'],
  OZ: ['community_development', 'business_economic_development'],
  RA: ['other'],
  RD: ['community_development', 'business_economic_development'],
  RT: ['other'],
  ST: ['science_technology_research'],
  T: ['transportation_infrastructure'],
};

type Json = Record<string, unknown>;
type SourceState = StatusInput['sourceState'];

const STATES = new Map<string, SourceState>([
  ['posted', 'open'],
  ['forecasted', 'forecast'],
  ['closed', 'closed'],
  ['archived', 'closed'],
]);

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asText = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
// Federal eligibility text is full of section signs and middle dots, written
// as two entities the shared decoder does not know.
const bounded = (value: unknown): string =>
  asText(value)
    .slice(0, MAX_FIELD_LENGTH)
    .replace(/&(?:amp;)?(sect|middot);/gi, (_whole, name: string) => (name.toLowerCase() === 'sect' ? '§' : '·'));
const plain = (value: unknown, max: number): string => clampText(stripHtml(bounded(value)), max);

const unavailable = (detail: string) =>
  new FundingError('SOURCE_UNAVAILABLE', `${SOURCE_NAME} could not be read: ${detail}`);
const UNEXPECTED_FORM = 'its answer was not in the expected form.';
const TOO_MANY_OPEN =
  `${SOURCE_NAME} has more open listings for this search than can be read at once. ` +
  'Add a keyword or a category to narrow it.';

const officialUrl = (id: string) => `https://www.grants.gov/search-results-detail/${id}`;

/** The source's codes for a choice of the app's values, pipe-joined as the source requires. */
function codesFor<T extends string>(table: Readonly<Record<string, readonly T[]>>, wanted: readonly T[]): string {
  return Object.keys(table)
    .filter((code) => table[code]!.some((value) => wanted.includes(value)))
    .sort()
    .join('|');
}

/** The app's values for the source's codes, in the app's own order. An unknown code is "other". */
function valuesFor<T extends string>(
  table: Readonly<Record<string, readonly T[]>>,
  codes: string[],
  order: readonly T[],
): T[] {
  const found = new Set(codes.flatMap<string>((code) => (Object.hasOwn(table, code) ? table[code]! : ['other'])));
  return order.filter((value) => found.has(value));
}

/**
 * The search entry as the source's keyword: every term required. Accents are
 * folded and anything still outside ASCII is left to the filter on the device,
 * because the source answers a non-ASCII keyword with an empty reply.
 */
function keywordFor(query: string): string {
  const terms = queryTerms(query.normalize('NFD').replace(/\p{M}/gu, '')).filter(
    (term) => /^[a-z0-9]+$/.test(term) && !['and', 'or', 'not'].includes(term),
  );
  return [...new Set(terms)].slice(0, MAX_KEYWORD_TERMS).join(' AND ');
}

interface SearchRequest {
  keyword: string;
  oppStatuses: string;
  eligibilities: string;
  fundingCategories: string;
  /** '' is the source's relevance order. No other value is ever sent. */
  sortBy: '' | 'closeDate|desc';
  rows: number;
  startRecordNum: number;
}

/** Filters this adapter never sends; the source must not report having applied one. */
const UNSENT_FILTERS = ['oppNum', 'cfda', 'fundingInstruments', 'agencies'];

interface Row {
  id: string;
  number: string;
  title: string;
  funder: string;
  openDate: string;
  closeDate: string;
  sourceStatus: string;
}

function readRow(hit: unknown): Row {
  if (!isRecord(hit)) throw unavailable(UNEXPECTED_FORM);
  const id = asText(hit.id);
  const title = plain(hit.title, TITLE_LENGTH);
  if (!/^[1-9]\d{0,11}$/.test(id) || !title) throw unavailable(UNEXPECTED_FORM);
  return {
    id,
    number: plain(hit.number, 120),
    title,
    funder: plain(hit.agency, 200),
    openDate: asText(hit.openDate).trim(),
    closeDate: asText(hit.closeDate).trim(),
    sourceStatus: asText(hit.oppStatus).trim().toLowerCase(),
  };
}

async function readRows(request: SearchRequest, context: SourceContext): Promise<{ rows: Row[]; total: number }> {
  const reply = await context.http.json<unknown>({
    url: SEARCH_URL,
    body: request,
    signal: context.signal,
    source: SOURCE_NAME,
  });
  const data = isRecord(reply) ? reply.data : null;
  if (!isRecord(reply) || !isRecord(data)) throw unavailable(UNEXPECTED_FORM);
  if ((reply.errorcode ?? 0) !== 0 || asList(data.errorMsgs).length > 0) {
    throw unavailable('it reported a problem with the search.');
  }

  const echo = data.searchParams;
  if (!isRecord(echo)) throw unavailable('it did not confirm which search it ran.');
  const sentAsAsked = Object.entries(request).every(([name, value]) => asText(echo[name]) === String(value));
  if (!sentAsAsked || UNSENT_FILTERS.some((name) => asText(echo[name]) !== '')) {
    throw unavailable('it ran a different search from the one that was sent.');
  }

  const total = data.hitCount;
  const hits = data.oppHits;
  if (typeof total !== 'number' || !Number.isInteger(total) || total < 0 || !Array.isArray(hits)) {
    throw unavailable(UNEXPECTED_FORM);
  }
  // The counts cover every status, so only those for the statuses asked for
  // can contradict an empty answer.
  const asked = request.oppStatuses.split('|');
  const counted = asList(data.oppStatusOptions).reduce<number>(
    (sum, option) =>
      isRecord(option) && asked.includes(asText(option.value)) && typeof option.count === 'number'
        ? sum + option.count
        : sum,
    0,
  );
  if (total === 0 && counted > 0) {
    throw unavailable('it returned no listings for a search it counts matches for.');
  }
  if (hits.length !== Math.min(total, request.rows)) {
    throw unavailable('it returned a different number of listings than it reported.');
  }
  return { rows: hits.map(readRow), total };
}

async function fetchRecord(recordId: string, context: SourceContext): Promise<Json> {
  if (!/^[1-9]\d{0,11}$/.test(recordId)) {
    throw new FundingError('INVALID_INPUT', 'That listing reference is not valid.');
  }
  const reply = await context.http.json<unknown>({
    url: RECORD_URL,
    body: { opportunityId: Number(recordId) },
    signal: context.signal,
    timeoutMs: RECORD_TIMEOUT_MS,
    source: SOURCE_NAME,
  });
  const data = isRecord(reply) ? reply.data : null;
  if (!isRecord(reply) || !isRecord(data)) throw unavailable(UNEXPECTED_FORM);
  const problems = asList(data.errorMessages);
  if (data.id === undefined || data.id === null) {
    // "No record" is the source's answer for an id it does not have. An answer
    // with neither a record nor that message is its own back end failing.
    if (problems.some((problem) => /no record/i.test(asText(problem)))) {
      throw new FundingError(
        'NOT_FOUND',
        `${SOURCE_NAME} has no listing with that reference. It may have been withdrawn.`,
      );
    }
    throw unavailable('it did not return the listing.');
  }
  if (asText(data.id) !== recordId) throw unavailable('it returned a different listing from the one asked for.');
  if ((reply.errorcode ?? 0) !== 0 || problems.length > 0) {
    throw unavailable('it reported a problem with the listing.');
  }
  return data;
}

/** A listing as read from the source, before the status rule is applied. */
interface Listing {
  id: string;
  number: string;
  title: string;
  funder: string;
  sourceStatus: string;
  openDate: string | null;
  /** The deadline as the source wrote it; '' when it gives none. */
  closeDateWritten: string;
  closeDateText: string;
  contradiction: string;
  detailChecked: boolean;
  summary: string;
  applicantTypes: ApplicantType[];
  applicantNote: string;
  categories: FundingCategory[];
  awardFloor: number | null;
  awardCeiling: number | null;
  totalFunding: number | null;
}

function toOpportunity(listing: Listing, now: number): Opportunity {
  const closeDate = parseDate(listing.closeDateWritten);
  const status = evaluateStatus({
    sourceState: STATES.get(listing.sourceStatus) ?? 'unknown',
    // A date that cannot be read is passed on as written, so that it is
    // reported as unreadable rather than as missing.
    closeDate: closeDate ?? (listing.closeDateWritten || null),
    // The source has no flag for a rolling deadline, and a listing from 2015
    // still says "accepted year-round", so an undated listing is never taken
    // to be open-ended.
    ongoing: false,
    hasOfficialUrl: true,
    contradiction: listing.contradiction,
    detailChecked: listing.detailChecked,
    fetchedAt: now,
    now,
    timeZone: TIME_ZONE,
  });
  return {
    id: opportunityId(SOURCE_ID, listing.id),
    sourceId: SOURCE_ID,
    sourceName: SOURCE_NAME,
    funder: listing.funder,
    kind: 'grant',
    level: 'federal',
    country: 'US',
    region: '',
    jurisdiction: 'United States',
    geographyNote: '',
    title: listing.title,
    summary: listing.summary,
    number: listing.number,
    applicantTypes: listing.applicantTypes,
    applicantNote: listing.applicantNote,
    categories: listing.categories,
    awardFloor: listing.awardFloor,
    awardCeiling: listing.awardCeiling,
    totalFunding: listing.totalFunding,
    currency: 'USD',
    openDate: listing.openDate,
    closeDate,
    closeDateText: listing.closeDateText,
    ...status,
    sourceStatus: listing.sourceStatus,
    officialUrl: officialUrl(listing.id),
    fetchedAt: now,
    match: null,
  };
}

const NOT_READ_YET =
  'The source lists this as open, but its own record has not been read yet. Check it to confirm it is still open.';

/**
 * A search row whose own record was not read, or could not be. A row that
 * could be called active is held back until its record confirms it. Any other
 * row is already described by what it says (no deadline, a placeholder date, a
 * forecast), so only a read that failed is reported as one.
 */
function fromRow(row: Row, now: number, readFailed: boolean, couldBeActive: boolean): Opportunity {
  const opportunity = toOpportunity(
    {
      id: row.id,
      number: row.number,
      title: row.title,
      funder: row.funder,
      sourceStatus: row.sourceStatus,
      openDate: parseDate(row.openDate),
      closeDateWritten: row.closeDate,
      closeDateText: row.closeDate,
      contradiction: '',
      detailChecked: !readFailed && !couldBeActive,
      summary: '',
      applicantTypes: [],
      applicantNote: '',
      categories: [],
      awardFloor: null,
      awardCeiling: null,
      totalFunding: null,
    },
    now,
  );
  // The status rule words an unconfirmed listing as a failed re-read. When no
  // re-read was attempted, say that instead.
  return !readFailed && couldBeActive ? { ...opportunity, statusReason: NOT_READ_YET } : opportunity;
}

// The source pads every date with a midnight time that means nothing; the real
// time of day, when there is one, is in the explanation beside it.
const asWritten = (value: unknown): string =>
  asText(value)
    .replace(/\s+12:00:00 AM(?:\s+[A-Z]{2,5})?\s*$/, '')
    .trim();

// "Is archived", "has been cancelled": the listing is shut. After "until" or
// "if" the same words only say what would one day end it.
const SHUT_RE =
  /\b(?:is|are|was|were|has been|have been)\s+(?:now\s+)?(?:archived|cancell?ed|withdrawn|rescinded|terminated|discontinued)\b/i;
const HYPOTHETICAL_RE = /\b(?:until|unless|if|when|once|should|whether|in case|in the event)\b/i;
// "Not accepting", "are not accepted", "is no longer available": shut, unless
// the sentence is about one kind of application, which is an ordinary deadline
// rule. So is what "can no longer be accepted" once the closing date has come.
const REFUSING_RE =
  /\bnot\s+(?:currently\s+|now\s+)?accepting\b|\b(?:is|are)\s+not\s+(?:being\s+|currently\s+)?accepted\b/i;
const NO_LONGER_RE =
  /\bno longer\s+accepting\b|\b(?:is|are)\s+no longer\s+(?:being\s+)?(?:accepted|available|open|active)\b/i;
const CONDITION_RE =
  /\b(?:late|after|paper|hard[\s-]?cop(?:y|ies)|mail(?:ed)?|fax(?:ed)?|e-?mail(?:ed)?|incomplete|unsolicited|unless)\b/i;

/**
 * The sentence, if any, in which the source's deadline explanation says the
 * listing is not open. Deliberately narrow: "late applications are not
 * accepted" is an ordinary deadline rule; "proposals are not accepted" is not.
 * Among the notes of 42 listings read on the day this was written it picks out
 * the one archived listing and nothing else.
 */
function closedWording(explanation: string): string {
  for (const sentence of explanation.split(/(?<=[.!?;])\s+/)) {
    const shut = SHUT_RE.exec(sentence);
    if (shut && !HYPOTHETICAL_RE.test(sentence.slice(0, shut.index))) return sentence;
    if ((REFUSING_RE.test(sentence) || NO_LONGER_RE.test(sentence)) && !CONDITION_RE.test(sentence)) return sentence;
  }
  return '';
}

/** Plain text that keeps the paragraphs of the source's description. */
function paragraphs(html: string, max: number): string {
  const blocks = html
    .replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .split(/<\/(?:p|div|li|tr|h[1-6])\s*>|<br\s*\/?>|(?:\r?\n[^\S\r\n]*){2,}/i)
    .map(stripHtml)
    .filter(Boolean);
  return clampText(blocks.join('\n\n'), max);
}

const oneLine = (value: unknown, max: number): string =>
  clampText(
    bounded(value)
      .split(/[\r\n]+/)
      .map(stripHtml)
      .filter(Boolean)
      .join(', '),
    max,
  );

/** The source's {id, description} pairs. */
function coded(value: unknown): { id: string; label: string }[] {
  return asList(value)
    .filter(isRecord)
    .map((item) => ({ id: asText(item.id).trim(), label: plain(item.description, 240) }));
}

/** A link the source attaches, only when it is an ordinary web address. */
function webAddress(value: unknown): string | null {
  const written = asText(value).trim();
  if (!written || written.length > 2000) return null;
  try {
    const url = new URL(written);
    const web = url.protocol === 'https:' || url.protocol === 'http:';
    return web && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

interface RecordReading {
  listing: Listing;
  description: string;
  facts: OpportunityDetail['facts'];
  links: OpportunityDetail['links'];
}

const OTHERS_NOTE =
  'The source lists "Others" as eligible without saying who. Read the eligibility section of the full announcement.';

function readRecord(record: Json): RecordReading {
  const id = asText(record.id);
  const title = plain(record.opportunityTitle, TITLE_LENGTH);
  // A listing that began as a forecast keeps the forecast beside its synopsis;
  // the synopsis is the current one.
  const docType = asText(record.docType).toLowerCase();
  const estimated = docType === 'forecast' || (docType !== 'synopsis' && !isRecord(record.synopsis));
  const part = estimated ? record.forecast : record.synopsis;
  if (!title || !isRecord(part)) throw unavailable(UNEXPECTED_FORM);

  // The synopsis has an agency-name field too, but it sometimes holds a person.
  const agencyName = (value: unknown) => (isRecord(value) ? plain(value.agencyName, 200) : '');
  const funder =
    agencyName(record.agencyDetails) || agencyName(part.agencyDetails) || agencyName(record.topAgencyDetails);

  // A forecast's due date is the funder's estimate. It is kept as the close
  // date, so that a forecast whose estimate has passed is not shown as
  // upcoming, and it is worded as an estimate wherever it appears as text.
  const dateWritten = asWritten(estimated ? part.estApplicationResponseDate : part.responseDate);
  const explained = plain(estimated ? part.estApplicationResponseDateDesc : part.responseDateDesc, EXPLANATION_LENGTH);
  // "undefined" and "No Explanation" are what the source stores when nobody wrote one.
  const explanation = /^(?:undefined|no explanation)\.?$/i.test(explained) ? '' : explained;
  const dateShown = estimated && dateWritten ? `Estimated by the funder: ${dateWritten}` : dateWritten;

  const html = bounded(estimated ? part.forecastDesc : part.synopsisDesc);
  const applicants = coded(part.applicantTypes);
  const categories = coded(part.fundingActivityCategories);
  const eligibility = plain(part.applicantEligibilityDesc, NOTE_LENGTH);

  const listing: Listing = {
    id,
    number: plain(record.opportunityNumber, 120),
    title,
    funder,
    sourceStatus: asText(record.ost).trim().toLowerCase(),
    openDate: parseDate(asText(part.postingDate)),
    closeDateWritten: dateWritten,
    closeDateText: [dateShown, explanation].filter(Boolean).join('. '),
    contradiction: closedWording(explanation),
    detailChecked: true,
    summary: plain(html, SUMMARY_LENGTH),
    applicantTypes: valuesFor(
      ELIGIBILITY_CODES,
      applicants.map((item) => item.id),
      EVERY_APPLICANT,
    ),
    applicantNote: eligibility || (applicants.some((item) => item.id === '25') ? OTHERS_NOTE : ''),
    categories: valuesFor(
      CATEGORY_CODES,
      categories.map((item) => item.id),
      EVERY_CATEGORY,
    ),
    awardFloor: parseAmount(part.awardFloor),
    awardCeiling: parseAmount(part.awardCeiling),
    totalFunding: parseAmount(part.estimatedFunding),
  };

  const facts: OpportunityDetail['facts'] = [];
  const fact = (label: string, value: string, max = FACT_LENGTH) => {
    if (value) facts.push({ label, value: clampText(value, max) });
  };
  const labels = (items: { label: string }[]) => items.map((item) => item.label).filter(Boolean);

  if (typeof part.costSharing === 'boolean') fact('Cost sharing or matching required', part.costSharing ? 'Yes' : 'No');
  fact('Expected number of awards', plain(part.numberOfAwards, 40));
  fact('Funding instrument', labels(coded(part.fundingInstruments)).join(', '));
  fact(
    'Assistance listing numbers',
    asList(record.cfdas)
      .filter(isRecord)
      .map((item) => `${plain(item.cfdaNumber, 20)} ${plain(item.programTitle, 160)}`.trim())
      .filter(Boolean)
      .join('; '),
  );
  fact(
    'Funding category at the source',
    [...labels(categories), plain(part.fundingActivityCategoryDesc, 400)].filter(Boolean).join('; '),
    LIST_FACT_LENGTH,
  );
  fact('Eligible applicants at the source', labels(applicants).join('; '), LIST_FACT_LENGTH);
  if (estimated) {
    fact('Estimated posting date', asWritten(part.estSynopsisPostingDate));
    fact('Estimated award date', asWritten(part.estAwardDate));
    fact('Estimated project start date', asWritten(part.estProjectStartDate));
    fact('Fiscal year', asText(part.fiscalYear));
  }
  fact('Last updated at the source', plain(part.lastUpdatedDate, 60));

  const contactName = oneLine(part.agencyContactName, 200);
  fact(
    'Agency contact',
    [contactName === funder ? '' : contactName, oneLine(part.agencyContactDesc, 300)].filter(Boolean).join(', '),
  );
  const email = asText(part.agencyContactEmail).trim();
  if (/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) fact('Contact email', email);
  const phone = plain(part.agencyContactPhone, 40);
  if (phone.replace(/\D/g, '').length >= 7) fact('Contact phone', phone);

  const links: OpportunityDetail['links'] = [
    { label: 'Listing on Grants.gov', url: officialUrl(id) },
    { label: 'Listing on Simpler.Grants.gov', url: `https://simpler.grants.gov/opportunity/${id}` },
  ];
  const funderPage = webAddress(part.fundingDescLinkUrl);
  if (funderPage) {
    // A description that is itself an address could name a different site than the link opens.
    const described = plain(part.fundingDescLinkDesc, 120);
    const usable = described && !/^(?:https?:|www\.)/i.test(described);
    links.push({ label: usable ? `Funder's page: ${described}` : "Funder's page", url: funderPage });
  }

  return { listing, description: paragraphs(html, DESCRIPTION_LENGTH), facts, links };
}

/** The status a row would have if its own record confirmed what the row says. */
function bestCase(row: Row, now: number): OpportunityStatus {
  return evaluateStatus({
    sourceState: STATES.get(row.sourceStatus) ?? 'unknown',
    closeDate: parseDate(row.closeDate) ?? (row.closeDate || null),
    ongoing: false,
    hasOfficialUrl: true,
    contradiction: '',
    detailChecked: true,
    fetchedAt: now,
    now,
    timeZone: TIME_ZONE,
  }).status;
}

const READ_FIRST: Record<OpportunityStatus, number> = { active: 0, unverified: 1, expired: 2 };
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The rows whose own records are worth reading, most useful first: only rows
 * that could still pass the status and deadline filters, those that could be
 * confirmed active ahead of the rest, then in the source's relevance order
 * when there is a keyword and by nearest deadline when there is none.
 */
function worthReading(
  rows: Row[],
  outlook: Map<string, OpportunityStatus>,
  filters: OpportunityFilters,
  now: number,
  byRelevance: boolean,
): Row[] {
  const today = Date.parse(todayIn(TIME_ZONE, now));
  const { deadlineFrom: from, deadlineTo: to, statuses } = filters;
  const candidates = rows
    .map((row, position) => {
      const closeDate = parseDate(row.closeDate);
      const distance = closeDate ? Math.abs(Date.parse(closeDate) - today) / DAY_MS : Infinity;
      return { row, position, closeDate, distance, status: outlook.get(row.id) ?? 'unverified' };
    })
    .filter(({ row, closeDate, status }) => {
      if (statuses.length > 0 && !statuses.includes(status)) return false;
      if (!from && !to) return true;
      // A forecast's estimated deadline is only in its own record.
      if (!closeDate) return row.sourceStatus === 'forecasted';
      return (!from || closeDate >= from) && (!to || closeDate <= to);
    });
  // Two rows without a deadline compare as NaN, which falls through like a tie.
  candidates.sort(
    (a, b) =>
      READ_FIRST[a.status] - READ_FIRST[b.status] ||
      (byRelevance ? 0 : a.distance - b.distance) ||
      a.position - b.position,
  );
  return candidates.slice(0, MAX_RECORD_READS).map((candidate) => candidate.row);
}

/**
 * Each row's own record, or null where reading it failed. A row that is not in
 * the result was never started, because the source was answering too slowly.
 */
async function readRecords(rows: Row[], context: SourceContext): Promise<Map<string, RecordReading | null>> {
  const readings = new Map<string, RecordReading | null>();
  const stopAt = Date.now() + RECORD_BUDGET_MS;
  let next = 0;
  let stopped = false;
  const lanes = Array.from({ length: Math.min(RECORD_READS_AT_ONCE, rows.length) }, async () => {
    while (!stopped && next < rows.length && Date.now() < stopAt) {
      const row = rows[next++]!;
      try {
        readings.set(row.id, readRecord(await fetchRecord(row.id, context)));
      } catch (error) {
        // Cancelling stops the whole search. Any other failure leaves just this
        // one listing unconfirmed.
        if (context.signal.aborted || (isFundingError(error) && error.code === 'CANCELLED')) {
          stopped = true;
          throw error;
        }
        readings.set(row.id, null);
      }
    }
  });
  await Promise.all(lanes);
  return readings;
}

export const grantsGovAdapter: SourceAdapter & Required<SourceHints> = {
  timeZone: TIME_ZONE,
  // Place, level, amount and the choice of sources are left to the device, so
  // changing them does not call for another read of the source.
  filtersRead: ['query', 'applicantTypes', 'categories', 'kinds', 'statuses', 'deadlineFrom', 'deadlineTo'],
  info: {
    id: SOURCE_ID,
    name: SOURCE_NAME,
    operator: 'U.S. Department of Health and Human Services',
    level: 'federal',
    jurisdiction: 'United States',
    coverage: { country: 'US', region: '', county: '', city: '' },
    kinds: ['grant'],
    homepageUrl: 'https://www.grants.gov/search-grants',
    attribution: '',
    note: [
      'Grants.gov applies the keyword, applicant type and category filters itself;',
      'deadline, award amount and every other filter are applied on this device.',
      `Each search confirms up to ${MAX_RECORD_READS} listings against their own records,`,
      'and the rest stay unverified until they are checked.',
      `Closed listings are limited to the ${CLOSED_ROWS} that closed most recently.`,
      'Grants.gov does not record where a grant may be used,',
      'so read the eligibility text for geographic limits.',
    ].join(' '),
  },

  async search(filters, context) {
    if (filters.kinds.length > 0 && !filters.kinds.includes('grant')) return [];
    const shared = {
      keyword: keywordFor(filters.query),
      eligibilities: codesFor(ELIGIBILITY_CODES, filters.applicantTypes),
      fundingCategories: codesFor(CATEGORY_CODES, filters.categories),
      startRecordNum: 0,
    };
    const { statuses } = filters;

    // A posted listing can turn out active, unverified or expired, so posted
    // listings are always read; forecasts only when unverified ones are wanted.
    const open = await readRows(
      {
        ...shared,
        oppStatuses: statuses.length === 0 || statuses.includes('unverified') ? 'forecasted|posted' : 'posted',
        sortBy: '',
        rows: OPEN_ROWS,
      },
      context,
    );
    if (open.total > open.rows.length) throw new FundingError('SOURCE_UNAVAILABLE', TOO_MANY_OPEN);
    const closed = statuses.includes('expired')
      ? await readRows(
          { ...shared, oppStatuses: 'archived|closed', sortBy: 'closeDate|desc', rows: CLOSED_ROWS },
          context,
        )
      : { rows: [] };

    const rows = [...new Map([...open.rows, ...closed.rows].map((row): [string, Row] => [row.id, row])).values()];
    const outlook = new Map(rows.map((row): [string, OpportunityStatus] => [row.id, bestCase(row, context.now)]));
    const chosen = worthReading(rows, outlook, filters, context.now, shared.keyword !== '');
    const records = await readRecords(chosen, context);
    return rows.map((row) => {
      const reading = records.get(row.id);
      if (reading) return toOpportunity(reading.listing, context.now);
      return fromRow(row, context.now, reading === null, outlook.get(row.id) === 'active');
    });
  },

  async detail(recordId, context) {
    const reading = readRecord(await fetchRecord(recordId, context));
    return {
      opportunity: toOpportunity(reading.listing, context.now),
      description: reading.description,
      facts: reading.facts,
      links: reading.links,
    };
  },
};
