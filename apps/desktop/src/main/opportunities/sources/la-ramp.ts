// RAMP, the Regional Alliance Marketplace for Procurement: the open bid
// opportunities of City of Los Angeles departments, published hourly on the
// City's open-data portal. Everything below was established by calling it on
// 6 October 2026.
//
// These are requests for proposals and bids, not grants.
//
//   - The dataset holds open items only. A row disappears when its
//     solicitation closes, so there is nothing expired to read, and a listing
//     that can no longer be found has closed or been withdrawn.
//   - Los Angeles County and regional agencies (the school district, the
//     ports, Metro) post here too. The posting agency is the funder of each
//     row, and a row posted by the County is a county listing.
//   - There is no description. The title, the category and the solicitation
//     type are all the source says, so the summary is built from those.
//   - Times are stored in UTC and shown here in Los Angeles time.
//   - A cancelled solicitation can stay in the data marked "Open" with the
//     word in its title. Standing qualification lists close years ahead, and a
//     practice listing closes in 2037; the status rule labels what it must.

import type { GeoLevel, Opportunity, OpportunityDetail } from '../../../shared/funding.js';
import { FundingError } from '../../funding/errors.js';
import { clampText, stripHtml } from '../normalize.js';
import { evaluateStatus } from '../status.js';
import { opportunityId, type SourceAdapter } from '../types.js';
import {
  dateWording,
  fromUtc,
  literal,
  readEveryRow,
  readRows,
  unavailable,
  UNEXPECTED_FORM,
  type ColumnKind,
  type SocrataRow,
} from './socrata.js';

const SOURCE_ID = 'la-ramp';
const SOURCE_NAME = 'RAMP Los Angeles';
const RESOURCE = 'https://data.lacity.org/resource/hf3r-utnq.json';
/** The dataset's column descriptions say UTC; listings are dated in the City's own zone. */
const TIME_ZONE = 'America/Los_Angeles';
const COUNTY = 'Los Angeles County';
const MAX_ROWS = 5000;

const COLUMNS = {
  rampid: 'text',
  title: 'text',
  stagename: 'text',
  category: 'text',
  type: 'text',
  bidpost: 'time',
  closedate: 'time',
  department: 'text',
  url: 'link',
} as const satisfies Record<string, ColumnKind>;

type Row = SocrataRow<keyof typeof COLUMNS>;

/** The stages the source uses for a solicitation that is accepting responses. */
const OPEN_STAGES = new Set(['open', 'amended']);
const CALLED_OFF_RE = /^\W*(?:cancell?ed|withdrawn|rescinded|postponed|closed)\b/i;

const plain = (value: string, max: number): string => clampText(stripHtml(value), max);
/** The source writes "None" where it has no category or type. */
const stated = (value: string): string => (/^none$/i.test(value.trim()) ? '' : plain(value, 120));

/** The listing's own page, only when it is on the marketplace's site. */
function listingUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    const official = url.protocol === 'https:' && /(?:^|\.)rampla\.org$/.test(url.hostname);
    return official && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

function toOpportunity(row: Row, now: number): Opportunity {
  const id = row.text('rampid');
  const title = plain(row.text('title'), 300);
  if (!/^\d{1,12}$/.test(id) || !title) throw unavailable(SOURCE_NAME, UNEXPECTED_FORM);

  const funder = plain(row.text('department'), 200);
  const tier: { level: GeoLevel; jurisdiction: string } =
    funder === COUNTY ? { level: 'county', jurisdiction: COUNTY } : { level: 'city', jurisdiction: 'Los Angeles' };
  const stage = plain(row.text('stagename'), 60);
  const posted = row.time('bidpost');
  const closes = row.time('closedate');
  const closesLocally = closes ? fromUtc(closes, TIME_ZONE) : null;
  const url = listingUrl(row.link('url'));
  const category = stated(row.text('category'));
  const type = stated(row.text('type'));

  const status = evaluateStatus({
    sourceState: OPEN_STAGES.has(stage.toLowerCase()) ? 'open' : 'unknown',
    closeDate: closesLocally ? (closesLocally.date ?? closesLocally.written) : null,
    ongoing: false,
    hasOfficialUrl: url !== '',
    contradiction: CALLED_OFF_RE.test(title) ? title : '',
    detailChecked: null,
    fetchedAt: now,
    now,
    timeZone: TIME_ZONE,
  });

  return {
    id: opportunityId(SOURCE_ID, id),
    sourceId: SOURCE_ID,
    sourceName: SOURCE_NAME,
    funder,
    kind: 'contract_solicitation',
    ...tier,
    country: 'US',
    region: 'CA',
    geographyNote: '',
    title,
    summary: [category ? `Category: ${category}.` : '', type ? `Solicitation type: ${type}.` : '']
      .filter(Boolean)
      .join(' '),
    number: id,
    applicantTypes: [],
    applicantNote: '',
    categories: [],
    awardFloor: null,
    awardCeiling: null,
    totalFunding: null,
    currency: 'USD',
    openDate: posted ? fromUtc(posted, TIME_ZONE).date : null,
    closeDate: closesLocally?.date ?? null,
    closeDateText: closesLocally ? `${dateWording(closesLocally)}, Los Angeles time` : '',
    ...status,
    sourceStatus: stage,
    officialUrl: url,
    fetchedAt: now,
    match: null,
  };
}

function factsOf(row: Row): OpportunityDetail['facts'] {
  const facts: OpportunityDetail['facts'] = [];
  const fact = (label: string, value: string) => {
    if (value) facts.push({ label, value });
  };
  fact('Posting agency', plain(row.text('department'), 200));
  fact('Category at the source', stated(row.text('category')));
  fact('Solicitation type', stated(row.text('type')));
  fact('Stage at the source', plain(row.text('stagename'), 60));
  const posted = row.time('bidpost');
  if (posted) fact('Posted', `${dateWording(fromUtc(posted, TIME_ZONE))}, Los Angeles time`);
  fact('RAMP ID', row.text('rampid'));
  return facts;
}

export const laRampAdapter: SourceAdapter = {
  info: {
    id: SOURCE_ID,
    name: SOURCE_NAME,
    operator: 'City of Los Angeles',
    level: 'city',
    jurisdiction: 'Los Angeles',
    coverage: { country: 'US', region: 'CA', county: '', city: 'Los Angeles' },
    kinds: ['contract_solicitation'],
    homepageUrl: 'https://www.rampla.org/s/',
    attribution: 'City of Los Angeles open data. Creative Commons CC0 1.0 (public domain dedication).',
    note:
      'RAMP applies no search filter itself; every filter is applied on this device. ' +
      'It lists requests for proposals and bids, not grants, and only while they are open, so it has no expired listings. ' +
      'Los Angeles County and regional agencies post here as well; the agency that posted a listing is shown as its funder. ' +
      'The source gives a title, a category and a type but no description.',
  },

  async search(filters, context) {
    if (filters.kinds.length > 0 && !filters.kinds.includes('contract_solicitation')) return [];
    const rows = await readEveryRow(
      { resource: RESOURCE, columns: COLUMNS, order: 'closedate ASC, rampid ASC', limit: MAX_ROWS },
      SOURCE_NAME,
      context,
    );
    return rows.map((row) => toOpportunity(row, context.now));
  },

  async detail(recordId, context) {
    if (!/^\d{1,12}$/.test(recordId)) {
      throw new FundingError('INVALID_INPUT', 'That listing reference is not valid.');
    }
    const [row] = await readRows(
      {
        resource: RESOURCE,
        columns: COLUMNS,
        where: `rampid=${literal(recordId)}`,
        order: 'rampid ASC',
        limit: 2,
      },
      SOURCE_NAME,
      context,
    );
    if (!row) {
      throw new FundingError(
        'NOT_FOUND',
        `${SOURCE_NAME} no longer lists this. It removes a solicitation when it closes or is withdrawn.`,
      );
    }
    if (row.text('rampid') !== recordId) {
      throw unavailable(SOURCE_NAME, 'it returned a different listing from the one asked for.');
    }
    const opportunity = toOpportunity(row, context.now);
    return {
      opportunity,
      description: '',
      facts: factsOf(row),
      links: opportunity.officialUrl ? [{ label: 'Listing on RAMP', url: opportunity.officialUrl }] : [],
    };
  },
};
