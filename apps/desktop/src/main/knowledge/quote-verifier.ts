// Deciding whether a quotation really is in a document.
//
// An assistant answers with a block id and a quotation. Neither is trusted: the
// quotation is only a search key. If it is found, the citation shown to the
// user is cut from the text the app extracted, with that text's own casing and
// punctuation; if it is not found, there is no citation.
//
// Both sides are compared in one normalized form (NFKC; invisible characters
// removed; curly quotes and dashes unified; a word hyphenated across a break
// joined; whitespace collapsed; case folded), with a map from every normalized
// character back to the stored text.
//
//  1. Exact: the normalized quotation occurs in the block.
//  2. Exact but for punctuation and spacing: the same, comparing letters and
//     digits only. A "." or "," between digits, a "%" or currency sign beside
//     one and a minus sign before one are kept, and digits never run together
//     across anything dropped, so "1.5" cannot match "15" and "2024, 312"
//     cannot match "20243 12".
//  3. Approximate: at least nine words in ten agree, in order, with a stretch
//     of the block, and every number in the quotation is the same number in
//     that stretch. Numbers written as words, month and weekday names and
//     negations must be the same too.
//
// An exact match must begin and end on whole words and whole numbers, so
// "250 residents" is not found inside "1,250 residents". The block the
// assistant named is searched first, then the two blocks either side, then the
// same page, then the rest of the document, and the result names the block the
// words were actually found in.

import type { Citation } from '../../shared/funding.js';
import type { ExtractedBlock } from '../documents/types.js';
import { canonicalNumber } from './text.js';

export interface VerifiedQuote {
  /** The block the quotation was found in, which may not be the one claimed. */
  blockId: string;
  page: number | null;
  section: string;
  /** A slice of that block's stored text. Never the assistant's wording. */
  quote: string;
  match: 'exact' | 'approximate';
}

/** Shorter quotations are accepted only when they are a whole block. */
const MIN_CHARS = 20;
const MIN_WORDS = 4;
/** Longer quotations are cut to about this many normalized characters. */
const MAX_CHARS = 600;
/** Raw input beyond this is ignored before any work is done on it. */
const MAX_RAW_CHARS = 6000;
const MAX_PARTS = 8;
const MIN_LOOSE_CHARS = 16;
const SIMILARITY = 0.9;
/** How many stretches of one block are compared word by word before giving up. */
const MAX_COMPARISONS = 2000;
const NEIGHBOUR_REACH = 2;

const FOLDED = new Map<string, string>([
  ...[...'\u2018\u2019\u201A\u201B\u2032`\u00B4\u02BC\u02B9'].map((mark): [string, string] => [mark, "'"]),
  ...[...'\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB'].map((mark): [string, string] => [mark, '"']),
  ...[...'\u2010\u2011\u2012\u2013\u2014\u2015\u2212'].map((mark): [string, string] => [mark, '-']),
  // The untrusted-text wrapper shows "<" as this mark; they compare as equal.
  ['\u2039', '<'],
  ['\u203A', '>'],
]);

const FORMAT_RE = /^\p{Cf}$/u;
const BLANK_RE = /^[\s\p{Cc}]$/u;
const LETTER_RE = /^\p{L}$/u;
const DIGIT_RE = /^\p{Nd}$/u;
const WORD_CHAR_RE = /^[\p{L}\p{N}\p{M}]$/u;
const CURRENCY_RE = /^\p{Sc}$/u;
// Marks, and the jamo that complete a Korean syllable, belong to the character before them.
const TRAILING_RE = /^[\p{M}\u1160-\u11FF]$/u;
// Scripts written without spaces between words: any character may start a quotation.
const UNSPACED_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const HYPHEN_BREAK_RE = /[-\u2010\u2011\u00AD]\s+(?=\p{Ll})/uy;
const ELLIPSIS_RE = /\s*[[(]?\s*(?:\u2026|\.{3,}|(?:\.\s){2,}\.)\s*[\])]?\s*/u;
// Labels the untrusted-text wrapper adds to what the assistant is shown.
const WRAPPER_NOTE_RE = /\[page text\]\s?|quoted-page-text-/gi;
const TOKEN_RE =
  /\p{Nd}{1,3}(?:,\p{Nd}{3})+(?!\p{Nd})(?:\.\p{Nd}+)?|\p{Nd}+(?:\.\p{Nd}+)?|[\p{L}\p{M}]+(?:'[\p{L}\p{M}]+)*|\p{N}+/gu;
// A comma that groups thousands: exactly three digits follow it.
const GROUPING_RE = /,\p{Nd}{3}(?!\p{Nd})/uy;

// Words that carry a figure, a date or a negation. An approximate match may not
// add, drop or change one: "three years" is not "five years", and "may not" is
// not "may".
const DECISIVE_WORDS = new Set(
  `zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen
  seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million
  billion trillion half quarter dozen once twice double triple first second third fourth fifth sixth seventh
  eighth ninth tenth january february march april may june july august september october november december
  jan feb mar apr jun jul aug sep sept oct nov dec monday tuesday wednesday thursday friday saturday sunday
  not no never none neither nor cannot without`.split(/\s+/),
);

const MAGNITUDES = new Map<string, number>([
  ['thousand', 3],
  ['million', 6],
  ['billion', 9],
  ['trillion', 12],
]);
const NUMBER_RE =
  /(\d{1,3}(?:,\d{3})+(?!\d)(?:\.\d+)?|\d+(?:\.\d+)?)(?:[\s-]?(thousand|million|billion|trillion)\b)?(\s?%|\s?(?:percent|per\s?cent)\b)?/g;
// What may follow a number and change what it says.
const UNIT_AFTER_RE = /^(?:[\s-]?(?:thousand|million|billion|trillion)\b)?(?:\s?%|\s?(?:percent|per\s?cent)\b)?/i;

function scale(value: string, zeros: number): string {
  const [whole = '0', fraction = ''] = value.split('.');
  const padded = fraction.padEnd(zeros, '0');
  const rest = padded.slice(zeros);
  return canonicalNumber(`${whole}${padded.slice(0, zeros)}${rest ? `.${rest}` : ''}`);
}

/**
 * The numbers written in a text, in order, each as one comparable token.
 *
 * Recognized: digits with optional grouping commas and a decimal point, read by
 * value ("$1,912,400" and "1912400.00" are "1912400"; "4.10" stays "4.10";
 * leading zeros are dropped). A following "%", "percent" or "per cent" marks a
 * percentage ("68 percent" and "68%" are "68%"). A following "thousand",
 * "million", "billion" or "trillion" is applied ("$1.5 million" is "1500000").
 * Currency signs, plus and minus signs, units and ordinal endings are ignored
 * ("24 months" and "24th" are "24").
 *
 * Not recognized: numbers written as words ("sixty-eight", "three"), Roman
 * numerals, abbreviated amounts ("5k" and "$2M" read as 5 and 2), decimal
 * commas ("1.250,00"), and digits of other scripts. A fraction, a range or a
 * date is read as the separate numbers in it ("1/2" is 1 and 2).
 */
export function numbersIn(text: string): string[] {
  const clean = text.normalize('NFKC').replace(/\p{Cf}/gu, '').toLowerCase();
  const found: string[] = [];
  for (const match of clean.matchAll(NUMBER_RE)) {
    const zeros = MAGNITUDES.get(match[2] ?? '');
    const value = zeros ? scale(canonicalNumber(match[1] ?? ''), zeros) : canonicalNumber(match[1] ?? '');
    found.push(match[3] ? `${value}%` : value);
  }
  return found;
}

/**
 * The numbers in a statement that none of the quotations contain, each once, in
 * the order they appear. A percentage must be quoted as a percentage; a plain
 * number is also supported by the same number quoted as a percentage. Numbers
 * written as words are not checked (see numbersIn).
 */
export function unsupportedNumbers(statement: string, quotes: string[]): string[] {
  const quoted = new Set(quotes.flatMap((quote) => numbersIn(quote)));
  const plain = new Set([...quoted].map((value) => value.replace(/%$/, '')));
  const missing = numbersIn(statement).filter((value) => !quoted.has(value) && (value.endsWith('%') || !plain.has(value)));
  return [...new Set(missing)];
}

export function toCitation(document: { id: string; name: string; version: number }, verified: VerifiedQuote): Citation {
  return {
    documentId: document.id,
    documentName: document.name,
    documentVersion: document.version,
    blockId: verified.blockId,
    page: verified.page,
    section: verified.section,
    quote: verified.quote,
    match: verified.match,
  };
}

interface Normalized {
  /** The comparable form. */
  key: string;
  /** For each character of the key, where the character it came from starts in the text. */
  starts: number[];
  /** Places in the key where a hyphen and a break were removed between two halves of a word. */
  seams: Set<number>;
}

interface Loose {
  /** Letters and digits of a key, with the punctuation that changes a number. */
  key: string;
  /** For each character, its position in the key it was made from. */
  at: number[];
}

interface Token {
  text: string;
  /** Range in the key. */
  start: number;
  end: number;
  /** Set when the word was joined at a seam: its parts, in order. */
  halves?: string[];
}

/** A range of a key: [start, end). */
interface Range {
  start: number;
  end: number;
}

/** Where the character starting at `index` ends, with the marks that belong to it. */
function unitEnd(text: string, index: number): number {
  let end = index + ((text.codePointAt(index) ?? 0) > 0xffff ? 2 : 1);
  while (end < text.length) {
    const next = String.fromCodePoint(text.codePointAt(end) ?? 0);
    if (!TRAILING_RE.test(next)) break;
    end += next.length;
  }
  return end;
}

function normalize(text: string): Normalized {
  const key: string[] = [];
  const starts: number[] = [];
  const seams = new Set<number>();
  const push = (char: string, index: number) => {
    for (let unit = 0; unit < char.length; unit++) {
      key.push(char[unit] ?? '');
      starts.push(index);
    }
  };

  for (let index = 0; index < text.length; ) {
    const base = String.fromCodePoint(text.codePointAt(index) ?? 0);
    // "fam-" at the end of one line and "ilies" on the next is one word.
    if (LETTER_RE.test(key[key.length - 1] ?? '')) {
      HYPHEN_BREAK_RE.lastIndex = index;
      if (HYPHEN_BREAK_RE.test(text)) {
        seams.add(key.length);
        index = HYPHEN_BREAK_RE.lastIndex;
        continue;
      }
    }
    if (FORMAT_RE.test(base)) {
      index += base.length;
      continue;
    }
    const end = unitEnd(text, index);
    // Folded before and after: NFKC would split "\u00B4" in two, and turns some dashes into others.
    for (const raw of FOLDED.get(base) ?? text.slice(index, end).normalize('NFKC')) {
      const char = FOLDED.get(raw) ?? raw;
      if (BLANK_RE.test(char)) {
        if (key.length > 0 && key[key.length - 1] !== ' ') push(' ', index);
      } else {
        // Final sigma is the same letter as sigma.
        push(char.toLowerCase().replace(/\u03C2/g, '\u03C3'), index);
      }
    }
    index = end;
  }
  if (key[key.length - 1] === ' ') {
    key.pop();
    starts.pop();
  }
  return { key: key.join(''), starts, seams };
}

function loosen(key: string): Loose {
  const kept: string[] = [];
  const at: number[] = [];
  let lastKept = '';
  let gap = false;
  for (let index = 0; index < key.length; ) {
    const char = String.fromCodePoint(key.codePointAt(index) ?? 0);
    const before = key[index - 1] ?? '';
    const after = key[index + char.length] ?? '';
    let keep = WORD_CHAR_RE.test(char);
    if (!keep && char === ',') {
      // "March 3,2027" is a date missing a space, not the number 32,027.
      GROUPING_RE.lastIndex = index;
      keep = DIGIT_RE.test(before) && GROUPING_RE.test(key);
    } else if (!keep && (char === '.' || char === '\u066B' || char === '\u066C')) {
      keep = DIGIT_RE.test(before) && DIGIT_RE.test(after);
    } else if (!keep && (char === '%' || CURRENCY_RE.test(char))) {
      keep = DIGIT_RE.test(before) || DIGIT_RE.test(after);
    } else if (!keep && char === '-') {
      // A minus sign, as in "-5". A hyphen inside a word or a range is dropped.
      keep = DIGIT_RE.test(after) && !WORD_CHAR_RE.test(before);
    }
    if (keep) {
      // Two numbers with something dropped between them stay two numbers.
      if (gap && DIGIT_RE.test(char) && DIGIT_RE.test(lastKept)) {
        kept.push(' ');
        at.push(index);
      }
      for (let unit = 0; unit < char.length; unit++) {
        kept.push(char[unit] ?? '');
        at.push(index + unit);
      }
      lastKept = char;
      gap = false;
    } else {
      gap = true;
    }
    index += char.length;
  }
  return { key: kept.join(''), at };
}

function tokensOf(key: string, seams: Set<number>): Token[] {
  const tokens: Token[] = [];
  // Seams were recorded in reading order, as the tokens are.
  const seamList = [...seams];
  let nextSeam = 0;
  for (const match of key.matchAll(TOKEN_RE)) {
    const text = match[0];
    const start = match.index;
    if (DIGIT_RE.test(text[0] ?? '')) {
      tokens.push({ text: canonicalNumber(text), start, end: start + text.length });
    } else if (UNSPACED_RE.test(text)) {
      // No spaces to go by: each character counts as a word.
      let offset = start;
      for (const char of text) {
        tokens.push({ text: char, start: offset, end: offset + char.length });
        offset += char.length;
      }
    } else {
      const token: Token = { text, start, end: start + text.length };
      // The halves of a word joined at a seam, in case they were two words.
      while ((seamList[nextSeam] ?? Infinity) <= token.start) nextSeam += 1;
      const cuts: number[] = [];
      while ((seamList[nextSeam] ?? Infinity) < token.end) cuts.push(seamList[nextSeam++] ?? 0);
      if (cuts.length > 0) {
        const edges = [token.start, ...cuts, token.end];
        token.halves = edges.slice(1).map((edge, index) => key.slice(edges[index] ?? edge, edge));
      }
      tokens.push(token);
    }
  }
  return tokens;
}

/** True when two neighbouring characters belong to one word or one number. */
function joined(key: string, left: number): boolean {
  const a = key[left] ?? '';
  const b = key[left + 1] ?? '';
  if (WORD_CHAR_RE.test(a) && WORD_CHAR_RE.test(b)) return !UNSPACED_RE.test(a) && !UNSPACED_RE.test(b);
  // "1,250" and "4.10": the separator sits between two digits.
  if (a === '.' || a === ',') return DIGIT_RE.test(key[left - 1] ?? '') && DIGIT_RE.test(b);
  if (b === '.' || b === ',') return DIGIT_RE.test(a) && DIGIT_RE.test(key[left + 2] ?? '');
  return false;
}

/**
 * True when a range neither starts nor ends inside a word or a number. A seam
 * counts as an edge: "pre- and post" may not have been one word at all.
 */
function onWholeWords(block: Forms, range: Range): boolean {
  const { key, seams } = block;
  const startsClean = range.start === 0 || seams.has(range.start) || !joined(key, range.start - 1);
  const endsClean = range.end >= key.length || seams.has(range.end) || !joined(key, range.end - 1);
  return startsClean && endsClean;
}

class Forms {
  readonly key: string;
  readonly starts: number[];
  readonly seams: Set<number>;
  private looseForm: Loose | null = null;
  private tokenList: Token[] | null = null;

  constructor(readonly text: string) {
    const normalized = normalize(text);
    this.key = normalized.key;
    this.starts = normalized.starts;
    this.seams = normalized.seams;
  }

  get loose(): Loose {
    this.looseForm ??= loosen(this.key);
    return this.looseForm;
  }

  get tokens(): Token[] {
    this.tokenList ??= tokensOf(this.key, this.seams);
    return this.tokenList;
  }

  /** The stored text behind a range of the key, widened to take in a number's sign and unit. */
  slice(range: Range): string {
    let from = this.starts[range.start] ?? 0;
    let to = unitEnd(this.text, this.starts[range.end - 1] ?? 0);
    if (DIGIT_RE.test(this.key[range.end - 1] ?? '')) {
      to += UNIT_AFTER_RE.exec(this.text.slice(to, to + 24))?.[0].length ?? 0;
    }
    const before = this.text[from - 1] ?? '';
    if (DIGIT_RE.test(this.key[range.start] ?? '') && CURRENCY_RE.test(before)) from -= 1;
    return this.text.slice(from, to);
  }
}

// Reading a block is the slow part, and one document is searched many times.
// The entry lives exactly as long as the block object it describes.
const formsOfBlock = new WeakMap<ExtractedBlock, Forms>();

function formsFor(block: ExtractedBlock): Forms {
  const cached = formsOfBlock.get(block);
  if (cached && cached.text === block.text) return cached;
  const forms = new Forms(block.text);
  formsOfBlock.set(block, forms);
  return forms;
}

/** The first whole-word occurrence of the quotation at or after `from`, exactly or loosely. */
function findExact(block: Forms, quote: Forms, tier: 'strict' | 'loose', from = 0): Range | null {
  const [haystack, needle] = tier === 'strict' ? [block.key, quote.key] : [block.loose.key, quote.loose.key];
  if (!needle || (tier === 'loose' && needle.length < MIN_LOOSE_CHARS)) return null;
  const toKey = (start: number): Range =>
    tier === 'strict'
      ? { start, end: start + needle.length }
      : { start: block.loose.at[start] ?? 0, end: (block.loose.at[start + needle.length - 1] ?? 0) + 1 };

  let position = tier === 'strict' ? from : block.loose.at.findIndex((index) => index >= from);
  if (position < 0) return null;
  for (let found = haystack.indexOf(needle, position); found >= 0; found = haystack.indexOf(needle, position)) {
    const range = toKey(found);
    if (onWholeWords(block, range)) return range;
    position = found + 1;
  }
  return null;
}

function wholeBlock(block: Forms, quote: Forms): Range | null {
  const same = block.key === quote.key || (quote.loose.key !== '' && block.loose.key === quote.loose.key);
  return same && block.key ? { start: 0, end: block.key.length } : null;
}

/** The stretch of the block whose words best agree with the quotation's, if it agrees enough. */
function findApproximate(block: Forms, quote: Forms): Range | null {
  const wanted = quote.tokens.map((token) => token.text);
  const have = block.tokens;
  const size = wanted.length;
  const shortest = Math.ceil(size * SIMILARITY - 1e-9);
  const longest = Math.floor(size / SIMILARITY + 1e-9);
  if (have.length < shortest) return null;

  // Comparing word order is slow, so first count the words a stretch of the
  // longest allowed length shares with the quotation, in any order, as it
  // slides along the block. Only a stretch that shares enough is compared.
  const needed = new Map<string, number>();
  for (const word of wanted) needed.set(word, (needed.get(word) ?? 0) + 1);
  const inStretch = new Map<string, number>();
  let shared = 0;
  const enter = (word: string) => {
    const count = (inStretch.get(word) ?? 0) + 1;
    inStretch.set(word, count);
    if (count <= (needed.get(word) ?? 0)) shared += 1;
  };
  const leave = (word: string) => {
    const count = inStretch.get(word) ?? 0;
    if (count <= (needed.get(word) ?? 0)) shared -= 1;
    inStretch.set(word, count - 1);
  };
  for (const token of have.slice(0, longest)) enter(token.text);

  // Of equally good stretches, the one nearest the quotation's own length wins,
  // so a word the quotation got wrong is shown as the document has it.
  let best: { start: number; end: number; score: number } | null = null;
  let previous = new Uint16Array(size + 1);
  let current = new Uint16Array(size + 1);
  let comparisons = 0;
  for (let start = 0; start + shortest <= have.length; start++) {
    if (start > 0) {
      leave(have[start - 1]?.text ?? '');
      const entering = have[start + longest - 1];
      if (entering) enter(entering.text);
    }
    if (shared < shortest) continue;
    // A block that repeats the quotation's words thousands of times is not worth more.
    comparisons += 1;
    if (comparisons > MAX_COMPARISONS) break;
    previous.fill(0);
    const stop = Math.min(have.length, start + longest);
    for (let end = start; end < stop; end++) {
      const word = have[end]?.text ?? '';
      current[0] = 0;
      for (let column = 1; column <= size; column++) {
        current[column] =
          word === wanted[column - 1]
            ? (previous[column - 1] ?? 0) + 1
            : Math.max(previous[column] ?? 0, current[column - 1] ?? 0);
      }
      const length = end - start + 1;
      const score = (current[size] ?? 0) / Math.max(length, size);
      if (length >= shortest && score >= SIMILARITY) {
        const closer = best !== null && Math.abs(length - size) < Math.abs(best.end - best.start - size);
        if (!best || score > best.score || (score === best.score && closer)) best = { start, end: end + 1, score };
      }
      [previous, current] = [current, previous];
    }
  }
  if (!best) return null;

  const range = { start: have[best.start]?.start ?? 0, end: have[best.end - 1]?.end ?? 0 };
  // Near-identical wording is not enough: every figure has to be the same
  // figure, and so does every word that states one or turns a sentence around.
  const stretch = have.slice(best.start, best.end);
  return sameList(numbersIn(block.slice(range)), numbersIn(quote.text)) && sameList(decisive(stretch), decisive(quote.tokens))
    ? range
    : null;
}

const isDecisive = (word: string) => DECISIVE_WORDS.has(word) || word.endsWith("n't");

function decisive(tokens: Token[]): string[] {
  return tokens.flatMap((token) => (isDecisive(token.text) ? [token.text] : (token.halves ?? []).filter(isDecisive)));
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** The claimed block, the blocks around it, the rest of its page, then everything else. */
function searchOrder(blocks: ExtractedBlock[], claimedBlockId: string | null): ExtractedBlock[] {
  const claimed = claimedBlockId === null ? -1 : blocks.findIndex((block) => block.id === claimedBlockId);
  if (claimed < 0) return blocks;
  const order: ExtractedBlock[] = [];
  const taken = new Set<number>();
  const take = (index: number) => {
    const block = blocks[index];
    if (block && !taken.has(index)) {
      taken.add(index);
      order.push(block);
    }
  };
  take(claimed);
  for (let reach = 1; reach <= NEIGHBOUR_REACH; reach++) {
    take(claimed - reach);
    take(claimed + reach);
  }
  const page = blocks[claimed]?.page ?? null;
  blocks.forEach((block, index) => {
    if (page !== null && block.page === page) take(index);
  });
  blocks.forEach((_block, index) => take(index));
  return order;
}

/** The quotation ready to compare, cut to the longest length a citation may have. */
function prepare(text: string): Forms {
  const forms = new Forms(text);
  if (forms.key.length <= MAX_CHARS) return forms;
  const space = forms.key.lastIndexOf(' ', MAX_CHARS);
  const cut = space > MAX_CHARS / 2 ? space : MAX_CHARS;
  return new Forms(text.slice(0, forms.starts[cut] ?? text.length));
}

function result(block: ExtractedBlock, range: Range, match: VerifiedQuote['match']): VerifiedQuote | null {
  const quote = formsFor(block).slice(range);
  return quote ? { blockId: block.id, page: block.page, section: block.section, quote, match } : null;
}

function locateWhole(order: ExtractedBlock[], quote: Forms): VerifiedQuote | null {
  if (!quote.key) return null;
  if (quote.key.length < MIN_CHARS || quote.tokens.length < MIN_WORDS) {
    for (const block of order) {
      const range = wholeBlock(formsFor(block), quote);
      if (range) return result(block, range, 'exact');
    }
    return null;
  }
  for (const tier of ['strict', 'loose'] as const) {
    for (const block of order) {
      const range = findExact(formsFor(block), quote, tier);
      if (range) return result(block, range, 'exact');
    }
  }
  for (const block of order) {
    const range = findApproximate(formsFor(block), quote);
    if (range) return result(block, range, 'approximate');
  }
  return null;
}

/** A quotation with words left out: every part must be in one block, in order. */
function locateParts(order: ExtractedBlock[], parts: Forms[]): VerifiedQuote | null {
  const characters = parts.reduce((total, part) => total + part.key.length, 0);
  const words = parts.reduce((total, part) => total + part.tokens.length, 0);
  if (characters < MIN_CHARS || words < MIN_WORDS || parts.some((part) => part.tokens.length === 0)) return null;

  for (const block of order) {
    const forms = formsFor(block);
    const ranges: Range[] = [];
    for (const part of parts) {
      const from = ranges[ranges.length - 1]?.end ?? 0;
      // A short part cannot be told from punctuation loosely, so it must match as written.
      const range = findExact(forms, part, 'strict', from) ?? findExact(forms, part, 'loose', from);
      if (!range) break;
      ranges.push(range);
    }
    const first = ranges[0];
    const last = ranges[ranges.length - 1];
    if (ranges.length !== parts.length || !first || !last) continue;

    // Show everything between the parts, so nothing that was left out is hidden.
    const span = { start: first.start, end: last.end };
    if (span.end - span.start <= MAX_CHARS) return result(block, span, 'exact');
    // Too far apart to show whole: the longest part stands for the quotation.
    const longest = ranges.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
    const enough = longest.end - longest.start >= MIN_CHARS;
    return enough ? result(block, longest, 'exact') : null;
  }
  return null;
}

function locate(order: ExtractedBlock[], quote: string): VerifiedQuote | null {
  const pieces = quote.split(ELLIPSIS_RE).filter((piece) => piece.trim() !== '');
  if (pieces.length === 0 || pieces.length > MAX_PARTS) return null;
  const [only] = pieces;
  return pieces.length === 1 && only !== undefined
    ? locateWhole(order, prepare(only))
    : locateParts(order, pieces.map((piece) => prepare(piece)));
}

/**
 * Finds a quotation in a document's blocks. Returns where it really is and the
 * stored wording, or null when it is not there.
 *
 * - `claimedBlockId` only decides where to look first; null or an unknown id
 *   searches the whole document.
 * - A quotation shorter than 20 characters or 4 words is accepted only when it
 *   is an entire block, such as a heading or a table row.
 * - A quotation with an ellipsis is accepted when every part is in one block,
 *   in order. The result then runs from the first part to the last, including
 *   what was left out.
 * - "approximate" means near-identical wording with every number unchanged.
 * - Labels the untrusted-text wrapper adds ("[page text] ", "quoted-page-text-")
 *   are not part of the document and are ignored.
 */
export function verifyQuote(blocks: ExtractedBlock[], claimedBlockId: string | null, quote: string): VerifiedQuote | null {
  if (typeof quote !== 'string' || blocks.length === 0) return null;
  const given = quote.slice(0, MAX_RAW_CHARS);
  const order = searchOrder(blocks, claimedBlockId);

  const unwrapped = given.replace(WRAPPER_NOTE_RE, '');
  let fallback: VerifiedQuote | null = null;
  for (const candidate of unwrapped === given ? [given] : [unwrapped, given]) {
    const found = locate(order, candidate);
    if (found?.match === 'exact') return found;
    fallback ??= found;
  }
  return fallback;
}
