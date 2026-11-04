import { APPLICANT_TYPE_LABELS, type ApplicantType, type Opportunity } from './funding.js';

export interface EligibilityFacts {
  applicantType: ApplicantType | null;
  requestedAmount: number | null;
  currency: string;
}
export interface EligibilityCheck {
  criterion: string;
  status: 'compatible' | 'conflict' | 'unknown';
  reason: string;
}

/** Screening of explicit facts only. Neither keywords nor the organization's name imply legal status. */
export function screenEligibility(listing: Opportunity, facts: EligibilityFacts): EligibilityCheck[] {
  const checks: EligibilityCheck[] = [];
  const types = listing.applicantTypes;
  const labels = types.map(type => APPLICANT_TYPE_LABELS[type]).join(', ');
  if (!facts.applicantType || !types.length || types.includes('other') || facts.applicantType === 'other') {
    checks.push({ criterion: 'Applicant category', status: 'unknown', reason: 'Confirm your legal applicant category and the complete eligibility wording at the source.' });
  } else {
    const compatible = types.includes(facts.applicantType);
    checks.push({ criterion: 'Applicant category', status: compatible ? 'compatible' : 'conflict', reason: `The source lists ${labels}. ${compatible ? 'Your selected category is listed; additional legal requirements still need review.' : 'Your selected category is not listed. Verify the complete source before proceeding.'}` });
  }
  const { awardFloor: floor, awardCeiling: ceiling } = listing;
  const amount = facts.requestedAmount;
  const boundsValid = (floor === null || (Number.isFinite(floor) && floor >= 0)) &&
    (ceiling === null || (Number.isFinite(ceiling) && ceiling >= 0)) &&
    (floor === null || ceiling === null || floor <= ceiling);
  if (amount === null || !Number.isFinite(amount) || amount < 0 || !facts.currency ||
      facts.currency !== listing.currency || !boundsValid || (floor === null && ceiling === null)) {
    checks.push({ criterion: 'Requested funding', status: 'unknown', reason: 'Enter an amount in the source currency. Missing, contradictory or differently denominated limits cannot establish a match.' });
  } else if ((floor !== null && amount < floor) || (ceiling !== null && amount > ceiling)) {
    checks.push({ criterion: 'Requested funding', status: 'conflict', reason: `Your request falls outside a stated award limit (${floor ?? 'minimum not stated'}–${ceiling ?? 'maximum not stated'} ${listing.currency}).` });
  } else {
    checks.push({ criterion: 'Requested funding', status: floor === null || ceiling === null ? 'unknown' : 'compatible', reason: floor === null || ceiling === null ? 'Your request meets the stated limit, but the other limit is not stated.' : `Your request is within the stated award range (${floor}–${ceiling} ${listing.currency}).` });
  }
  checks.push({ criterion: 'Other requirements', status: 'unknown', reason: [listing.applicantNote, listing.geographyNote].filter(Boolean).join(' ') || 'Review service geography, registrations, certifications, deadlines and all other requirements in the official notice. These are not inferred from keywords or headquarters location.' });
  return checks;
}
