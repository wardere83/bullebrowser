import { describe, expect, it } from 'vitest';
import { clampText, dateOfInstant, decodeEntities, parseAmount, parseDate, queryTerms, stripHtml } from './normalize.js';

describe('stripHtml', () => {
  it('returns plain text and never markup, scripts or styles', () => {
    const html =
      '<p>Funding for <b>community</b>&nbsp;programs &amp; training.</p><script>alert(1)</script><style>p{}</style><!-- note --><ul><li>One</li><li>Two</li></ul>';
    expect(stripHtml(html)).toBe('Funding for community programs & training. One Two');
  });

  it('decodes doubly escaped entities and removes tags they reveal', () => {
    expect(stripHtml('Tom &amp;amp; Jerry &amp;lt;b&amp;gt;bold&amp;lt;/b&amp;gt; &#8211; &#x2014;')).toBe('Tom & Jerry bold – —');
  });

  it('drops control and invisible characters', () => {
    const hidden = [0x0000, 0x200b, 0x202e, 0x2028].map((code) => String.fromCodePoint(code));
    expect(stripHtml(`a${hidden[0]}b${hidden[1]}c${hidden[2]}d${hidden[3]}e&#1;f`)).toBe('a b c d e f');
    expect(decodeEntities('&unknown; &#99999999; &#0;')).toBe('&unknown; &#99999999; &#0;');
  });
});

describe('clampText', () => {
  it('cuts at a word boundary and marks the cut', () => {
    expect(clampText('short', 20)).toBe('short');
    expect(clampText('The program invests in neighborhood organizations', 30)).toBe('The program invests in…');
  });
});

describe('parseAmount', () => {
  it.each([
    ['$1,250,000.00', 1250000],
    ['250000', 250000],
    ['75,000 USD', 75000],
    ['$4.5 million', 4500000],
    ['150K', 150000],
    [1912400, 1912400],
  ])('reads %s', (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  it.each(['', 'none', 'N/A', '0', '$0', '$1.00', 1, 0, -5, '$0 - $0', 'up to $150,000 per year', '12 awards', null, undefined, NaN])(
    'treats %s as not stated',
    (input) => {
      expect(parseAmount(input)).toBeNull();
    },
  );
});

describe('parseDate', () => {
  it.each([
    ['2026-11-14', '2026-11-14'],
    ['2026-11-14T17:00:00-05:00', '2026-11-14'],
    ['2026-11-14 23:59:00', '2026-11-14'],
    ['20261114', '2026-11-14'],
    ['11/14/2026', '2026-11-14'],
    ['1/5/2027 5:00 PM', '2027-01-05'],
    ['Nov 14, 2026', '2026-11-14'],
    ['November 14, 2026 05:00:00 PM EST', '2026-11-14'],
    ['Saturday, November 14th, 2026', '2026-11-14'],
    ['14 November 2026', '2026-11-14'],
    ['Sept. 3, 2027', '2027-09-03'],
  ])('reads %s', (input, expected) => {
    expect(parseDate(input)).toBe(expected);
  });

  it('reads day-first numeric dates when told to', () => {
    expect(parseDate('05/03/2027', 'dmy')).toBe('2027-03-05');
    expect(parseDate('05/03/2027')).toBe('2027-05-03');
  });

  it.each(['', 'rolling', 'TBD', '13/45/2026', '2026-02-30', 'Smarch 3, 2027', '11/14/26', 42, null])(
    'does not guess at %s',
    (input) => {
      expect(parseDate(input)).toBeNull();
    },
  );
});

describe('dateOfInstant', () => {
  it('gives the calendar date in the source zone', () => {
    const instant = Date.UTC(2026, 10, 15, 3, 0, 0); // 03:00 UTC on 15 Nov
    expect(dateOfInstant(instant, 'America/New_York')).toBe('2026-11-14');
    expect(dateOfInstant('2026-11-15T03:00:00Z', 'Europe/Brussels')).toBe('2026-11-15');
    expect(dateOfInstant('2026-11-15T03:00:00+0000', 'America/Los_Angeles')).toBe('2026-11-14');
  });

  it('refuses values that are not instants', () => {
    for (const bad of ['2026-11-15', '2026-11-15T03:00:00', 'soon', 0, -1, null, {}]) {
      expect(dateOfInstant(bad, 'UTC')).toBeNull();
    }
  });
});

describe('queryTerms', () => {
  it('splits a search entry into comparable words', () => {
    expect(queryTerms('  Workforce-training, “Adult ESL” & a 2027 plan ')).toEqual(['workforce', 'training', 'adult', 'esl', '2027', 'plan']);
  });
});
