// Plain text and Markdown, and the rules every format shares for turning what
// was read into blocks: how text is cleaned, what counts as content, and how
// blocks get their ids and the headings above them.

import { fromMarkdown } from 'mdast-util-from-markdown';
import { toString as nodeText } from 'mdast-util-to-string';
import type { DocumentFormat } from '../../shared/funding.js';
import { FundingError } from '../funding/errors.js';
import { withLimits, type ExtractionLimits } from './limits.js';
import { SECTION_SEPARATOR, type BlockKind, type ExtractedBlock, type ExtractedDocument } from './types.js';

export const EMPTY_FILE = 'This file is empty, so there is nothing to read. Check that you picked the right file.';

/** A block as a reader produces it, before ids and sections are assigned. */
export interface DraftBlock {
  kind: BlockKind;
  /** Already passed through cleanText. */
  text: string;
  page: number | null;
  /** Depth of a heading, 1 being the outermost. Ignored for other kinds. */
  level?: number;
}

/** A whole paragraph given a heading style, or set in large type, is not a title. */
const MAX_HEADING_CHARACTERS = 200;

// NFKC folds a raised digit or a fraction into the number before it, so
// "400,000¹" would read as 4,000,001. They are set apart first.
const GLUED_TO_NUMBER = /(?<=\p{Nd})(?=[²³¹⁰-⁹₀-₉¼-¾⅐-⅞])/gu;

/**
 * The one form text takes in a block: normalized, single-spaced and trimmed,
 * with nothing invisible left in it. Formatting and private-use characters are
 * dropped because a reader cannot see them, and a document can use them to
 * carry text meant only for the assistant.
 *
 * PDFs use NFKC, which also undoes ligatures and presentation forms; text that
 * was typed keeps its characters and uses NFC.
 */
export function cleanText(raw: string, form: 'NFC' | 'NFKC' = 'NFC'): string {
  const source = form === 'NFKC' ? raw.replace(GLUED_TO_NUMBER, ' ') : raw;
  return source
    .normalize(form)
    .replace(/[\p{Cf}\p{Co}]/gu, '')
    .replace(/[\p{Cc}\s]+/gu, ' ')
    .trim();
}

/** True when there is a letter or digit to read; rules and bullets alone are not content. */
export function hasContent(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

/** The start of `text`, no longer than `length` and ending on a whole word where there is one. */
export function cutAtWord(text: string, length: number): string {
  if (text.length <= length) return text;
  const lastSpace = text.lastIndexOf(' ', length);
  return text.slice(0, lastSpace > 0 ? lastSpace : length);
}

/** Words as a word processor counts them: runs between spaces that hold a letter or digit. */
export function countWords(text: string): number {
  let words = 0;
  for (const token of text.split(' ')) if (hasContent(token)) words += 1;
  return words;
}

/**
 * Numbers the blocks in reading order and gives each the headings above it.
 * Nothing here depends on anything but the drafts, so the same file always
 * produces the same ids.
 */
export function assembleDocument(
  format: DocumentFormat,
  drafts: readonly DraftBlock[],
  pageCount: number | null,
  warnings: string[],
): ExtractedDocument {
  const blocks: ExtractedBlock[] = [];
  const above: { level: number; title: string }[] = [];
  let wordCount = 0;

  for (const draft of drafts) {
    if (!hasContent(draft.text)) continue;
    const heading = draft.kind === 'heading' && draft.text.length <= MAX_HEADING_CHARACTERS;
    const level = heading ? Math.max(1, Math.floor(draft.level ?? 1)) : 0;
    if (heading) {
      while (above.length > 0 && above[above.length - 1]!.level >= level) above.pop();
    }
    blocks.push({
      id: `b${String(blocks.length + 1).padStart(4, '0')}`,
      kind: draft.kind === 'heading' && !heading ? 'paragraph' : draft.kind,
      text: draft.text,
      page: draft.page,
      section: above.map((entry) => entry.title).join(SECTION_SEPARATOR),
      headingLevel: heading ? Math.min(level, 6) : null,
    });
    if (heading) above.push({ level, title: draft.text });
    wordCount += countWords(draft.text);
  }
  return { format, blocks, pageCount, wordCount, warnings };
}

const SAMPLE_BYTES = 8192;

// Bytes 0x80–0x9F in Windows-1252. The platform's own decoder returns control
// characters for some of them on the Node version the tests run on, so the
// table is spelled out.
const WESTERN_EUROPEAN_HIGH =
  '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F' +
  '\u0090‘’“”•–—˜™š›œ\u009DžŸ';

export interface DecodedText {
  text: string;
  /** True when the bytes were not Unicode and were read as Western European text. */
  guessed: boolean;
}

/** The text in a file's bytes, or null when the bytes are not text at all. */
export function decodeText(bytes: Uint8Array): DecodedText | null {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: utf16(bytes.subarray(2), false), guessed: false };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: utf16(bytes.subarray(2), true), guessed: false };
  const order = utf16Order(bytes);
  if (order) return { text: utf16(bytes, order === 'big'), guessed: false };
  if (bytes.includes(0)) return null;

  const marked = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const body = marked ? bytes.subarray(3) : bytes;
  let text: string;
  let guessed = false;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    text = westernEuropean(body);
    guessed = true;
  }
  return looksBinary(text) ? null : { text, guessed };
}

/** Plain ASCII saved as UTF-16 without a mark has a zero byte in every other position. */
function utf16Order(bytes: Uint8Array): 'little' | 'big' | null {
  const pairs = Math.floor(Math.min(bytes.byteLength, SAMPLE_BYTES) / 2);
  if (pairs < 2) return null;
  let even = 0;
  let odd = 0;
  for (let index = 0; index < pairs * 2; index += 2) {
    if (bytes[index] === 0) even += 1;
    if (bytes[index + 1] === 0) odd += 1;
  }
  if (odd >= pairs * 0.3 && even <= pairs * 0.02) return 'little';
  if (even >= pairs * 0.3 && odd <= pairs * 0.02) return 'big';
  return null;
}

function utf16(bytes: Uint8Array, bigEndian: boolean): string {
  if (!bigEndian) return new TextDecoder('utf-16le').decode(bytes);
  const swapped = Buffer.from(bytes.subarray(0, bytes.byteLength - (bytes.byteLength % 2)));
  swapped.swap16();
  return new TextDecoder('utf-16le').decode(swapped);
}

function westernEuropean(bytes: Uint8Array): string {
  const latin = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
  let text = '';
  let from = 0;
  for (let index = 0; index < latin.length; index += 1) {
    const code = latin.charCodeAt(index);
    if (code >= 0x80 && code <= 0x9f) {
      text += latin.slice(from, index) + WESTERN_EUROPEAN_HIGH[code - 0x80];
      from = index + 1;
    }
  }
  return text + latin.slice(from);
}

/** Text has the odd form feed or escape code; data has control characters throughout. */
function looksBinary(text: string): boolean {
  let controls = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    const layout = code === 9 || code === 10 || code === 11 || code === 12 || code === 13 || code === 27;
    if (code < 32 && !layout) controls += 1;
  }
  return controls > Math.max(4, text.length / 200);
}

export interface TextOptions {
  limits?: Partial<ExtractionLimits>;
}

const NOT_TEXT =
  'This file does not contain plain text, so it could not be read. Upload a PDF, a Word document (.docx), a Markdown file or a plain-text file.';
const NO_TEXT = 'This file has no text in it, so there is nothing to read. Check that you picked the right file.';
const GUESSED_ENCODING =
  'This file is not saved as Unicode text, so it was read as Western European text. If any characters look wrong, save it as UTF-8 and upload it again.';
const HTML_LEFT_OUT = 'This file contains HTML, which was left out. Only its Markdown text was read.';
const TOO_DEEP = 'Part of this file is nested too deeply to read and was left out.';
const ALL_TOO_DEEP = 'The contents of this file are nested too deeply to read. Save it with simpler formatting and upload it again.';

/** Leading metadata between "---" lines. It describes the file; it is not part of its text. */
const FRONT_MATTER = /^---\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/;
/** The row of dashes under a table's header, e.g. "| --- | :-: |", without the space around it. */
const TABLE_RULE = /^\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?$/;
const MAX_MARKDOWN_DEPTH = 100;

interface Source {
  text: string;
  warnings: string[];
}

function readSource(bytes: Uint8Array): Source {
  if (bytes.byteLength === 0) throw new FundingError('EXTRACTION_FAILED', EMPTY_FILE);
  const decoded = decodeText(bytes);
  if (!decoded) throw new FundingError('UNSUPPORTED_FILE', NOT_TEXT);
  return { text: decoded.text.replace(/\r\n?/g, '\n'), warnings: decoded.guessed ? [GUESSED_ENCODING] : [] };
}

/**
 * The drafts that fit the character budget. Reading stops at the first block
 * that would pass it; if that is the very first block, its opening is kept so
 * an unbroken wall of text still yields something to work with.
 */
function withinBudget(drafts: DraftBlock[], maxCharacters: number): { kept: DraftBlock[]; cut: boolean } {
  const kept: DraftBlock[] = [];
  let characters = 0;
  for (const draft of drafts) {
    if (characters + draft.text.length > maxCharacters) {
      if (kept.length === 0) kept.push({ ...draft, text: cutAtWord(draft.text, maxCharacters) });
      return { kept, cut: true };
    }
    characters += draft.text.length;
    kept.push(draft);
  }
  return { kept, cut: false };
}

/** `stoppedEarly` says the source itself was not read to its end. */
function buildDocument(
  format: DocumentFormat,
  drafts: DraftBlock[],
  warnings: string[],
  budget: number,
  stoppedEarly: boolean,
): ExtractedDocument {
  const { kept, cut } = withinBudget(drafts, budget);
  if (cut || stoppedEarly) {
    warnings.push(
      `This file is very long, so only the first part was read (about ${budget.toLocaleString('en-US')} characters).`,
    );
  }
  const document = assembleDocument(format, kept, null, warnings);
  if (document.blocks.length === 0) throw new FundingError('EXTRACTION_FAILED', NO_TEXT);
  return document;
}

/** A title set in capitals on one or two lines of its own, as plain-text reports are laid out. */
function isCapitalsHeading(lines: readonly string[], text: string): boolean {
  if (lines.length > 2 || text.length > 80 || /[.!?,;]$/.test(text)) return false;
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  return letters >= 3 && text === text.toUpperCase() && text !== text.toLowerCase();
}

export function extractTxt(bytes: Uint8Array, options: TextOptions = {}): ExtractedDocument {
  const limits = withLimits(options.limits);
  const source = readSource(bytes);
  const drafts: DraftBlock[] = [];
  let run: string[] = [];
  let runLength = 0;
  let stoppedEarly = false;

  const flush = () => {
    if (run.length === 0) return;
    const text = cleanText(run.join(' '));
    drafts.push(
      isCapitalsHeading(run, text)
        ? { kind: 'heading', text, page: null, level: 1 }
        : { kind: 'paragraph', text, page: null },
    );
    run = [];
    runLength = 0;
  };
  // A paragraph is a run of lines with something to read in them. A blank line
  // ends it, and so does a rule drawn with dashes or other symbols.
  for (const line of source.text.split('\n')) {
    if (!hasContent(line)) {
      flush();
      continue;
    }
    run.push(cutAtWord(line, limits.maxCharacters));
    runLength += line.length;
    // One paragraph already holds more than may be kept: nothing after it can matter.
    if (runLength > limits.maxCharacters) {
      stoppedEarly = true;
      break;
    }
  }
  flush();
  return buildDocument('txt', drafts, source.warnings, limits.maxCharacters, stoppedEarly);
}

type MarkdownNode = ReturnType<typeof fromMarkdown>['children'][number];
type ParagraphNode = Extract<MarkdownNode, { type: 'paragraph' }>;

interface MarkdownOutput {
  drafts: DraftBlock[];
  htmlLeftOut: boolean;
  tooDeep: boolean;
}

/**
 * The words a reader of the rendered page would see. Raw HTML and image
 * descriptions are not among them, and a line break separates words.
 */
function visibleText(node: MarkdownNode, depth = 0): string {
  if (depth > MAX_MARKDOWN_DEPTH) return '';
  if (node.type === 'break' || node.type === 'html') return ' ';
  return 'children' in node
    ? (node.children as MarkdownNode[]).map((child) => visibleText(child, depth + 1)).join('')
    : nodeText(node, { includeImageAlt: false });
}

function inlineText(markdown: string): string {
  return cleanText(
    fromMarkdown(markdown)
      .children.map((child) => visibleText(child))
      .join(' '),
  );
}

function tableCells(line: string): string[] {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  return row.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|').trim());
}

function tableRow(line: string): DraftBlock {
  // Most cells are plain words and need no parsing, which matters in a table of thousands of rows.
  const cells = tableCells(line).map((cell) => (/[\\`*_[\]<>&!~]/.test(cell) ? inlineText(cell) : cleanText(cell)));
  while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
  return { kind: 'table_row', text: cleanText(cells.join(' | ')), page: null };
}

/**
 * Tables are not part of core Markdown, so one arrives as a paragraph whose
 * second line is a row of dashes. Its rows become blocks of their own.
 */
function addParagraph(node: ParagraphNode, source: string, out: MarkdownOutput, kind: BlockKind): void {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  const lines = start === undefined || end === undefined ? [] : source.slice(start, end).split('\n');
  const rule = lines.findIndex((line, index) => {
    const header = lines[index - 1];
    return (
      header !== undefined &&
      header.includes('|') &&
      line.includes('|') &&
      TABLE_RULE.test(line.trim()) &&
      tableCells(line).length === tableCells(header).length
    );
  });
  if (rule < 0) {
    out.drafts.push({ kind, text: cleanText(visibleText(node)), page: null });
    return;
  }
  if (rule > 1) out.drafts.push({ kind, text: inlineText(lines.slice(0, rule - 1).join('\n')), page: null });
  out.drafts.push(tableRow(lines[rule - 1]!));
  for (const line of lines.slice(rule + 1)) out.drafts.push(tableRow(line));
}

function collect(node: MarkdownNode, source: string, out: MarkdownOutput, kind: BlockKind, depth: number): void {
  if (depth > MAX_MARKDOWN_DEPTH) {
    out.tooDeep = true;
    return;
  }
  switch (node.type) {
    case 'heading':
      out.drafts.push({ kind: 'heading', text: cleanText(visibleText(node)), page: null, level: node.depth });
      return;
    case 'paragraph':
      addParagraph(node, source, out, kind);
      return;
    case 'code':
      out.drafts.push({ kind: 'paragraph', text: cleanText(node.value), page: null });
      return;
    case 'html':
      // A comment is invisible on the rendered page and is left out silently.
      if (!/^\s*<!--[\s\S]*-->\s*$/.test(node.value)) out.htmlLeftOut = true;
      return;
    case 'list':
    case 'blockquote':
      for (const child of node.children) collect(child, source, out, 'paragraph', depth + 1);
      return;
    case 'listItem':
      node.children.forEach((child, index) => {
        collect(child, source, out, index === 0 && child.type === 'paragraph' ? 'list_item' : 'paragraph', depth + 1);
      });
      return;
    default:
      return;
  }
}

/** Front matter starts the file and holds "key: value" lines; anything else between rules is text. */
function withoutFrontMatter(text: string): string {
  const match = FRONT_MATTER.exec(text);
  if (!match) return text;
  const inner = match[1] ?? '';
  return inner.trim() === '' || /^[A-Za-z_][\w.-]*\s*:/m.test(inner) ? text.slice(match[0].length) : text;
}

export function extractMarkdown(bytes: Uint8Array, options: TextOptions = {}): ExtractedDocument {
  const limits = withLimits(options.limits);
  const source = readSource(bytes);
  let body = withoutFrontMatter(source.text);
  // What cannot be kept is cut off before parsing, at a paragraph break where
  // there is one: the parser's time and memory depend on all it is given.
  const budget = Math.min(limits.maxCharacters, limits.maxMarkdownCharacters);
  const stoppedEarly = body.length > budget;
  if (stoppedEarly) {
    const paragraphBreak = body.lastIndexOf('\n\n', budget);
    body = body.slice(0, paragraphBreak > 0 ? paragraphBreak : budget);
  }
  const out: MarkdownOutput = { drafts: [], htmlLeftOut: false, tooDeep: false };
  for (const node of fromMarkdown(body).children) collect(node, body, out, 'paragraph', 0);
  if (out.tooDeep && !out.drafts.some((draft) => hasContent(draft.text))) {
    throw new FundingError('EXTRACTION_FAILED', ALL_TOO_DEEP);
  }

  const warnings = [...source.warnings];
  if (out.htmlLeftOut) warnings.push(HTML_LEFT_OUT);
  if (out.tooDeep) warnings.push(TOO_DEEP);
  return buildDocument('md', out.drafts, warnings, budget, stoppedEarly);
}
