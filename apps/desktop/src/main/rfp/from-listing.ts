// Turns an official listing into a funding document: the listing as a person
// reads it, in blocks that can be searched, cited and analyzed like an uploaded
// solicitation.
//
// Only what the source said goes in. A value the source left out reads "Not
// stated"; nothing is estimated, defaulted or filled in from anywhere else. One
// line is the app's own, the status it worked out, and it is labelled as the
// app's so that it is never taken for the funder's wording.

import {
  APPLICANT_TYPE_LABELS,
  FUNDING_CATEGORY_LABELS,
  GEO_LEVEL_LABELS,
  OPPORTUNITY_KIND_LABELS,
  OPPORTUNITY_STATUS_LABELS,
  type OpportunityDetail,
} from '../../shared/funding.js';
import { assembleDocument, cleanText, cutAtWord, type DraftBlock } from '../documents/text.js';
import type { ExtractedBlock, ExtractedDocument } from '../documents/types.js';
import { formatDate, normalizeIsoDate } from '../opportunities/status.js';

const NOT_STATED = 'Not stated';
const NAME_SUFFIX = ' (official listing)';
/** A shelf keeps 200 characters of a name. A longer title is cut so that the suffix is still there. */
const MAX_TITLE_IN_NAME = 180;
/** The label of the one line the app writes itself. */
const APP_STATUS_LABEL = 'Status in this app';

const text = (value: unknown): string => (typeof value === 'string' ? cleanText(value) : '');
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** The label for a coded value, or nothing for a code the app does not know. */
function labelOf(labels: Record<string, string>, code: unknown): string {
  return typeof code === 'string' && Object.hasOwn(labels, code) ? (labels[code] ?? '') : '';
}

/** An amount as the listing shows it. Null means the source did not give one, and it stays that way. */
function money(amount: unknown, currency: string): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return NOT_STATED;
  const figure = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(amount);
  return /^[A-Z]{3}$/.test(currency) ? `${currency} ${figure}` : figure;
}

function day(isoDate: unknown): string {
  const date = typeof isoDate === 'string' ? normalizeIsoDate(isoDate) : null;
  return date ? formatDate(date) : '';
}

function webAddress(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}

/**
 * The listing as a document. Blocks are numbered b0001, b0002 and so on in
 * reading order, and each carries the headings above it: the title, then
 * "Description", "Details from the source" and "Official links".
 */
export function listingToDocument(detail: OpportunityDetail): { name: string; document: ExtractedDocument } {
  const { opportunity } = detail;
  const drafts: DraftBlock[] = [];
  const heading = (title: string, level: number) => drafts.push({ kind: 'heading', text: title, page: null, level });
  const line = (kind: DraftBlock['kind'], content: string) => drafts.push({ kind, text: content, page: null });

  const sourceFacts = list(detail.facts)
    .map((entry) => {
      const { label, value } = (entry ?? {}) as { label?: unknown; value?: unknown };
      return { label: text(label), value: text(value) };
    })
    .filter((entry) => entry.value);
  const saidBySource = new Set(sourceFacts.map((entry) => entry.label.toLowerCase()));

  const fact = (label: string, value: string) => line('list_item', `${label}: ${value || NOT_STATED}`);
  /** A fact shown only when the source gave it, and only once: its own list of facts may already carry it. */
  const extra = (label: string, value: string) => {
    if (value && !saidBySource.has(label.toLowerCase())) fact(label, value);
  };

  const title = text(opportunity.title);
  if (title) heading(title, 1);
  else fact('Title', '');

  const currency = text(opportunity.currency);
  const applicants = list(opportunity.applicantTypes)
    .map((type) => labelOf(APPLICANT_TYPE_LABELS, type))
    .filter(Boolean);
  const applicantNote = text(opportunity.applicantNote);
  const status = labelOf(OPPORTUNITY_STATUS_LABELS, opportunity.status);

  fact('Funder', text(opportunity.funder));
  fact('Source', text(opportunity.sourceName));
  fact(APP_STATUS_LABEL, [status, text(opportunity.statusReason)].filter(Boolean).join('. '));
  fact('Deadline', text(opportunity.closeDateText) || day(opportunity.closeDate));
  fact('Smallest award', money(opportunity.awardFloor, currency));
  fact('Largest award', money(opportunity.awardCeiling, currency));
  fact('Total funding', money(opportunity.totalFunding, currency));
  fact('Who may apply', applicants.join('; ') || applicantNote);
  if (applicants.length > 0) extra('Eligibility as the source words it', applicantNote);
  fact(
    'Categories',
    list(opportunity.categories)
      .map((category) => labelOf(FUNDING_CATEGORY_LABELS, category))
      .filter(Boolean)
      .join('; '),
  );
  extra('Type', labelOf(OPPORTUNITY_KIND_LABELS, opportunity.kind));
  extra('Funding level', labelOf(GEO_LEVEL_LABELS, opportunity.level));
  extra('Reference number', text(opportunity.number));
  extra('Status at the source', text(opportunity.sourceStatus));
  extra('Opening date', day(opportunity.openDate));
  extra("Funder's jurisdiction", text(opportunity.jurisdiction));
  extra('Geographic limits', text(opportunity.geographyNote));

  heading('Description', 2);
  // The short summary stands in only when the source gave no longer description.
  const longer = typeof detail.description === 'string' ? detail.description : '';
  const description = longer.trim() ? longer : typeof opportunity.summary === 'string' ? opportunity.summary : '';
  const paragraphs = description
    .split(/\r?\n[^\S\r\n]*(?:\r?\n[^\S\r\n]*)+/)
    .map((paragraph) => cleanText(paragraph))
    .filter(Boolean);
  if (paragraphs.length === 0) paragraphs.push('The source gives no description for this listing.');
  for (const paragraph of paragraphs) line('paragraph', paragraph);

  if (sourceFacts.length > 0) {
    heading('Details from the source', 2);
    for (const entry of sourceFacts) line('list_item', entry.label ? `${entry.label}: ${entry.value}` : entry.value);
  }

  heading('Official links', 2);
  const links: { label: string; url: string }[] = [];
  const official = webAddress(opportunity.officialUrl);
  if (official) links.push({ label: 'Official listing', url: official });
  for (const entry of list(detail.links)) {
    const { label, url } = (entry ?? {}) as { label?: unknown; url?: unknown };
    const address = webAddress(url);
    if (!address) continue;
    const held = links.find((known) => known.url === address);
    // The source's own name for a link is kept in place of the app's.
    if (held) held.label = text(label) || held.label;
    else links.push({ label: text(label) || 'Link', url: address });
  }
  if (links.length === 0) line('paragraph', 'No official link is available for this listing.');
  for (const entry of links) line('list_item', `${entry.label}: ${entry.url}`);

  const shown = title.length > MAX_TITLE_IN_NAME ? `${cutAtWord(title, MAX_TITLE_IN_NAME - 1)}…` : title;
  return { name: `${shown || 'Untitled listing'}${NAME_SUFFIX}`, document: assembleDocument('txt', drafts, null, []) };
}

/**
 * True when two readings of a listing say the same thing. The app's own status
 * line is left out of the comparison: it is worked out afresh at every reading
 * and carries the time of the check, so it differs even when the source has
 * not changed a word. What the source reports about status, dates and amounts
 * is compared like everything else.
 */
export function sameListingText(earlier: ExtractedBlock[], later: ExtractedBlock[]): boolean {
  const comparable = (blocks: ExtractedBlock[]): string => {
    // The app's line comes before anything of the source's that could share its label.
    const own = blocks.findIndex((block) => block.kind === 'list_item' && block.text.startsWith(`${APP_STATUS_LABEL}: `));
    return JSON.stringify(
      blocks
        .filter((_block, index) => index !== own)
        .map((block) => [block.id, block.kind, block.text, block.page, block.section, block.headingLevel]),
    );
  };
  return comparable(earlier) === comparable(later);
}
