// How much of an organization's approved profile shows up in a listing's own
// words. The score is the share of profile terms found in the listing: a term
// in the title counts in full, a term found only in the summary or the
// categories counts half.
//
// It describes shared vocabulary and nothing else. It is not a prediction of
// eligibility, fit or award, which is why it is always returned with the terms
// it rests on and the profile fields they came from, so a person can judge it.

import {
  FUNDING_CATEGORY_LABELS,
  PROFILE_FIELDS,
  type Opportunity,
  type OpportunityMatch,
  type ProfileFieldId,
} from '../../shared/funding.js';
import { queryTerms } from './normalize.js';

export interface ProfileTerm {
  /** A word or short phrase from an approved claim, e.g. "workforce training". */
  term: string;
  field: ProfileFieldId;
}

const TITLE_WEIGHT = 1;
const ELSEWHERE_WEIGHT = 0.5;
const MAX_TERMS = 200;
const MAX_TERM_LENGTH = 80;

/** Folds simple plurals so "programs" meets "program". Applied to both sides alike. */
function singular(word: string): string {
  if (word.length < 5) return word;
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (/(?:ss|x|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !/(?:ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

const words = (text: string): string[] => queryTerms(text).map(singular);

// Padded so that a term only matches whole words, never part of one.
const padded = (text: string): string => ` ${words(text).join(' ')} `;

export function scoreMatch(opportunity: Opportunity, terms: ProfileTerm[]): OpportunityMatch | null {
  // The same term may come from several fields; it is counted once.
  const wanted = new Map<string, { label: string; fields: Set<ProfileFieldId> }>();
  for (const item of Array.isArray(terms) ? terms : []) {
    if (typeof item?.term !== 'string') continue;
    const label = item.term.replace(/\s+/g, ' ').trim().slice(0, MAX_TERM_LENGTH);
    const key = words(label).join(' ');
    if (!key) continue;
    const entry = wanted.get(key) ?? { label, fields: new Set<ProfileFieldId>() };
    entry.fields.add(item.field);
    if (wanted.size < MAX_TERMS || wanted.has(key)) wanted.set(key, entry);
  }
  if (wanted.size === 0) return null;

  const title = padded(opportunity.title);
  const elsewhere = [
    opportunity.summary,
    ...opportunity.categories.map((category) => FUNDING_CATEGORY_LABELS[category] ?? ''),
  ].map(padded);

  let points = 0;
  const sharedTerms: string[] = [];
  const fields = new Set<ProfileFieldId>();
  for (const [key, entry] of wanted) {
    const needle = ` ${key} `;
    const weight = title.includes(needle)
      ? TITLE_WEIGHT
      : elsewhere.some((text) => text.includes(needle))
        ? ELSEWHERE_WEIGHT
        : 0;
    if (weight === 0) continue;
    points += weight;
    sharedTerms.push(entry.label);
    for (const field of entry.fields) fields.add(field);
  }

  return {
    score: Math.round((100 * points) / wanted.size),
    sharedTerms,
    fields: PROFILE_FIELDS.filter((field) => fields.has(field)),
  };
}
