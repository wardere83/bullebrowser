import { describe, expect, it } from 'vitest';
import type { Opportunity } from './funding.js';
import { screenEligibility, type EligibilityFacts } from './opportunity-eligibility.js';

const listing = (patch: Partial<Opportunity> = {}) => ({ applicantTypes: ['nonprofit'], awardFloor: 1000, awardCeiling: 5000, currency: 'USD', applicantNote: '', geographyNote: '', ...patch }) as Opportunity;
const facts: EligibilityFacts = { applicantType: 'nonprofit', requestedAmount: 2000, currency: 'USD' };
describe('eligibility screening', () => {
  it('compares confirmed facts against explicit criteria, leaving other requirements unknown', () => {
    expect(screenEligibility(listing(), facts).map(c => c.status)).toEqual(['compatible', 'compatible', 'unknown']);
  });
  it('does not turn keyword relevance into eligibility', () => {
    const checks = screenEligibility(listing({ match: { score: 100, sharedTerms: ['youth'], fields: ['mission'] } }), { ...facts, applicantType: 'for_profit', requestedAmount: 6000 });
    expect(checks.map(c => c.status)).toEqual(['conflict', 'conflict', 'unknown']);
  });
  it('does not infer an applicant category from a profile or CBO label', () => {
    expect(screenEligibility(listing(), { ...facts, applicantType: null })[0]?.status).toBe('unknown');
  });
  it.each(([[], ['other'], ['nonprofit', 'other']] as Opportunity['applicantTypes'][]).map(applicantTypes => ({ applicantTypes })))('keeps incomplete source categories unknown: $applicantTypes', ({ applicantTypes }) => {
    expect(screenEligibility(listing({ applicantTypes }), facts)[0]?.status).toBe('unknown');
  });
  it.each([1000, 5000])('accepts inclusive award bounds: %s', requestedAmount => {
    expect(screenEligibility(listing(), { ...facts, requestedAmount })[1]?.status).toBe('compatible');
  });
  it.each([999, 5001])('flags requests beyond a known award bound: %s', requestedAmount => {
    expect(screenEligibility(listing(), { ...facts, requestedAmount })[1]?.status).toBe('conflict');
  });
  it.each([null, NaN, Infinity, -1])('keeps invalid or missing amounts unknown: %s', requestedAmount => {
    expect(screenEligibility(listing(), { ...facts, requestedAmount })[1]?.status).toBe('unknown');
  });
  it('does not silently convert currencies or accept contradictory limits', () => {
    expect(screenEligibility(listing(), { ...facts, currency: 'EUR' })[1]?.status).toBe('unknown');
    expect(screenEligibility(listing({ awardFloor: 9000 }), facts)[1]?.status).toBe('unknown');
    expect(screenEligibility(listing({ awardCeiling: null }), facts)[1]?.status).toBe('unknown');
    expect(screenEligibility(listing({ awardCeiling: null }), { ...facts, requestedAmount: 500 })[1]?.status).toBe('conflict');
  });
  it('preserves source wording and never infers service geography from funder country', () => {
    const result = screenEligibility(listing({ country: 'US', applicantNote: '501(c)(3) required.', geographyNote: 'Projects must serve Newark.' }), facts);
    expect(result[2]).toEqual({ criterion: 'Other requirements', status: 'unknown', reason: '501(c)(3) required. Projects must serve Newark.' });
  });
});
