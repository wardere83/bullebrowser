// New York City's City Record Online: every notice the City prints in its
// official journal, published as a dataset on NYC Open Data. Everything below
// was established by calling it on 6 October 2026.
//
// These are requests for proposals and bids, not grants. They are listed
// because this is how the City funds most community services.
//
//   - The dataset holds more than a million rows, most of them personnel
//     changes, so every query names the Procurement section. Within it only
//     notices typed "Solicitation" are read: awards and intents to award are
//     history and are never shown as opportunities.
//   - The City sorts solicitations into six categories. The three that ask for
//     services are read; goods and construction are left out.
//   - There is no status column. A solicitation runs until its due date, so
//     that date alone decides whether it can be called active. Open-ended ones
//     carry placeholder dates such as 2099 or 9999; they are passed on as
//     written and labelled unverified.
//   - A procurement is noticed again each time it is extended, corrected or
//     cancelled, and every notice is a row of its own. Only the latest notice
//     for a procurement is shown. A notice that cancels or closes one is still
//     typed "Solicitation", often with a placeholder due date, so its own
//     wording is checked before it can be called active.

import type { Opportunity, OpportunityDetail } from '../../../shared/funding.js';
import { FundingError } from '../../funding/errors.js';
import { clampText, decodeEntities, parseAmount, stripHtml } from '../normalize.js';
import { evaluateStatus, todayIn } from '../status.js';
import { opportunityId, type SourceAdapter } from '../types.js';
import {
  dateWording,
  literal,
  readEveryRow,
  readRows,
  unavailable,
  UNEXPECTED_FORM,
  type ColumnKind,
  type SocrataRow,
} from './socrata.js';

const SOURCE_ID = 'nyc-city-record';
const SOURCE_NAME = 'NYC City Record Online';
const RESOURCE = 'https://data.cityofnewyork.us/resource/dg92-zbpx.json';
const PASSPORT_URL = 'https://passport.cityofnewyork.us/page.aspx/en/rfp/request_browse_public';
/** The dataset states no time zone; its dates are read as the City's own. */
const TIME_ZONE = 'America/New_York';

const SECTION = 'Procurement';
const NOTICE_TYPE = 'Solicitation';
/** The City's categories for work that is proposed and delivered as a service. */
export const SERVICE_CATEGORIES: readonly string[] = [
  'Human Services/Client Services',
  'Services (other than human services)',
  'Goods and Services',
];

const OPEN_ROWS = 2000;
/** Past solicitations go back two decades, so only the latest to fall due are read. */
const PAST_ROWS = 200;

const TITLE_LENGTH = 300;
const SUMMARY_LENGTH = 600;
const DESCRIPTION_LENGTH = 20_000;
const FACT_LENGTH = 600;
const MAX_DOCUMENTS = 8;

const COLUMNS = {
  request_id: 'text',
  start_date: 'time',
  end_date: 'time',
  agency_name: 'text',
  type_of_notice_description: 'text',
  category_description: 'text',
  short_title: 'text',
  selection_method_description: 'text',
  section_name: 'text',
  special_case_reason_description: 'text',
  pin: 'text',
  due_date: 'time',
  address_to_request: 'text',
  contact_name: 'text',
  contact_phone: 'text',
  email: 'text',
  contract_amount: 'text',
  additional_description_1: 'text',
  additional_description_2: 'text',
  additional_description_3: 'text',
  other_info_1: 'text',
  other_info_2: 'text',
  other_info_3: 'text',
  document_links: 'link',
} as const satisfies Record<string, ColumnKind>;

/** Just enough of a notice to tell which one is the latest for its procurement. */
const OUTLINE_COLUMNS = {
  request_id: 'text',
  start_date: 'time',
  agency_name: 'text',
  pin: 'text',
  due_date: 'time',
  short_title: 'text',
} as const satisfies Record<string, ColumnKind>;

type Notice = SocrataRow<keyof typeof COLUMNS>;
type Outline = SocrataRow<keyof typeof OUTLINE_COLUMNS>;

const SOLICITATIONS = `section_name=${literal(SECTION)} AND type_of_notice_description=${literal(NOTICE_TYPE)}`;
const IN_SCOPE = `${SOLICITATIONS} AND category_description in(${SERVICE_CATEGORIES.map(literal).join(',')})`;

const plain = (value: string, max: number): string => clampText(stripHtml(value), max);
const officialUrl = (id: string) => `https://a856-cityrecord.nyc.gov/RequestDetail/${id}`;

function readId(notice: Outline): string {
  const id = notice.text('request_id');
  if (!/^\d{6,14}$/.test(id)) throw unavailable(SOURCE_NAME, UNEXPECTED_FORM);
  return id;
}

/**
 * What ties the notices of one procurement together: the agency and its
 * procurement identification number. Only a full number counts. Some agencies
 * reuse a short one ("3434") across unrelated solicitations and others write
 * a label instead ("Emergency Solicitati"); a notice with either stands alone,
 * so that it can never be hidden by a notice for something else.
 */
function procurementOf(notice: Outline): string | null {
  const pin = notice.text('pin').replace(/\s+/g, ' ').trim().toLowerCase();
  if (pin.length < 8 || pin.replace(/\D/g, '').length < 5) return null;
  return `${notice.text('agency_name').trim().toLowerCase()} | ${pin}`;
}

/** True when `a` was published after `b`. Request ids are issued in order. */
function isLater(a: Outline, b: Outline): boolean {
  const published = (notice: Outline) => notice.time('start_date')?.written ?? '';
  if (published(a) !== published(b)) return published(a) > published(b);
  const id = (notice: Outline) => notice.text('request_id').padStart(20, '0');
  return id(a) > id(b);
}

/** The latest notice of each procurement, in the order the procurements were first met. */
function latestOfEach(notices: Outline[]): Outline[] {
  const latest = new Map<string, Outline>();
  for (const notice of notices) {
    const key = procurementOf(notice) ?? `notice ${readId(notice)}`;
    const held = latest.get(key);
    if (!held || isLater(notice, held)) latest.set(key, notice);
  }
  return [...latest.values()];
}

/** How the City titles a notice that calls a solicitation off. */
const CALLED_OFF_RE = /^\W*(?:bid\s+)?(?:cancell?ation|cancell?ed|withdrawal|withdrawn|rescinded)\b/i;
const SOLICITATION_WORDS = 'request for proposals?|rfp|rfq|rfi|rfei|solicitation|procurement';
const ENDED_WORDS = 'closed|cancell?ed|withdrawn|rescinded';
/** "This Request for Proposals is now closed", and the like. */
const SHUT_RE = new RegExp(
  `\\b(?:${SOLICITATION_WORDS})\\b[^.!?]{0,80}\\b(?:is|are|was|has been)\\s+(?:now\\s+)?(?:${ENDED_WORDS})\\b`,
  'i',
);
/** "The Agency is no longer accepting proposals", and the like. */
const REFUSING_RE = /\bno longer\s+(?:be\s+)?accept(?:ing|ed)\b/i;
const CONDITION_RE = /\b(?:late|after|paper|hard[\s-]?cop(?:y|ies)|mail(?:ed)?|fax(?:ed)?|incomplete|unless)\b/i;

/**
 * The sentence, if any, in which a notice says its solicitation is over.
 * Deliberately narrow: "late proposals will no longer be accepted" is an
 * ordinary deadline rule; "the Agency is no longer accepting proposals" is not.
 */
function closedWording(text: string): string {
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if ((SHUT_RE.test(sentence) || REFUSING_RE.test(sentence)) && !CONDITION_RE.test(sentence)) return sentence;
  }
  return '';
}

const describe = (notice: Notice): string =>
  [
    notice.text('additional_description_1'),
    notice.text('additional_description_2'),
    notice.text('additional_description_3'),
  ]
    .filter(Boolean)
    .join(' ');

function toOpportunity(notice: Notice, now: number): Opportunity {
  const id = readId(notice);
  const title = plain(notice.text('short_title'), TITLE_LENGTH);
  if (!title) throw unavailable(SOURCE_NAME, UNEXPECTED_FORM);
  // A row of any other kind means the City ran a different query from the one sent.
  if (notice.text('section_name') !== SECTION || notice.text('type_of_notice_description') !== NOTICE_TYPE) {
    throw unavailable(SOURCE_NAME, 'it returned notices that were not asked for.');
  }

  const due = notice.time('due_date');
  const text = stripHtml(describe(notice));
  const labels = [notice.text('category_description'), notice.text('selection_method_description')]
    .map((label) => plain(label, 120))
    .filter(Boolean)
    .map((label) => `${label}.`);
  const status = evaluateStatus({
    sourceState: 'open',
    // A date that is not a real one is passed on as written, so that it is
    // reported as unreadable rather than as missing.
    closeDate: due ? (due.date ?? due.written) : null,
    ongoing: false,
    hasOfficialUrl: true,
    contradiction: CALLED_OFF_RE.test(title) ? title : closedWording(text),
    detailChecked: null,
    fetchedAt: now,
    now,
    timeZone: TIME_ZONE,
  });

  return {
    id: opportunityId(SOURCE_ID, id),
    sourceId: SOURCE_ID,
    sourceName: SOURCE_NAME,
    funder: plain(notice.text('agency_name'), 200),
    kind: 'contract_solicitation',
    level: 'city',
    country: 'US',
    region: 'NY',
    jurisdiction: 'New York City',
    geographyNote: '',
    title,
    // The City's category is a kind of purchase, not a funding category, so it
    // is given as context here and never as one of the app's categories.
    summary: clampText([...labels, text].filter(Boolean).join(' '), SUMMARY_LENGTH),
    number: plain(notice.text('pin'), 120),
    applicantTypes: [],
    applicantNote: '',
    categories: [],
    awardFloor: null,
    awardCeiling: null,
    totalFunding: parseAmount(notice.text('contract_amount')),
    currency: 'USD',
    openDate: notice.time('start_date')?.date ?? null,
    closeDate: due?.date ?? null,
    closeDateText: due ? dateWording(due) : '',
    ...status,
    sourceStatus: NOTICE_TYPE,
    officialUrl: officialUrl(id),
    fetchedAt: now,
    match: null,
  };
}

/** Plain text that keeps the paragraphs of the City's description. */
function paragraphs(html: string, max: number): string {
  const blocks = html
    .replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .split(/<\/(?:p|div|li|tr|h[1-6])\s*>|<br\s*\/?>/i)
    .map(stripHtml)
    .filter(Boolean);
  return clampText(blocks.join('\n\n'), max);
}

/**
 * The documents the City attaches to a notice. It packs their addresses into
 * one value, separated by commas and with "&" written as an entity. Only
 * addresses on the City's own sites are kept.
 */
function documentLinks(value: string): string[] {
  const links: string[] = [];
  for (const written of value.split(/,(?=https?:\/\/)/i).slice(0, MAX_DOCUMENTS)) {
    try {
      const url = new URL(decodeEntities(written.trim()));
      const official = url.protocol === 'https:' && /(?:^|\.)nyc\.gov$/.test(url.hostname);
      if (official && !url.username && !url.password && !links.includes(url.href)) links.push(url.href);
    } catch {
      // Not an address: leave it out.
    }
  }
  return links;
}

function factsOf(notice: Notice): OpportunityDetail['facts'] {
  const facts: OpportunityDetail['facts'] = [];
  const fact = (label: string, value: string) => {
    if (value) facts.push({ label, value: clampText(value, FACT_LENGTH) });
  };
  const text = (column: keyof typeof COLUMNS) => plain(notice.text(column), FACT_LENGTH);

  fact('Category at the source', text('category_description'));
  fact('Selection method', text('selection_method_description'));
  fact('Special case', text('special_case_reason_description'));
  const first = notice.time('start_date');
  const last = notice.time('end_date');
  if (first) fact('First published in the City Record', dateWording(first));
  if (last && last.written !== first?.written) fact('Last published in the City Record', dateWording(last));
  fact('Contract amount stated in the notice', text('contract_amount'));
  fact('Where to request the solicitation', text('address_to_request'));
  fact('Contact', text('contact_name'));
  const email = text('email');
  fact(/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ? 'Contact email' : 'Contact details', email);
  // "(000) 000-0000" is what the City stores when no number was given.
  const phone = text('contact_phone');
  if (/[1-9]/.test(phone) && phone.replace(/\D/g, '').length >= 7) fact('Contact phone', phone);
  fact(
    'Other information',
    [text('other_info_1'), text('other_info_2'), text('other_info_3')].filter(Boolean).join(' '),
  );
  return facts;
}

export const nycCityRecordAdapter: SourceAdapter = {
  info: {
    id: SOURCE_ID,
    name: SOURCE_NAME,
    operator: 'New York City Department of Citywide Administrative Services',
    level: 'city',
    jurisdiction: 'New York City',
    coverage: { country: 'US', region: 'NY', county: '', city: 'New York' },
    kinds: ['contract_solicitation'],
    homepageUrl: 'https://a856-cityrecord.nyc.gov/',
    attribution: 'NYC Open Data, Department of Citywide Administrative Services. Public domain.',
    note:
      'The City Record applies no search filter itself; every filter is applied on this device. ' +
      'It lists requests for proposals and bids, not grants, and only in the three categories the City uses for services; ' +
      'goods and construction are left out. ' +
      'Only the latest notice for each procurement is shown, ' +
      'and past solicitations are limited to the 200 that fell due most recently. ' +
      'The City does not record who may respond, so read the notice for that.',
  },

  async search(filters, context) {
    if (filters.kinds.length > 0 && !filters.kinds.includes('contract_solicitation')) return [];
    const today = todayIn(TIME_ZONE, context.now);
    const expiredWanted = filters.statuses.length === 0 || filters.statuses.includes('expired');

    const open: Notice[] = await readEveryRow(
      {
        resource: RESOURCE,
        columns: COLUMNS,
        where: `${IN_SCOPE} AND due_date >= '${today}T00:00:00'`,
        order: 'due_date ASC, request_id ASC',
        limit: OPEN_ROWS,
      },
      SOURCE_NAME,
      context,
    );
    // Recent past notices are always read, in outline when expired listings
    // are not wanted: one of them may be the latest word on a procurement that
    // an earlier notice still shows as open.
    const past = {
      resource: RESOURCE,
      where: `${IN_SCOPE} AND due_date < '${today}T00:00:00'`,
      order: 'due_date DESC, request_id DESC',
      limit: PAST_ROWS,
    };
    const closed: Notice[] = expiredWanted
      ? await readRows({ ...past, columns: COLUMNS }, SOURCE_NAME, context)
      : [];
    const outlines: Outline[] = expiredWanted
      ? []
      : await readRows({ ...past, columns: OUTLINE_COLUMNS }, SOURCE_NAME, context);

    const listed = new Set<Outline>([...open, ...closed]);
    for (const notice of [...open, ...closed]) {
      if (!SERVICE_CATEGORIES.includes(notice.text('category_description'))) {
        throw unavailable(SOURCE_NAME, 'it returned notices that were not asked for.');
      }
    }
    return latestOfEach([...open, ...closed, ...outlines])
      .filter((notice): notice is Notice => listed.has(notice))
      .map((notice) => toOpportunity(notice, context.now));
  },

  async detail(recordId, context) {
    if (!/^\d{6,14}$/.test(recordId)) {
      throw new FundingError('INVALID_INPUT', 'That listing reference is not valid.');
    }
    const [notice] = await readRows(
      {
        resource: RESOURCE,
        columns: COLUMNS,
        where: `${SOLICITATIONS} AND request_id=${recordId}`,
        order: 'request_id ASC',
        limit: 2,
      },
      SOURCE_NAME,
      context,
    );
    if (!notice) {
      throw new FundingError(
        'NOT_FOUND',
        `${SOURCE_NAME} has no solicitation with that reference. It may have been withdrawn.`,
      );
    }
    if (readId(notice) !== recordId) {
      throw unavailable(SOURCE_NAME, 'it returned a different listing from the one asked for.');
    }
    const opportunity = toOpportunity(notice, context.now);
    const facts = factsOf(notice);
    const links: OpportunityDetail['links'] = [
      { label: 'Notice in the City Record Online', url: officialUrl(recordId) },
    ];

    // The City notices a procurement again when it changes, so this notice may
    // no longer be its latest word.
    if (procurementOf(notice)) {
      const agency = literal(notice.text('agency_name'));
      const [latest] = await readRows(
        {
          resource: RESOURCE,
          columns: OUTLINE_COLUMNS,
          where: `${SOLICITATIONS} AND agency_name=${agency} AND pin=${literal(notice.text('pin'))}`,
          order: 'start_date DESC, request_id DESC',
          limit: 1,
        },
        SOURCE_NAME,
        context,
      );
      if (latest && isLater(latest, notice)) {
        const published = latest.time('start_date');
        const due = latest.time('due_date');
        facts.unshift({
          label: 'Later notice for this procurement',
          value: clampText(
            [
              plain(latest.text('short_title'), 200),
              published ? `published ${dateWording(published)}` : '',
              due ? `due ${dateWording(due)}` : '',
            ]
              .filter(Boolean)
              .join(', '),
            FACT_LENGTH,
          ),
        });
        links.push({ label: 'Latest notice for this procurement', url: officialUrl(readId(latest)) });
      }
    }

    const documents = documentLinks(notice.link('document_links'));
    documents.forEach((url, at) => {
      links.push({
        label: documents.length > 1 ? `Document attached to the notice (${at + 1})` : 'Document attached to the notice',
        url,
      });
    });
    links.push({ label: "PASSPort, the City's procurement portal", url: PASSPORT_URL });

    return {
      opportunity,
      description: paragraphs(describe(notice), DESCRIPTION_LENGTH),
      facts,
      links,
    };
  },
};
