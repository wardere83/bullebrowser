// How one funding listing is put into words. Everything here follows one rule:
// say what the official source said, say when the source said nothing, and
// never fill a gap. A missing amount or deadline reads "Not stated"; a status
// is only ever one the listing arrived with.

import {
  APPLICANT_TYPE_LABELS,
  FUNDING_CATEGORY_LABELS,
  GEO_LEVEL_LABELS,
  OPPORTUNITY_KIND_LABELS,
  PROFILE_FIELD_LABELS,
  type Opportunity,
  type OpportunityMatch,
  type OpportunityStatus,
} from '../../../shared/funding.js';
import {
  NOT_STATED,
  formatDate,
  formatMoney,
  formatRange,
  pluralize,
} from '../../lib/funding-client.js';
import { safeExternalUrl } from '../ui/links.js';
import { STATUS_MEANINGS } from './filters.js';

// ─────────────────────────────────── status ───────────────────────────────────

export interface ShownStatus {
  status: OpportunityStatus;
  /** Always a sentence: a listing is never shown with a status and no reason. */
  reason: string;
}

/**
 * The status to show and the sentence that goes with it. A value the app does
 * not recognize is shown as unverified, never as active. A recognized status
 * that arrived without its reason gets the general meaning of that status.
 */
export function shownStatus(opportunity: Pick<Opportunity, 'status' | 'statusReason'>): ShownStatus {
  const stated: unknown = opportunity.status;
  if (stated !== 'active' && stated !== 'expired' && stated !== 'unverified') {
    return {
      status: 'unverified',
      reason: 'This listing arrived without a status BulleBrowser recognizes, so it is not confirmed.',
    };
  }
  const reason = typeof opportunity.statusReason === 'string' ? opportunity.statusReason.trim() : '';
  return { status: stated, reason: reason || STATUS_MEANINGS[stated] };
}

// ─────────────────────────────────── deadline ─────────────────────────────────

export interface DeadlineDisplay {
  /** The deadline as the source words it, or else the date the app read, or "Not stated". */
  primary: string;
  /** What the app made of the source's wording, when that adds something. */
  secondary: string;
}

/**
 * A deadline as the source gave it, with the date the app read from it. The
 * two are shown together because the app's reading is what decides the status,
 * and a person should be able to see when it differs from the wording.
 */
export function deadlineDisplay(
  opportunity: Pick<Opportunity, 'closeDate' | 'closeDateText'>,
): DeadlineDisplay {
  const worded = (opportunity.closeDateText ?? '').replace(/\s+/g, ' ').trim();
  const read = formatDate(opportunity.closeDate);
  const hasDate = read !== NOT_STATED;
  if (worded && hasDate) {
    return { primary: worded, secondary: worded === read ? '' : `Read as ${read}` };
  }
  if (worded) {
    return { primary: worded, secondary: 'BulleBrowser could not read a date from this wording.' };
  }
  return { primary: hasDate ? read : NOT_STATED, secondary: '' };
}

// ──────────────────────────────────── amounts ─────────────────────────────────

export interface AwardDisplay {
  /** The range for one award, in the listing's own currency, or "Not stated". */
  range: string;
  /** Everything there is to award, when the source states it; empty otherwise. */
  total: string;
}

export function awardDisplay(
  opportunity: Pick<Opportunity, 'awardFloor' | 'awardCeiling' | 'totalFunding' | 'currency'>,
): AwardDisplay {
  const currency = opportunity.currency ?? '';
  const total = opportunity.totalFunding;
  return {
    range: formatRange(opportunity.awardFloor, opportunity.awardCeiling, currency),
    total:
      typeof total === 'number' && Number.isFinite(total) ? formatMoney(total, currency) : '',
  };
}

// ─────────────────────────────── who and what for ──────────────────────────────

const labelled = <T extends string>(values: readonly T[] | undefined, labels: Record<T, string>) =>
  [...new Set(values ?? [])].map((value) => labels[value] ?? value);

export interface ApplicantDisplay {
  /** The coded applicant types, as labels, joined; "Not stated" when the source codes none and adds no note. */
  types: string;
  /** The source's own eligibility wording, when it adds to the coded types. */
  note: string;
}

export function applicantDisplay(
  opportunity: Pick<Opportunity, 'applicantTypes' | 'applicantNote'>,
): ApplicantDisplay {
  const labels = labelled(opportunity.applicantTypes, APPLICANT_TYPE_LABELS);
  const note = (opportunity.applicantNote ?? '').replace(/\s+/g, ' ').trim();
  if (labels.length === 0) return { types: note ? '' : NOT_STATED, note };
  return { types: labels.join(', '), note };
}

export function categoryDisplay(opportunity: Pick<Opportunity, 'categories'>): string {
  const labels = labelled(opportunity.categories, FUNDING_CATEGORY_LABELS);
  return labels.length > 0 ? labels.join(', ') : NOT_STATED;
}

export function kindLabel(opportunity: Pick<Opportunity, 'kind'>): string {
  return OPPORTUNITY_KIND_LABELS[opportunity.kind] ?? String(opportunity.kind);
}

// ──────────────────────────────────── level ───────────────────────────────────

export interface LevelDisplay {
  /** The funder's tier in its own country, with where it has jurisdiction. */
  label: string;
  /** Geographic limits the source states, when it states any. */
  geographyNote: string;
  /**
   * True when the funder is in another country than the organization, or
   * belongs to no single country: the listing then counts as international
   * for this organization when filtering, whatever its own tier.
   */
  countsAsInternational: boolean;
}

export function levelDisplay(
  opportunity: Pick<Opportunity, 'level' | 'country' | 'jurisdiction' | 'geographyNote'>,
  organizationCountry: string,
): LevelDisplay {
  const fold = (value: string | undefined) => (value ?? '').trim().toLowerCase();
  const theirs = fold(opportunity.country);
  const ours = fold(organizationCountry);
  const abroad = !theirs || (ours !== '' && ours !== theirs);
  const tier = GEO_LEVEL_LABELS[opportunity.level] ?? String(opportunity.level);
  const jurisdiction = (opportunity.jurisdiction ?? '').trim();
  return {
    label: jurisdiction ? `${tier}, ${jurisdiction}` : tier,
    geographyNote: (opportunity.geographyNote ?? '').replace(/\s+/g, ' ').trim(),
    countsAsInternational: abroad && opportunity.level !== 'international',
  };
}

// ─────────────────────────────────── the match ────────────────────────────────

export interface MatchDisplay {
  headline: string;
  terms: string[];
  /** The parts of the approved profile the shared terms came from. */
  fields: string;
}

/** What is said beside every match: it is arithmetic on words, and nothing more. */
export const MATCH_NOTE =
  'This is a count of shared words, worked out on this device. It is not a prediction of an award.';

export function matchDisplay(match: OpportunityMatch | null | undefined): MatchDisplay | null {
  if (!match) return null;
  const terms = [...new Set((match.sharedTerms ?? []).map((term) => term.trim()).filter(Boolean))];
  const fields = labelled(match.fields, PROFILE_FIELD_LABELS);
  return {
    headline:
      terms.length === 0
        ? 'Shares no terms with your approved profile'
        : `Shares ${pluralize(terms.length, 'term')} with your approved profile`,
    terms,
    fields: fields.join(', '),
  };
}

// ─────────────────────────────────── the text ─────────────────────────────────

export interface ShortText {
  text: string;
  /** True when the source's text is longer than what is shown. */
  shortened: boolean;
}

/** The start of a source's text, cut at a word, for a card. The full text is in the details. */
export function shortText(source: string | null | undefined, max = 280): ShortText {
  const text = (source ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return { text, shortened: false };
  const cut = text.slice(0, max);
  const atWord = cut.lastIndexOf(' ');
  const kept = (atWord > max * 0.6 ? cut.slice(0, atWord) : cut).replace(/[\s,;:.]+$/u, '');
  return { text: `${kept}…`, shortened: true };
}

// ─────────────────────────────────── the link ─────────────────────────────────

export interface OfficialLink {
  /** Null when the listing has no address the app will open. */
  href: string | null;
  label: string;
}

export function officialLink(
  opportunity: Pick<Opportunity, 'officialUrl' | 'sourceName'>,
): OfficialLink {
  const source = (opportunity.sourceName ?? '').trim();
  return {
    href: safeExternalUrl(opportunity.officialUrl),
    label: source ? `View on ${source}` : 'View the official listing',
  };
}
