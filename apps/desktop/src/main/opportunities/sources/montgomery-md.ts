// Montgomery County, Maryland: the county's solicitations of the last seven
// years, published daily on its open-data portal. Everything below was
// established by calling it on 6 October 2026.
//
// These are requests for proposals and bids, not grants.
//
//   - Each row has a status of Active or Closed, and that alone is not enough:
//     seven of the sixteen Active rows that day were also marked "Cancelled or
//     Indefinitely Postponed" and had no closing date. A row that says both is
//     reported as the contradiction it is, and an Active row is expired once
//     its closing date has passed.
//   - Most Closed rows carry that same mark and no closing date, and they sort
//     ahead of every dated row. Only dated ones are read, so that "the latest
//     to close" means what it says.
//   - The dataset has no link for a single solicitation. The county lists its
//     current solicitations, by the same number, on one page for formal ones
//     and one for informal ones; an Active row links to the page it belongs
//     on. A Closed row is no longer on either, so it has no link.
//   - The only eligibility the county records is whether a solicitation is
//     reserved under its Local Small Business Reserve Program.
//   - There is no description: the title, type and department are all there is.

import type { Opportunity, OpportunityDetail } from '../../../shared/funding.js';
import { FundingError } from '../../funding/errors.js';
import { clampText, stripHtml } from '../normalize.js';
import { evaluateStatus } from '../status.js';
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

const SOURCE_ID = 'montgomery-md';
const SOURCE_NAME = 'Montgomery County Solicitations';
const RESOURCE = 'https://data.montgomerycountymd.gov/resource/eeq6-nnwe.json';
const SOLICITATIONS_URL = 'https://www.montgomerycountymd.gov/office-procurement/solicitations-contracts';
/** The dataset gives dates with no zone; they are read as the county's own. */
const TIME_ZONE = 'America/New_York';

const ACTIVE_ROWS = 2000;
/** Closed solicitations go back seven years, so only the latest to close are read. */
const CLOSED_ROWS = 200;

const COLUMNS = {
  status: 'text',
  type: 'text',
  number: 'text',
  description: 'text',
  issuancedate: 'time',
  closingdate: 'time',
  cancelledpostponed: 'text',
  construction: 'text',
  lsbrpindicator: 'text',
  buyer: 'text',
  department: 'text',
  deptcontact: 'text',
  bidtab: 'link',
} as const satisfies Record<string, ColumnKind>;

type Row = SocrataRow<keyof typeof COLUMNS>;

/** The four solicitation types the county documents, in words. */
const TYPE_NAMES: Readonly<Record<string, string>> = {
  IFB: 'Invitation for Bid (IFB)',
  RFP: 'Request for Proposals (RFP)',
  REOI: 'Request for Expressions of Interest (REOI)',
  Informal: 'Informal solicitation',
};

const RESERVED_NOTE = "Reserved under the county's Local Small Business Reserve Program.";

const plain = (value: string, max: number): string => clampText(stripHtml(value), max);
const isYes = (value: string): boolean => value.trim().toUpperCase() === 'Y';
const isNumber = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,39}$/.test(value);

/** The county page that lists a current solicitation of this type. */
const listingPage = (type: string): string =>
  `${SOLICITATIONS_URL}/${type.trim().toLowerCase() === 'informal' ? 'informal-open-solicitations' : 'formal-solicitations'}`;

function toOpportunity(row: Row, now: number): Opportunity {
  const number = row.text('number').trim();
  const title = plain(row.text('description'), 300);
  if (!isNumber(number) || !title) throw unavailable(SOURCE_NAME, UNEXPECTED_FORM);

  const sourceStatus = plain(row.text('status'), 40);
  const state = sourceStatus.toLowerCase();
  const calledOff = plain(row.text('cancelledpostponed'), 160);
  const type = plain(row.text('type'), 40);
  const department = plain(row.text('department'), 200);
  const closes = row.time('closingdate');
  const reserved = isYes(row.text('lsbrpindicator'));
  const officialUrl = state === 'active' ? listingPage(type) : '';

  const status = evaluateStatus({
    sourceState: state === 'active' ? 'open' : state === 'closed' ? 'closed' : 'unknown',
    closeDate: closes ? (closes.date ?? closes.written) : null,
    ongoing: false,
    hasOfficialUrl: officialUrl !== '',
    contradiction: state === 'active' ? calledOff : '',
    detailChecked: null,
    fetchedAt: now,
    now,
    timeZone: TIME_ZONE,
  });

  const summary = [
    type ? `${TYPE_NAMES[type] ?? type}${isYes(row.text('construction')) ? ' for construction' : ''}.` : '',
    department ? `Issued by ${department}.` : '',
    reserved ? RESERVED_NOTE : '',
  ];

  return {
    id: opportunityId(SOURCE_ID, number),
    sourceId: SOURCE_ID,
    sourceName: SOURCE_NAME,
    // The county does not name a department for informal solicitations.
    funder: department || 'Montgomery County',
    kind: 'contract_solicitation',
    level: 'county',
    country: 'US',
    region: 'MD',
    jurisdiction: 'Montgomery County',
    geographyNote: '',
    title,
    summary: summary.filter(Boolean).join(' '),
    number,
    applicantTypes: reserved ? ['small_business'] : [],
    applicantNote: reserved ? RESERVED_NOTE : '',
    categories: [],
    awardFloor: null,
    awardCeiling: null,
    totalFunding: null,
    currency: 'USD',
    openDate: row.time('issuancedate')?.date ?? null,
    closeDate: closes?.date ?? null,
    closeDateText: closes ? dateWording(closes) : '',
    ...status,
    sourceStatus: calledOff ? `${sourceStatus}; ${calledOff}` : sourceStatus,
    officialUrl,
    fetchedAt: now,
    match: null,
  };
}

/** The county's bid results, only when the link is on a county site. */
function bidResults(value: string): string | null {
  try {
    const url = new URL(value.trim());
    const official = url.protocol === 'https:' && /(?:^|\.)montgomerycountymd\.gov$/.test(url.hostname);
    return official && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

/** The rows with a solicitation that appears twice kept once, as it was first read. */
function unique(rows: Row[]): Row[] {
  const byNumber = new Map<string, Row>();
  for (const row of rows) {
    const number = row.text('number').trim();
    if (!byNumber.has(number)) byNumber.set(number, row);
  }
  return [...byNumber.values()];
}

export const montgomeryMdAdapter: SourceAdapter = {
  info: {
    id: SOURCE_ID,
    name: SOURCE_NAME,
    operator: 'Montgomery County Office of Procurement',
    level: 'county',
    jurisdiction: 'Montgomery County',
    coverage: { country: 'US', region: 'MD', county: 'Montgomery County', city: '' },
    kinds: ['contract_solicitation'],
    homepageUrl: SOLICITATIONS_URL,
    attribution: '',
    note:
      'Montgomery County applies the status filter itself; every other filter is applied on this device. ' +
      'It lists requests for proposals and bids, not grants, with a title but no description. ' +
      'The county has no page for a single solicitation, ' +
      "so a current listing links to the county's list, where it can be found by its number. " +
      'Closed solicitations are limited to the 200 that closed most recently.',
  },

  async search(filters, context) {
    if (filters.kinds.length > 0 && !filters.kinds.includes('contract_solicitation')) return [];
    const { statuses } = filters;

    // An Active row can turn out active, unverified or expired, so Active rows
    // are always read. A Closed row can only be expired.
    const active = await readEveryRow(
      {
        resource: RESOURCE,
        columns: COLUMNS,
        where: `status=${literal('Active')}`,
        order: 'closingdate ASC, number ASC',
        limit: ACTIVE_ROWS,
      },
      SOURCE_NAME,
      context,
    );
    const closed =
      statuses.length === 0 || statuses.includes('expired')
        ? await readRows(
            {
              resource: RESOURCE,
              columns: COLUMNS,
              where: `status=${literal('Closed')} AND closingdate IS NOT NULL`,
              order: 'closingdate DESC, number DESC',
              limit: CLOSED_ROWS,
            },
            SOURCE_NAME,
            context,
          )
        : [];
    return unique([...active, ...closed]).map((row) => toOpportunity(row, context.now));
  },

  async detail(recordId, context) {
    if (!isNumber(recordId)) {
      throw new FundingError('INVALID_INPUT', 'That listing reference is not valid.');
    }
    const [row] = await readRows(
      {
        resource: RESOURCE,
        columns: COLUMNS,
        where: `number=${literal(recordId)}`,
        order: 'issuancedate DESC',
        limit: 2,
      },
      SOURCE_NAME,
      context,
    );
    if (!row) {
      throw new FundingError(
        'NOT_FOUND',
        `${SOURCE_NAME} has no solicitation with that number. The county keeps seven years of them.`,
      );
    }
    if (row.text('number').trim() !== recordId) {
      throw unavailable(SOURCE_NAME, 'it returned a different listing from the one asked for.');
    }
    const opportunity = toOpportunity(row, context.now);

    const facts: OpportunityDetail['facts'] = [];
    const fact = (label: string, value: string) => {
      if (value) facts.push({ label, value });
    };
    const type = plain(row.text('type'), 40);
    fact('Solicitation type', TYPE_NAMES[type] ?? type);
    fact('Issuing department', plain(row.text('department'), 200));
    fact('Status at the source', opportunity.sourceStatus);
    const issued = row.time('issuancedate');
    if (issued) fact('Issued', dateWording(issued));
    fact('Construction solicitation', isYes(row.text('construction')) ? 'Yes' : '');
    const reserve = row.text('lsbrpindicator').trim().toUpperCase();
    fact('Local Small Business Reserve Program', reserve === 'Y' ? 'Reserved' : reserve === 'N' ? 'Not reserved' : '');
    // The county writes "--" where it names no one.
    const named = (value: string) => (/\p{L}/u.test(value) ? plain(value, 120) : '');
    fact('Procurement specialist', named(row.text('buyer')));
    fact('Department contact', named(row.text('deptcontact')));

    const links: OpportunityDetail['links'] = [];
    if (opportunity.officialUrl) {
      links.push({ label: "The county's list of current solicitations", url: opportunity.officialUrl });
    }
    const results = bidResults(row.link('bidtab'));
    if (results) links.push({ label: 'Bid results', url: results });
    links.push({ label: 'Montgomery County Office of Procurement', url: SOLICITATIONS_URL });

    return { opportunity, description: '', facts, links };
  },
};
