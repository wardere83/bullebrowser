import { describe, expect, it } from 'vitest';
import { canonicalNumber, significantTerms, tokenize } from './text.js';

/** The single term a word becomes, or '' when it is dropped. */
const term = (word: string) => tokenize(word).join(' ');

describe('tokenize: words', () => {
  it('lower-cases, drops function words and keeps reading order', () => {
    expect(tokenize('Our Mission is to STRENGTHEN the economic mobility of working families')).toEqual([
      'mission',
      'strengthen',
      'economic',
      'mobility',
      'work',
      'family',
    ]);
  });

  it('returns nothing for empty, punctuation-only or function-word-only text', () => {
    for (const text of ['', '   ', '— … !!! ()', 'the of and to', "we're not what you would be", 'A I']) {
      expect(tokenize(text)).toEqual([]);
    }
  });

  it('sees through ligatures, full-width letters, soft hyphens and zero-width characters', () => {
    expect(tokenize('eco\u00ADnomic \uFB01nancial \uFF21\uFF35\uFF24\uFF29\uFF34 work\u200Bforce \u202Ebudget\u202C')).toEqual([
      'economic',
      'financial',
      'audit',
      'workforce',
      'budget',
    ]);
  });

  it('reads a word split by a hyphen at the end of a line as one word', () => {
    const softHyphen = String.fromCodePoint(0xad);
    expect(tokenize(`working fam-\nilies, eco${softHyphen}\nnomic mobility and pre- vention`)).toEqual([
      'work',
      'family',
      'economic',
      'mobility',
      'prevention',
    ]);
    // A hyphen before a capital, or with no break after it, is left alone.
    expect(tokenize('Tri- County small-business coaching')).toEqual(['tri', 'county', 'small', 'business', 'coach']);
  });

  it('splits on punctuation and keeps the word before a possessive', () => {
    expect(tokenize("Newark's East Ward; small-business coaching/bookkeeping")).toEqual([
      'newark',
      'east',
      'ward',
      'small',
      'business',
      'coach',
      'bookkeep',
    ]);
    expect(tokenize('Newark’s children’s programs')).toEqual(['newark', 'child', 'program']);
    // A contraction is a function word; a name with an apostrophe is not.
    expect(tokenize("They don't and won't, but O'Brien will")).toEqual(['brien']);
  });

  it('drops terms shorter than two characters, single digits included', () => {
    expect(tokenize('a b c 5 x 7 section 3 of 12')).toEqual(['section', '12']);
  });

  it('leaves other scripts as written', () => {
    expect(tokenize('Programas bilingües en español y português')).toEqual([
      'programa',
      'bilingües',
      'en',
      'español',
      'português',
    ]);
    expect(tokenize('Финансирование программ')).toEqual(['финансирование', 'программ']);
  });

  it('treats words that name built-in properties as ordinary words', () => {
    expect(tokenize('constructor prototype valueOf hasOwnProperty __proto__')).toEqual([
      'constructor',
      'prototype',
      'valueof',
      'hasownproperty',
      'proto',
    ]);
  });

  it('gives the same terms every time', () => {
    const text = 'Sixty-eight percent of graduates were employed within six months; 312 adults completed a certificate.';
    expect(tokenize(text)).toEqual(tokenize(text));
    expect(tokenize(text)).toEqual(['sixty', 'eight', 'percent', 'graduate', 'employ', 'six', 'month', '312', 'adult', 'complete', 'certificate']);
  });
});

describe('tokenize: numbers', () => {
  it('keeps a number’s value however it is formatted', () => {
    expect(tokenize('1,912,400')).toEqual(['1912400']);
    expect(tokenize('$1,912,400.00')).toEqual(['1912400']);
    expect(tokenize('$4.10')).toEqual(['4.10']);
    expect(tokenize('68%')).toEqual(['68']);
    expect(tokenize('USD 250,000; €75,000.50')).toEqual(['usd', '250000', '75000.50']);
  });

  it('never lets a decimal point or a comma change which number it is', () => {
    expect(tokenize('1.5')).not.toEqual(tokenize('15'));
    expect(tokenize('1,250')).not.toEqual(tokenize('12,50'));
    // Not a grouped number: a date written without a space after the comma.
    expect(tokenize('March 3,2027')).toEqual(['march', '2027']);
    expect(tokenize('2025-2028')).toEqual(['2025', '2028']);
  });

  it('separates letters from digits and drops ordinal endings', () => {
    expect(tokenize('FY2025 budget, due on the 24th and the 31st')).toEqual(['fy', '2025', 'budget', 'due', '24', '31']);
    expect(tokenize('501(c)(3) status since 2011.')).toEqual(['501', 'status', 'since', '2011']);
  });

  it('reads a number the same way with or without leading zeros or an empty fraction', () => {
    expect(canonicalNumber('007')).toBe('7');
    expect(canonicalNumber('3.00')).toBe('3');
    expect(canonicalNumber('0.50')).toBe('0.50');
    expect(canonicalNumber('1,000,000.0')).toBe('1000000');
    expect(canonicalNumber('0')).toBe('0');
    expect(tokenize('ZIP 07105')).toEqual(tokenize('zip 7105'));
  });
});

describe('tokenize: stemming', () => {
  it.each([
    ['family', ['families']],
    ['program', ['programs']],
    ['priority', ['priorities']],
    ['business', ['businesses']],
    ['match', ['matches', 'matched', 'matching']],
    ['tax', ['taxes', 'taxed']],
    ['fund', ['funds', 'funded', 'funding']],
    ['train', ['trains', 'trained', 'training', 'trainings']],
    ['serve', ['serves', 'served', 'serving']],
    ['provide', ['provides', 'provided', 'providing']],
    ['require', ['requires', 'required', 'requiring']],
    ['plan', ['plans', 'planned', 'planning']],
    ['apply', ['applies', 'applied', 'applying']],
    ['use', ['uses', 'used', 'using']],
    ['find', ['finds', 'finding', 'findings']],
    ['evaluate', ['evaluates', 'evaluated', 'evaluating']],
    ['house', ['houses', 'housed', 'housing']],
    ['change', ['changes', 'changed', 'changing']],
    ['develop', ['develops', 'developed', 'developing']],
    ['focus', ['focuses', 'focused', 'focusing']],
    ['audit', ['audits', 'audited', 'auditing']],
    ['child', ['children']],
    ['criterion', ['criteria']],
  ])('reads every form of "%s" as one term', (base, forms) => {
    expect(term(base)).toBe(base);
    for (const form of forms) expect(term(form)).toBe(base);
  });

  it.each([
    ['news', 'new'],
    ['means', 'mean'],
    ['goods', 'good'],
    ['aids', 'aid'],
    ['evening', 'even'],
    ['united', 'unit'],
    ['pasted', 'past'],
    ['hoping', 'hopping'],
    ['filed', 'filled'],
    ['rating', 'rats'],
    ['planes', 'plans'],
    ['sites', 'sits'],
    ['cares', 'cars'],
    ['incoming', 'income'],
    ['business', 'busy'],
    ['organization', 'organ'],
    ['university', 'universe'],
    ['policy', 'police'],
    ['community', 'commune'],
    ['needed', 'needle'],
    ['wage', 'wag'],
  ])('keeps "%s" and "%s" apart', (one, other) => {
    expect(term(one)).not.toBe('');
    expect(term(one)).not.toBe(term(other));
  });

  it('never changes a word whose ending only looks like a suffix', () => {
    for (const word of ['news', 'series', 'status', 'analysis', 'basis', 'bias', 'need', 'proceed', 'hundred', 'thing', 'spring', 'morning', 'ceiling', 'texas', 'diabetes', 'watershed']) {
      expect(term(word)).toBe(word);
    }
    expect(term('proceeds')).toBe('proceed');
    expect(term('evenings')).toBe('evening');
    expect(term('hundreds')).toBe('hundred');
  });

  it('does not touch endings other than plurals, -ing and -ed', () => {
    for (const word of ['bilingually', 'learner', 'management', 'education', 'financial', 'strategic', 'eligibility']) {
      expect(term(word)).toBe(word);
    }
  });

  it('produces real words for the terms a funding profile is made of', () => {
    const text =
      'strengthens economic mobility working families adult education workforce training coaching ' +
      'bilingual learners priorities graduates employed certificates completing partnerships outcomes';
    expect(tokenize(text)).toEqual([
      'strengthen', 'economic', 'mobility', 'work', 'family', 'adult', 'education', 'workforce', 'train', 'coach',
      'bilingual', 'learner', 'priority', 'graduate', 'employ', 'certificate', 'complete', 'partnership', 'outcome',
    ]);
  });
});

describe('significantTerms', () => {
  const claims = [
    "Harbor Lantern Collective strengthens economic mobility for working families in Newark's East Ward through adult education, workforce training and small-business coaching.",
    'Expand bilingual workforce training to 500 learners a year by 2028.',
    'Our programs provide workforce training programs for families, and the organization provides services to the community.',
  ];

  it('ranks by how often a word occurs, then alphabetically', () => {
    expect(significantTerms(claims, 4)).toEqual(['training', 'workforce', 'families', 'adult']);
  });

  it('returns words as they were written, never stems', () => {
    const terms = significantTerms(claims, 40);
    expect(terms).toContain('families');
    expect(terms).toContain('coaching');
    expect(terms).not.toContain('family');
    expect(terms).not.toContain('coach');
    // The most frequent spelling wins; a tie goes to the shorter one.
    expect(significantTerms(['Housing, housing and houses', 'grant grants'], 2)).toEqual(['housing', 'grant']);
  });

  it('counts very general words for much less than distinctive ones', () => {
    const terms = significantTerms(claims, 40);
    // "programs" and "provide" occur twice; "bilingual" once.
    expect(terms.indexOf('bilingual')).toBeLessThan(terms.indexOf('programs'));
    expect(terms.indexOf('bilingual')).toBeLessThan(terms.indexOf('provide'));
    expect(terms.indexOf('coaching')).toBeLessThan(terms.indexOf('organization'));
    // Repeated often enough, a general word still ranks.
    expect(significantTerms(['program '.repeat(11), 'bilingual bilingual'], 1)).toEqual(['program']);
  });

  it('leaves out numbers, function words and two-letter terms', () => {
    const terms = significantTerms(['In FY 2028 we will reach 500 of 1,250 learners by 2028 in NJ'], 20);
    expect(terms).toEqual(['learners', 'reach']);
  });

  it('honours the limit and copes with nothing to rank', () => {
    expect(significantTerms(claims, 0)).toEqual([]);
    expect(significantTerms(claims, -3)).toEqual([]);
    expect(significantTerms(claims, Number.NaN)).toEqual([]);
    expect(significantTerms(claims, 2.9)).toHaveLength(2);
    expect(significantTerms([], 10)).toEqual([]);
    expect(significantTerms(['', 'the and of'], 10)).toEqual([]);
  });

  it('does not depend on the order the texts are given in', () => {
    expect(significantTerms([...claims].reverse(), 25)).toEqual(significantTerms(claims, 25));
  });
});
