import { describe, expect, it } from 'vitest';
import type { Opportunity } from '../../shared/funding.js';
import { scoreMatch, type ProfileTerm } from './match.js';

const listing = (patch: Partial<Opportunity>): Opportunity =>
  ({ title: '', summary: '', categories: [], ...patch }) as Opportunity;

const term = (text: string, field: ProfileTerm['field'] = 'mission'): ProfileTerm => ({ term: text, field });

describe('scoreMatch', () => {
  it('is null when there is no profile to compare with', () => {
    const grant = listing({ title: 'Youth workforce training' });
    expect(scoreMatch(grant, [])).toBeNull();
    // Terms with nothing to look for are not terms.
    expect(scoreMatch(grant, [term(''), term('   '), term('— / —'), term('a')])).toBeNull();
    expect(scoreMatch(grant, null as unknown as ProfileTerm[])).toBeNull();
    expect(scoreMatch(grant, [null, { term: 42, field: 'mission' }] as unknown as ProfileTerm[])).toBeNull();
  });

  it('scores the share of profile terms found in the listing', () => {
    const grant = listing({ title: 'Youth Workforce Training for Returning Citizens' });
    const terms = [term('youth'), term('workforce'), term('housing'), term('seniors')];
    expect(scoreMatch(grant, terms)).toEqual({ score: 50, sharedTerms: ['youth', 'workforce'], fields: ['mission'] });
    expect(scoreMatch(grant, terms.slice(0, 2))!.score).toBe(100);
    expect(scoreMatch(grant, terms.slice(0, 3))!.score).toBe(67);
  });

  it('counts a term in the title in full and a term found only elsewhere as half', () => {
    const grant = listing({
      title: 'Neighborhood Health Grants',
      summary: 'Supports mobile clinics and nutrition education for older adults.',
    });
    expect(scoreMatch(grant, [term('health'), term('grants')])!.score).toBe(100);
    expect(scoreMatch(grant, [term('health'), term('nutrition')])!.score).toBe(75);
    expect(scoreMatch(grant, [term('clinics'), term('nutrition')])!.score).toBe(50);
    // In both places still counts once, at the title's weight.
    expect(scoreMatch(listing({ title: 'Health', summary: 'Health, health, health.' }), [term('health')])!.score).toBe(
      100,
    );
  });

  it('looks in the listing’s categories as well as its words', () => {
    const grant = listing({ title: 'Round 4 awards', categories: ['housing', 'employment_workforce'] });
    expect(scoreMatch(grant, [term('housing'), term('workforce')])).toEqual({
      score: 50,
      sharedTerms: ['housing', 'workforce'],
      fields: ['mission'],
    });
    expect(scoreMatch(grant, [term('employment and workforce')])!.score).toBe(50);
  });

  it('reports a listing that shares nothing as zero, with nothing shared', () => {
    const grant = listing({ title: 'Marine fisheries research', summary: 'Stock assessment methods.' });
    expect(scoreMatch(grant, [term('housing'), term('youth')])).toEqual({ score: 0, sharedTerms: [], fields: [] });
  });

  it('returns the shared terms as the profile words them, with the fields they came from', () => {
    const grant = listing({
      title: 'Workforce training for returning citizens',
      summary: 'Serving Essex County residents through apprenticeships.',
    });
    const match = scoreMatch(grant, [
      term('  Returning   Citizens ', 'populations_served'),
      term('Essex County', 'geographic_scope'),
      term('WORKFORCE TRAINING', 'programs'),
      term('food access', 'programs'),
      term('apprenticeships', 'strengths'),
    ])!;
    expect(match.sharedTerms).toEqual(['Returning Citizens', 'Essex County', 'WORKFORCE TRAINING', 'apprenticeships']);
    // Fields come back in the profile's own order, each once.
    expect(match.fields).toEqual(['populations_served', 'geographic_scope', 'programs', 'strengths']);
    expect(match.score).toBe(60);
  });

  it('counts a term once however many fields mention it', () => {
    const grant = listing({ title: 'Youth mentoring' });
    const match = scoreMatch(grant, [
      term('youth', 'mission'),
      term('Youth', 'populations_served'),
      term('youth!', 'programs'),
      term('seniors', 'populations_served'),
    ])!;
    expect(match).toEqual({
      score: 50,
      sharedTerms: ['youth'],
      fields: ['mission', 'populations_served', 'programs'],
    });
  });

  it('matches whole words and whole phrases, never parts of them', () => {
    const grant = listing({ title: 'Partnership grants', summary: 'Training the workforce of smart cities.' });
    expect(scoreMatch(grant, [term('art')])!.score).toBe(0);
    expect(scoreMatch(grant, [term('partner')])!.score).toBe(0);
    expect(scoreMatch(grant, [term('workforce training')])!.score).toBe(0);
    expect(scoreMatch(grant, [term('smart cities')])!.score).toBe(50);
    expect(scoreMatch(grant, [term('partnership grants')])!.score).toBe(100);
  });

  it('treats simple plurals as the same word', () => {
    const grant = listing({ title: 'Programs for rural communities and small businesses' });
    const match = scoreMatch(grant, [term('program'), term('community'), term('small business'), term('churches')])!;
    expect(match.sharedTerms).toEqual(['program', 'community', 'small business']);
    expect(match.score).toBe(75);
    // Short words and words that only look plural are left alone.
    expect(scoreMatch(listing({ title: 'Local news access' }), [term('new')])!.score).toBe(0);
    expect(scoreMatch(listing({ title: 'Campus analysis' }), [term('campu'), term('analysi')])!.score).toBe(0);
  });

  it('treats a term as text, whatever characters it holds', () => {
    const grant = listing({ title: 'Housing (affordable) + health', summary: '$50,000 awards' });
    expect(scoreMatch(grant, [term('.*'), term('(a+)+$'), term('[housing')])).toEqual({
      score: 100,
      sharedTerms: ['[housing'],
      fields: ['mission'],
    });
    expect(scoreMatch(grant, [term('affordable housing')])!.score).toBe(0);
    expect(scoreMatch(grant, [term('50,000')])!.score).toBe(50);
  });

  it('stays within 0 to 100 and bounded for an enormous profile', () => {
    const grant = listing({ title: 'word1 word2 word3', summary: 'word4 '.repeat(20000) });
    const many = Array.from({ length: 5000 }, (_, index) => term(`word${index}`));
    const match = scoreMatch(grant, many)!;
    expect(match.score).toBeGreaterThanOrEqual(0);
    expect(match.score).toBeLessThanOrEqual(100);
    // Only the first two hundred terms are compared.
    expect(match.sharedTerms).toEqual(['word1', 'word2', 'word3', 'word4']);
    expect(match.score).toBe(2);
    expect(scoreMatch(grant, [term('x'.repeat(100000))])!.score).toBe(0);
  });

  it('does not change the listing or the terms', () => {
    const grant = listing({ title: 'Youth programs', categories: ['education'] });
    const terms = [term('Youth Programs', 'programs')];
    const before = structuredClone({ grant, terms });
    scoreMatch(grant, terms);
    expect({ grant, terms }).toEqual(before);
  });
});
