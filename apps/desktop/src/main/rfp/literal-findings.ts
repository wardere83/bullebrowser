// What a funding document says in so many words: its dates, its amounts, and
// the sentences that state a requirement, a match or a rule about AI tools.
//
// No assistant is involved and nothing is interpreted. A pattern either occurs
// in a sentence or it does not; when it does, the sentence is reported exactly
// as the app stored it, with the page and section it stands on. The result is a
// reading list, not a summary: a sentence can match a pattern without meaning
// what the pattern suggests ("match participants with employers"), and deciding
// that is left to the reader.

import type { LiteralFinding } from '../../shared/funding.js';
import { SECTION_SEPARATOR, type ExtractedBlock } from '../documents/types.js';
import type { SourceDocument } from '../funding/pipeline.js';
import { toCitation, verifyQuote, type VerifiedQuote } from '../knowledge/quote-verifier.js';

type Kind = LiteralFinding['kind'];

/** The most findings of one kind that are kept, in the order the document gives them. */
export const MAX_FINDINGS_PER_KIND = 60;

/**
 * The longest text one finding shows. A citation carries about 600 characters
 * at most, so a sentence longer than this is reported as the part around each
 * match instead of being cut wherever the limit happens to fall.
 */
const MAX_FINDING_CHARACTERS = 480;
/** How much of an over-long sentence is kept before a match. */
const LEAD_CHARACTERS = 200;
/** Room kept after the start of a match, so the words that matched are never cut off. */
const MATCH_ROOM = 40;

const NOT_AFTER_WORD = '(?<![\\p{L}\\p{N}])';
const NOT_BEFORE_WORD = '(?![\\p{L}\\p{N}])';

// ─────────────────────────────────── dates ────────────────────────────────────

const MONTH_STARTS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH =
  '(?<month>January|February|March|April|May|June|July|August|September|October|November|December' +
  '|(?:Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\\.?)';
const DAY = '(?:[12]\\d|3[01]|0?[1-9])(?:st|nd|rd|th)?';
const YEAR = '(?:19|20)\\d{2}';

const NAMED_DATES = [
  // "March 5, 2027", "Mar. 5", "March 5-6, 2027"
  new RegExp(
    `${NOT_AFTER_WORD}${MONTH}\\s${DAY}${NOT_BEFORE_WORD}(?:\\s?[-\\u2013]\\s?${DAY}${NOT_BEFORE_WORD})?(?:,?\\s${YEAR}${NOT_BEFORE_WORD})?`,
    'giu',
  ),
  // "5 March 2027", "the 5th of March"
  new RegExp(`(?<![\\p{L}\\p{N}.,/])${DAY}(?:\\sof)?\\s${MONTH}${NOT_BEFORE_WORD}(?:,?\\s${YEAR}${NOT_BEFORE_WORD})?`, 'giu'),
  // "March 2027"
  new RegExp(`${NOT_AFTER_WORD}${MONTH},?\\s${YEAR}${NOT_BEFORE_WORD}`, 'giu'),
];

// "2027-03-05"
const ISO_DATE = /(?<![\d/.-])(?:19|20)\d{2}(?<mark>[-/.])(?<month>0[1-9]|1[0-2])\k<mark>(?:0[1-9]|[12]\d|3[01])(?![\d/-]|\.\d)/gu;
// "3/5/2027", "03-05-2027", "3.5.2027", "3/5/27"
const NUMERIC_DATE =
  /(?<![\d/.-])(?<first>\d{1,2})(?<mark>[/.-])(?<second>\d{1,2})\k<mark>(?<year>(?:19|20)\d{2}|\d{2})(?![\d/-]|\.\d)/gu;

export interface DateMention {
  /** Where the date starts in the text. */
  index: number;
  /** True when the month is written as a name, false for a date made of numbers. */
  named: boolean;
  /**
   * The month as a number from 1 to 12. A date made of numbers such as
   * "3/5/2027" can be read either way round, so it lists both.
   */
  months: number[];
}

/**
 * The dates written in a text, in the order they appear: a month name with a
 * day, a year or both, or a date made of numbers. A year alone, a time of day
 * and a quarter ("Q3 2027") are not dates here.
 */
export function datesIn(text: string): DateMention[] {
  const found: DateMention[] = [];
  for (const pattern of NAMED_DATES) {
    for (const match of text.matchAll(pattern)) {
      const month = match.groups?.month ?? '';
      // In running text "may 5" and "march 3" are a verb and a number. A month is capitalized.
      if (!/^\p{Lu}/u.test(month)) continue;
      found.push({ index: match.index, named: true, months: [MONTH_STARTS.indexOf(month.slice(0, 3).toLowerCase()) + 1] });
    }
  }
  for (const match of text.matchAll(ISO_DATE)) {
    found.push({ index: match.index, named: false, months: [Number(match.groups?.month)] });
  }
  for (const match of text.matchAll(NUMERIC_DATE)) {
    const { first = '', second = '', mark = '', year = '' } = match.groups ?? {};
    const [a, b] = [Number(first), Number(second)];
    // A two-digit year is a date only between slashes: "1.2.34" numbers a section and "10-12-26" a form.
    if (year.length === 2 && mark !== '/') continue;
    if (a < 1 || b < 1 || a > 31 || b > 31 || (a > 12 && b > 12)) continue;
    found.push({ index: match.index, named: false, months: [a, b].filter((value) => value <= 12) });
  }
  return found.sort((a, b) => a.index - b.index);
}

// ────────────────────────────── the other patterns ──────────────────────────────

// Codes that are also everyday capitals, such as the ones spelled like "try" or
// like a programming language, are left out: they would turn "version 8" into money.
const CURRENCY_CODES =
  'USD|EUR|GBP|CAD|AUD|NZD|CHF|JPY|CNY|INR|MXN|BRL|ZAR|SEK|NOK|DKK|PLN|CZK|HUF|RON|SGD|HKD|KRW|ILS|KES|NGN|GHS';

// An amount is a figure with a currency beside it. A limit ("up to $50,000") or
// a range ("$75,000 to $250,000") is found by the amount in it and reported
// with its sentence, which carries the words around it. A bare figure is never
// taken for money: "up to 5,000" may count people.
const AMOUNTS = [
  // "$75,000", "€ 60 000", "US$1.5 million", and the sign written after: "60 000 €"
  /\p{Sc}\s?\d|\d(?:\s?(?:thousand|million|billion|trillion)|[kmb]|bn)?\s?\p{Sc}/giu,
  // "USD 75,000", "75,000 USD", "1.2 million EUR". Codes are capitals, so "eur" inside a word is not one.
  new RegExp(
    `${NOT_AFTER_WORD}(?:${CURRENCY_CODES})\\s?\\d` +
      `|\\d(?:\\s?(?:[Tt]housand|[Mm]illion|[Bb]illion|[Tt]rillion)|[KkMmBb]|bn)?\\s?(?:${CURRENCY_CODES})${NOT_BEFORE_WORD}`,
    'gu',
  ),
  // "2 million dollars", "500 euros"
  new RegExp(`\\d(?:\\s?(?:thousand|million|billion|trillion)|[kmb]|bn)?\\s(?:dollars?|euros?|pounds sterling)${NOT_BEFORE_WORD}`, 'giu'),
];

const REQUIREMENTS = [
  new RegExp(
    `${NOT_AFTER_WORD}(?:must|shall|(?:is|are) required to|required|may not|(?:is|are) not eligible|not eligible|ineligible)${NOT_BEFORE_WORD}`,
    'giu',
  ),
];

const MATCHING = [
  new RegExp(
    `${NOT_AFTER_WORD}(?:match(?:es|ed|ing)?|cost[\\s-]shar(?:e|es|ed|ing)|in[\\s-]kind|per\\s?cent of)${NOT_BEFORE_WORD}|%\\s?of${NOT_BEFORE_WORD}`,
    'giu',
  ),
];

const AI_TOOLS = [
  new RegExp(
    `${NOT_AFTER_WORD}(?:artificial intelligence|generative|large language models?|chat\\s?bots?|automated (?:writing|tools?))${NOT_BEFORE_WORD}`,
    'giu',
  ),
  // The acronym counts in capitals only, and never beside a slash: "AI/AN" names a population, not a tool.
  /(?<![\p{L}\p{N}/])(?:AI|LLMs?)(?![\p{L}\p{N}/])|(?<![\p{L}\p{N}])A\.I\./gu,
];

function positions(text: string, patterns: RegExp[]): number[] {
  const found: number[] = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) found.push(match.index);
  }
  return found.sort((a, b) => a - b);
}

interface Matcher {
  kind: Kind;
  /** A heading is a label, not a statement. Only a date or an amount is read from one. */
  inHeadings: boolean;
  /** Where the pattern occurs in a text, first to last. */
  find(text: string): number[];
}

const MATCHERS: Matcher[] = [
  { kind: 'date', inHeadings: true, find: (text) => datesIn(text).map((date) => date.index) },
  { kind: 'amount', inHeadings: true, find: (text) => positions(text, AMOUNTS) },
  { kind: 'requirement', inHeadings: false, find: (text) => positions(text, REQUIREMENTS) },
  { kind: 'match', inHeadings: false, find: (text) => positions(text, MATCHING) },
  { kind: 'ai_tools', inHeadings: false, find: (text) => positions(text, AI_TOOLS) },
];

// ─────────────────────────────────── sentences ──────────────────────────────────

/** A stretch of a text: [start, end). */
interface Span {
  start: number;
  end: number;
}

// A full stop after one of these is part of the word, not the end of a sentence.
const ABBREVIATIONS = new Set(
  `e.g i.e etc vs cf al no nos sec secs art fig figs para pp vol ed eds st dr mr mrs ms prof inc ltd co corp
  u.s u.s.c c.f.r a.m p.m jan feb mar apr jun jul aug sep sept oct nov dec approx est dept govt ref attn tel
  ext`.split(/\s+/),
);

const SENTENCE_END_RE = /[.!?]+["'”’)\]]*\s/gu;
const OPENS_SENTENCE_RE = /^["'“‘([]*[\p{Lu}\p{N}\p{Sc}]/u;
const LAST_WORD_RE = /\p{L}[\p{L}.]*$/u;
// Words as the quote verifier counts them: a grouped number is one word.
const WORD_RE = /\p{Nd}{1,3}(?:,\p{Nd}{3})+(?:\.\p{Nd}+)?|\p{Nd}+(?:\.\p{Nd}+)?|[\p{L}\p{M}]+(?:'[\p{L}\p{M}]+)*/gu;

/**
 * True when a stretch is long enough to be quoted on its own. The verifier
 * accepts a shorter quotation only when it is a whole block, so a short
 * sentence, or a list number such as "Step 1.", stays with its neighbour.
 */
function standsAlone(text: string): boolean {
  return text.length >= 25 && (text.match(WORD_RE)?.length ?? 0) >= 5;
}

/**
 * The sentences of a block, as stretches of its text. A sentence ends at a full
 * stop, question mark or exclamation mark that is followed by a space and a
 * capital letter, a digit or a currency sign. Where that cannot be told for
 * sure, two sentences stay together rather than one being cut in half.
 */
function sentenceSpans(text: string): Span[] {
  const spans: Span[] = [];
  let start = 0;
  for (const match of text.matchAll(SENTENCE_END_RE)) {
    const end = match.index + match[0].length - 1;
    const next = end + 1;
    if (!OPENS_SENTENCE_RE.test(text.slice(next, next + 8))) continue;
    if (match[0].startsWith('.')) {
      const word = LAST_WORD_RE.exec(text.slice(Math.max(start, match.index - 12), match.index))?.[0] ?? '';
      if (ABBREVIATIONS.has(word.toLowerCase())) continue;
    }
    if (!standsAlone(text.slice(start, end))) continue;
    spans.push({ start, end });
    start = next;
  }
  if (start < text.length) {
    const last = spans[spans.length - 1];
    if (last && !standsAlone(text.slice(start))) last.end = text.length;
    else spans.push({ start, end: text.length });
  }
  return spans;
}

/** The part of an over-long sentence around a match, starting and ending on whole words. */
function around(sentence: string, at: number): Span {
  let start = Math.max(0, at - LEAD_CHARACTERS);
  if (start > 0) {
    const space = sentence.indexOf(' ', start);
    start = space >= 0 && space < at ? space + 1 : at;
  }
  let end = Math.min(sentence.length, start + MAX_FINDING_CHARACTERS);
  if (end < sentence.length) {
    const space = sentence.lastIndexOf(' ', end);
    if (space > at + MATCH_ROOM) end = space;
  }
  return { start, end };
}

/** What to show for a sentence: all of it when it is short enough to quote, otherwise the part around each match. */
function stretches(sentence: string, at: number[]): Span[] {
  if (sentence.length <= MAX_FINDING_CHARACTERS) return [{ start: 0, end: sentence.length }];
  const spans: Span[] = [];
  for (const position of at) {
    const last = spans[spans.length - 1];
    if (last && position <= last.end - MATCH_ROOM) continue;
    spans.push(around(sentence, position));
  }
  return spans;
}

/**
 * The stored wording for a stretch of a block. It is looked for in this block
 * alone and has to be there word for word: a finding is the sentence where it
 * stands, never the same words found somewhere else.
 */
function stored(block: ExtractedBlock, wanted: string): VerifiedQuote | null {
  const found = verifyQuote([block], block.id, wanted);
  if (found?.match === 'exact') return found;
  // A stretch the verifier will not accept alone is reported as its whole block, when that is short enough.
  if (block.text.length > MAX_FINDING_CHARACTERS || wanted === block.text) return null;
  const whole = verifyQuote([block], block.id, block.text);
  return whole?.match === 'exact' ? whole : null;
}

/**
 * Finds dates, amounts and the sentences that use the wording of a requirement,
 * a match or a rule about AI tools.
 *
 * - `text` is always a slice of the stored block, and the citation gives its
 *   page and section.
 * - A sentence that sits directly under a heading about AI tools is listed as
 *   an AI-tools finding even when it only says "such tools": the heading is the
 *   document's own label for it.
 * - At most 60 findings of each kind are returned, in document order, and the
 *   same sentence is not listed twice for one kind.
 */
export function findLiterals(document: SourceDocument): LiteralFinding[] {
  const findings: LiteralFinding[] = [];
  const identity = { id: document.id, name: document.name, version: document.version };
  const counts = new Map<Kind, number>();
  const seen = new Set<string>();
  const aiHeadings = new Map<string, boolean>();
  const full = (kind: Kind) => (counts.get(kind) ?? 0) >= MAX_FINDINGS_PER_KIND;

  for (const block of document.blocks) {
    if (MATCHERS.every((matcher) => full(matcher.kind))) break;
    const heading = block.kind === 'heading';
    const above = block.section.split(SECTION_SEPARATOR).pop() ?? '';
    let underAiHeading = aiHeadings.get(above);
    if (underAiHeading === undefined) {
      underAiHeading = positions(above, AI_TOOLS).length > 0;
      aiHeadings.set(above, underAiHeading);
    }

    for (const span of sentenceSpans(block.text)) {
      const sentence = block.text.slice(span.start, span.end);
      for (const matcher of MATCHERS) {
        if (full(matcher.kind) || (heading && !matcher.inHeadings)) continue;
        const byHeading = matcher.kind === 'ai_tools' && underAiHeading;
        let at = matcher.find(sentence);
        if (at.length === 0 && byHeading) at = [0];
        if (at.length === 0) continue;

        for (const stretch of stretches(sentence, at)) {
          if (full(matcher.kind)) break;
          const found = stored(block, sentence.slice(stretch.start, stretch.end));
          // What is shown has to show the match: a quotation the verifier shortened may have lost it.
          if (!found || (!byHeading && matcher.find(found.quote).length === 0)) continue;
          const key = `${matcher.kind}\n${found.quote.toLowerCase()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          counts.set(matcher.kind, (counts.get(matcher.kind) ?? 0) + 1);
          findings.push({ kind: matcher.kind, text: found.quote, citation: toCitation(identity, found) });
        }
      }
    }
  }
  return findings;
}
