// The words an approved profile is made of, for ranking funding listings on
// the device.
//
// Only approved statements count: a listing is never ranked against wording
// nobody has confirmed. Each word keeps the profile field it came from, so a
// match can say which part of the profile it rests on.

import { PROFILE_FIELDS, type ProfileClaim } from '../../shared/funding.js';
import type { ProfileTerm } from '../opportunities/match.js';
import { significantTerms } from './text.js';

/** The most terms a profile contributes, across all of its fields. */
export const MAX_PROFILE_TERMS = 60;

/**
 * The words that best characterize each field's approved statements, each
 * tagged with its field. Fields take turns, one word at a time, so every field
 * contributes its most telling words before any field contributes lesser ones.
 */
export function profileTermsOf(claims: ProfileClaim[], limit = MAX_PROFILE_TERMS): ProfileTerm[] {
  const most = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  const approved = claims.filter((claim) => claim.status === 'approved');
  const ranked = PROFILE_FIELDS.map((field) => ({
    field,
    words: significantTerms(
      approved.filter((claim) => claim.field === field).map((claim) => claim.text),
      most,
    ),
  }));

  const terms: ProfileTerm[] = [];
  const longest = Math.max(0, ...ranked.map((entry) => entry.words.length));
  for (let rank = 0; rank < longest && terms.length < most; rank++) {
    for (const { field, words } of ranked) {
      const word = words[rank];
      if (word !== undefined && terms.length < most) terms.push({ term: word, field });
    }
  }
  return terms;
}
