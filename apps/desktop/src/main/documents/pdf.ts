// Text from a PDF, as blocks that each know their page and the headings above
// them.
//
// A PDF stores glyphs at positions, not paragraphs. The reader library turns
// those into lines; the rest is inferred here from where the lines sit and how
// large they are: which lines make one paragraph, which are headings, which are
// table rows, and which merely repeat at the top or bottom of every page. The
// rules lean towards doing less, because a missed heading costs little and a
// wrong one mislabels every citation beneath it.
//
// Nothing in a PDF is fetched or run. The reader is given the bytes and the
// options below, and only its text, bookmark and structure calls are used.

import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { FundingError, isFundingError } from '../funding/errors.js';
import { withLimits, type ExtractionLimits } from './limits.js';
import { loadPdfjs, type PdfJs } from './pdfjs-loader.js';
import { assembleDocument, cleanText, EMPTY_FILE, hasContent, type DraftBlock } from './text.js';
import type { ExtractedDocument } from './types.js';

const PASSWORD_PROTECTED =
  'This PDF is password-protected, so it could not be read. Remove the password, or save an unprotected copy, and upload it again.';
const DAMAGED =
  'This file is damaged or is not a valid PDF, so it could not be read. Try saving a new copy of it, or upload the original document.';
const UNREADABLE = 'This PDF could not be read. Try saving a new copy of it, or upload the original document.';
const NO_TEXT =
  'This PDF has no selectable text, so there is nothing to read. It is probably a scan or a set of images, which cannot be read yet. Upload a text-based PDF or the original document instead.';
const FORM_FIELDS =
  'This PDF has fillable form fields. Anything typed into them was not read; only the text printed on its pages was.';
const COPY_RESTRICTED = 'The author of this PDF restricted copying its text.';

/** A page with fewer characters than this has nothing on it worth calling text. */
const MIN_PAGE_CHARACTERS = 12;
/** A line this much larger than body text is a heading; 13 pt over 11.5 pt counts. */
const HEADING_SIZE_RATIO = 1.12;
/** Sizes closer than this, in points, are the same heading level. */
const SAME_LEVEL_POINTS = 0.5;
/** If more lines than this would be headings, the guess about body text was wrong. */
const MAX_HEADING_SHARE = 0.4;
/** Gap between baselines, in text sizes, that starts a paragraph when line spacing is unknown. */
const DEFAULT_PARAGRAPH_GAP = 1.75;
/** With a measured line spacing, a gap this many times larger starts a paragraph. */
const PARAGRAPH_GAP_FACTOR = 1.25;
/** A line filling this share of the text width runs on to the next one. */
const FULL_LINE = 0.85;
/** Text set apart on one line by this many text sizes sits in another column. */
const COLUMN_GAP = 2;
/** A run this much smaller than its neighbour, and lifted this far, is a raised note mark. */
const RAISED_SIZE = 0.8;
const RAISED_LIFT = 0.15;
const RUNNING_LINE_MAX_CHARACTERS = 120;
const RUNNING_LINE_PAGE_SHARE = 0.6;
const RUNNING_LINE_MIN_PAGES = 3;
/** Pages shorter than this, in lines, are never trimmed. */
const MIN_LINES_TO_TRIM = 6;
/** Trimming never removes more than this share of a page's text. */
const MAX_TRIM_SHARE = 0.3;
const MAX_BOOKMARKS = 5_000;
const MAX_TAG_DEPTH = 64;
const MAX_PAGES_LISTED = 10;

/** Lines from a table of contents: a title, a row of dots, a page number. */
const DOT_LEADER = /\.{4,}|(?:\. ){3,}|…{2,}/u;
const SENTENCE_END = /[.!?:;。！？…]["'”’»)\]]*$/u;
/** What sits before the gap in "1.  Purpose" or "(a)  The applicant": a label, not a table cell. */
const LIST_MARKER = /^(?:[•◦▪▫‣⁃∙●○■□·*–—-]|\(?(?:\d{1,3}|[a-z]{1,4})[.)]|\d{1,3}(?:\.\d{1,3}){1,4}\.?)$/iu;
const BULLET = /^[•◦▪▫‣⁃∙●○■□·]\s+/u;
const SECTION_NUMBER = /^\s*(?:\d+(?:\.\d+)*\.?|[A-Z]\.|[IVXLC]+\.)\s+/;
/** Built from its code so that no invisible character sits in this file. */
const SOFT_HYPHEN = String.fromCharCode(0xad);
/** Stands for marked content that the PDF calls an artifact rather than part of the document. */
const FURNITURE = Symbol('furniture');

export interface PdfOptions {
  signal?: AbortSignal;
  limits?: Partial<ExtractionLimits>;
}

/** One heading. Lines that share a group are the same heading wrapped onto several lines. */
interface HeadingMark {
  level: number;
  group: number;
}

interface Line {
  text: string;
  page: number;
  /** Where the baseline sits across the page; larger is higher up. */
  top: number;
  left: number;
  right: number;
  size: number;
  /** Cells set apart by wide gaps: a table row or a form line. */
  row: boolean;
  /** Where the last cell of a row starts, so that a line wrapped within that cell can be told. */
  lastCell: number;
  /** The heading this line belongs to according to the PDF's own structure tags. */
  tag: HeadingMark | null;
  /** Marked by the PDF itself as page furniture: a header, footer, page number or watermark. */
  furniture: boolean;
  heading: HeadingMark | null;
}

interface TextRun {
  str: string;
  dir: string;
  width: number;
  height: number;
  transform: unknown[];
  hasEOL: boolean;
}

interface LineDraft {
  text: string;
  top: number;
  left: number;
  right: number;
  sizes: Map<number, number>;
  marks: Map<HeadingMark, number>;
  ink: number;
  furnitureInk: number;
  /** Offsets in `text` where a new cell starts. */
  cells: number[];
  lastCell: number;
  lastStart: number;
  lastEnd: number;
  lastSize: number;
  lastTop: number;
}

interface Placement {
  start: number;
  end: number;
  top: number;
  size: number;
}

interface Counter {
  next: number;
}

/**
 * How every PDF is opened. The bytes are handed over directly, so the reader
 * never chooses what to load, and the only location it is given is the folder
 * of character maps that ships with it. Forms that carry scripts are not
 * expanded, and nothing that draws is switched on: no fonts, no image decoders,
 * no WebAssembly.
 */
export function pdfOpenOptions(pdfjs: Pick<PdfJs, 'VerbosityLevel'>, bytes: Uint8Array, cMapUrl: string) {
  return {
    // A plain copy: the reader rejects Node Buffers and takes over what it is given.
    data: new Uint8Array(bytes),
    verbosity: pdfjs.VerbosityLevel.ERRORS,
    cMapUrl,
    cMapPacked: true,
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    useWasm: false,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    disableAutoFetch: true,
    disableRange: true,
    disableStream: true,
    stopAtErrors: false,
    // Not an option in this version of the reader; essential if an older one is ever pinned.
    isEvalSupported: false,
  };
}

export async function extractPdf(bytes: Uint8Array, options: PdfOptions = {}): Promise<ExtractedDocument> {
  const limits = withLimits(options.limits);
  if (bytes.byteLength === 0) throw new FundingError('EXTRACTION_FAILED', EMPTY_FILE);
  const { pdfjs, cMapUrl } = await loadPdfjs();
  const task = pdfjs.getDocument(pdfOpenOptions(pdfjs, bytes, cMapUrl));
  try {
    let doc: PDFDocumentProxy;
    try {
      doc = await task.promise;
    } catch (error) {
      throw openFailure(error);
    }
    return await read(pdfjs, doc, limits, options.signal);
  } catch (error) {
    // The reader's own messages can name internals; only ours are passed on.
    if (isFundingError(error)) throw error;
    throw new FundingError('EXTRACTION_FAILED', UNREADABLE);
  } finally {
    await task.destroy().catch(() => {});
  }
}

function openFailure(error: unknown): FundingError {
  // Told apart by name: older versions of the reader do not export these classes.
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'PasswordException') return new FundingError('EXTRACTION_FAILED', PASSWORD_PROTECTED);
  if (name === 'InvalidPDFException') return new FundingError('EXTRACTION_FAILED', DAMAGED);
  return new FundingError('EXTRACTION_FAILED', UNREADABLE);
}

async function read(
  pdfjs: PdfJs,
  doc: PDFDocumentProxy,
  limits: ExtractionLimits,
  signal: AbortSignal | undefined,
): Promise<ExtractedDocument> {
  const pageCount = doc.numPages;
  if (pageCount > limits.maxPages) {
    throw new FundingError(
      'EXTRACTION_FAILED',
      `This PDF has ${count(pageCount)} pages, and the most that can be read is ${count(limits.maxPages)}. Split it into smaller files and upload them separately.`,
    );
  }

  const tagged = await isTagged(doc);
  const groups: Counter = { next: 1 };
  let pages: Line[][] = [];
  const unreadable: number[] = [];
  let characters = 0;
  for (let number = 1; number <= pageCount && characters < limits.maxCharacters; number += 1) {
    if (signal?.aborted) throw new FundingError('CANCELLED', 'Cancelled.');
    let lines: Line[] = [];
    try {
      const page = await doc.getPage(number);
      try {
        lines = await readPage(page, number, tagged, groups);
      } finally {
        page.cleanup();
      }
    } catch {
      unreadable.push(number);
    }
    pages.push(lines);
    for (const line of lines) characters += line.text.length;
    // Lets a cancellation or a timeout through when this runs outside a worker.
    if (number % 8 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
  }

  if (unreadable.length === pages.length) throw new FundingError('EXTRACTION_FAILED', DAMAGED);
  pages = withoutDeclaredFurniture(pages);
  if (pages.every((lines) => inkOn(lines) < MIN_PAGE_CHARACTERS)) throw new FundingError('EXTRACTION_FAILED', NO_TEXT);

  const warnings: string[] = [];
  if (pages.length < pageCount) {
    warnings.push(
      pages.length === 1
        ? 'This PDF is very long, so only its first page was read.'
        : `This PDF is very long, so only its first ${count(pages.length)} pages were read.`,
    );
  }
  if (unreadable.length > 0) {
    warnings.push(pagesSentence(unreadable, 'could not be read and was skipped', 'could not be read and were skipped'));
  }
  const blank = pages.flatMap((lines, index) => (lines.length === 0 && !unreadable.includes(index + 1) ? [index + 1] : []));
  if (blank.length > 0) {
    warnings.push(pagesSentence(blank, 'has no readable text and was skipped', 'have no readable text and were skipped'));
  }

  const trimmed = withoutRunningLines(pages);
  pages = trimmed.pages;
  if (trimmed.removed.length > 0) {
    warnings.push(`Lines that repeat on most pages, such as page headers and footers, were left out: ${quoted(trimmed.removed)}.`);
  }

  const all = pages.flat();
  const body = bodySize(all);
  if (!(await markFromBookmarks(doc, pages, groups)) && !markFromTags(all)) markFromSize(pages, body, groups);

  warnings.push(...(await documentNotes(pdfjs, doc)));
  return assembleDocument('pdf', toDrafts(pages, lineSpacing(pages, body)), pageCount, warnings);
}

async function isTagged(doc: PDFDocumentProxy): Promise<boolean> {
  // A Map in this version of the reader, a plain object in older ones.
  const info: unknown = await doc.getMarkInfo().catch(() => null);
  if (info instanceof Map) return info.get('Marked') === true;
  return (info as { Marked?: unknown } | null)?.Marked === true;
}

async function readPage(page: PDFPageProxy, number: number, tagged: boolean, groups: Counter): Promise<Line[]> {
  const content = await page.getTextContent({ includeMarkedContent: tagged, disableNormalization: false });
  return toLines(content.items, number, tagged ? await headingTags(page, groups) : null);
}

/** Which pieces of marked content the page's structure tags call a heading. */
async function headingTags(page: PDFPageProxy, groups: Counter): Promise<Map<string, HeadingMark>> {
  const found = new Map<string, HeadingMark>();
  const tree: unknown = await page.getStructTree().catch(() => null);
  const visit = (node: unknown, mark: HeadingMark | null, depth: number): void => {
    if (!node || typeof node !== 'object' || depth > MAX_TAG_DEPTH) return;
    const { role, children, type, id } = node as { role?: unknown; children?: unknown; type?: unknown; id?: unknown };
    if (type === 'content') {
      if (mark && typeof id === 'string') found.set(id, mark);
      return;
    }
    const level = typeof role === 'string' ? tagLevel(role) : null;
    const inner = level === null ? mark : { level, group: groups.next++ };
    if (Array.isArray(children)) for (const child of children) visit(child, inner, depth + 1);
  };
  visit(tree, null, 0);
  return found;
}

function tagLevel(role: string): number | null {
  const numbered = /^H([1-6])$/.exec(role);
  if (numbered) return Number(numbered[1]);
  return role === 'H' || role === 'Title' ? 1 : null;
}

function isTextRun(item: object): item is TextRun {
  return typeof (item as { str?: unknown }).str === 'string';
}

function emptyDraft(): LineDraft {
  return {
    text: '',
    top: Number.NaN,
    left: 0,
    right: 0,
    sizes: new Map(),
    marks: new Map(),
    ink: 0,
    furnitureInk: 0,
    cells: [],
    lastCell: 0,
    lastStart: 0,
    lastEnd: 0,
    lastSize: 0,
    lastTop: 0,
  };
}

function toLines(items: readonly object[], page: number, tags: Map<string, HeadingMark> | null): Line[] {
  const lines: Line[] = [];
  // Marked content that is open, innermost last: the heading it belongs to,
  // page furniture, or null for anything else.
  const open: (HeadingMark | typeof FURNITURE | null)[] = [];
  let unopened = 0;
  let furniture = 0;
  let draft = emptyDraft();
  const flush = () => {
    const line = finishLine(draft, page);
    if (line) lines.push(line);
    draft = emptyDraft();
  };

  for (const item of items) {
    if (!isTextRun(item)) {
      const mark = item as { type?: string; id?: string; tag?: string };
      if (mark.type === 'endMarkedContent') {
        if (unopened > 0) unopened -= 1;
        else if (open.pop() === FURNITURE) furniture -= 1;
      } else if (mark.type?.startsWith('beginMarkedContent')) {
        // Real pages nest a few levels; a file that nests without end is only counted.
        if (open.length >= MAX_TAG_DEPTH) {
          unopened += 1;
        } else if (mark.tag === 'Artifact') {
          open.push(FURNITURE);
          furniture += 1;
        } else {
          open.push((mark.id ? tags?.get(mark.id) : null) ?? null);
        }
      }
      continue;
    }
    if (item.str.trim() !== '') {
      const place = placementOf(item);
      // The reader reports no line end where text is drawn from a separate
      // piece of the page, as stamped footers and watermarks are. A run more
      // than a line away from the one before it starts a new line regardless.
      if (!Number.isNaN(draft.top) && Math.abs(place.top - draft.lastTop) > Math.max(place.size, draft.lastSize)) flush();
      // The reader marks the end of a line on an empty run placed inside
      // whatever comes next, so a run's heading is taken as it is added.
      const heading = open.findLast((mark): mark is HeadingMark => mark !== null && mark !== FURNITURE) ?? null;
      addInk(draft, item, place, heading, furniture > 0);
    }
    draft.text += item.str;
    if (item.hasEOL) flush();
  }
  flush();
  return lines;
}

/**
 * Where a run sits, measured along and across the text's own direction, so
 * that a page set sideways reads the same as an upright one.
 */
function placementOf(run: TextRun): Placement {
  const at = (index: number) => Number(run.transform[index]) || 0;
  const across = Math.hypot(at(0), at(1));
  const up = Math.hypot(at(2), at(3));
  const start = across > 0 ? (at(4) * at(0) + at(5) * at(1)) / across : at(4);
  return {
    start,
    end: start + Math.abs(Number(run.width) || 0),
    top: up > 0 ? (at(4) * at(2) + at(5) * at(3)) / up : at(5),
    size: Math.round((Number(run.height) || up) * 10) / 10,
  };
}

/** Notes a visible run's place in the line. Its text is added by the caller. */
function addInk(draft: LineDraft, run: TextRun, place: Placement, mark: HeadingMark | null, furniture: boolean): void {
  if (Number.isNaN(draft.top)) {
    draft.top = place.top;
    draft.left = place.start;
    draft.right = place.end;
  } else {
    const size = Math.max(place.size, draft.lastSize);
    // Set well to the right of the last run, or back to the left of it: text
    // that shares a baseline with its neighbour without continuing it.
    const apart = place.start - draft.lastEnd >= COLUMN_GAP * size || place.start < draft.lastStart - size / 2;
    // A footnote mark printed against a figure would otherwise become its last digit.
    const raised = place.size <= draft.lastSize * RAISED_SIZE && place.top - draft.lastTop >= draft.lastSize * RAISED_LIFT;
    const cell = apart && run.dir === 'ltr';
    if ((cell || raised) && /\S$/u.test(draft.text)) draft.text += ' ';
    if (cell) {
      draft.cells.push(draft.text.length);
      draft.lastCell = place.start;
    }
    draft.left = Math.min(draft.left, place.start);
    draft.right = Math.max(draft.right, place.end);
  }
  draft.lastStart = place.start;
  draft.lastEnd = place.end;
  draft.lastSize = place.size;
  draft.lastTop = place.top;
  draft.sizes.set(place.size, (draft.sizes.get(place.size) ?? 0) + run.str.length);
  draft.ink += run.str.length;
  if (furniture) draft.furnitureInk += run.str.length;
  if (mark) draft.marks.set(mark, (draft.marks.get(mark) ?? 0) + run.str.length);
}

function finishLine(draft: LineDraft, page: number): Line | null {
  if (Number.isNaN(draft.top)) return null;
  // A soft hyphen is only ever drawn at the end of a line, where it shows as a hyphen.
  const raw = draft.text.trimEnd();
  const text = cleanText(raw.endsWith(SOFT_HYPHEN) ? `${raw.slice(0, -1)}-` : raw, 'NFKC');
  if (!hasContent(text)) return null;

  let size = 0;
  let most = -1;
  for (const [candidate, characters] of draft.sizes) {
    if (characters > most) {
      size = candidate;
      most = characters;
    }
  }
  let tag: HeadingMark | null = null;
  for (const [mark, characters] of draft.marks) if (characters * 2 > draft.ink) tag = mark;

  const label = draft.cells.length === 1 ? cleanText(draft.text.slice(0, draft.cells[0]), 'NFKC') : '';
  const row = draft.cells.length > 1 || (draft.cells.length === 1 && !LIST_MARKER.test(label));
  const furniture = draft.furnitureInk * 2 > draft.ink;
  return {
    text,
    page,
    top: draft.top,
    left: draft.left,
    right: draft.right,
    size,
    row,
    lastCell: draft.lastCell,
    tag,
    furniture,
    heading: null,
  };
}

function inkOn(lines: readonly Line[]): number {
  let characters = 0;
  for (const line of lines) characters += line.text.split(' ').join('').length;
  return characters;
}

/** The text size most of the document is set in. */
function bodySize(lines: readonly Line[]): number {
  const weight = new Map<number, number>();
  for (const line of lines) weight.set(line.size, (weight.get(line.size) ?? 0) + line.text.length);
  let size = 0;
  let most = -1;
  for (const [candidate, characters] of weight) {
    if (characters > most) {
      size = candidate;
      most = characters;
    }
  }
  return size;
}

function sameSize(size: number, reference: number): boolean {
  return Math.abs(size - reference) <= Math.max(0.5, reference * 0.05);
}

/**
 * Leaves out what the PDF itself marks as page furniture. A file that marks a
 * large share of its text that way is marking it wrongly, and is not believed.
 */
function withoutDeclaredFurniture(pages: Line[][]): Line[][] {
  let marked = 0;
  let total = 0;
  for (const lines of pages) {
    for (const line of lines) {
      total += line.text.length;
      if (line.furniture) marked += line.text.length;
    }
  }
  if (marked === 0 || marked > total * MAX_TRIM_SHARE) return pages;
  return pages.map((lines) => lines.filter((line) => !line.furniture));
}

/**
 * Drops page headers, footers and page numbers. A line goes only if it is one
 * of the first or last two on its page (in reading order or by position), is
 * short, and recurs, digits aside, on most pages. Short pages are left alone,
 * and so is any page that would lose a large share of its text: without those
 * two guards a form that starts every page the same way would be emptied.
 */
function withoutRunningLines(pages: Line[][]): { pages: Line[][]; removed: string[] } {
  const pagesWithText = pages.filter((lines) => lines.length > 0).length;
  const needed = Math.max(RUNNING_LINE_MIN_PAGES, Math.ceil(pagesWithText * RUNNING_LINE_PAGE_SHARE));

  const edges = pages.map(edgeLines);
  const seenOn = new Map<string, number>();
  for (const edge of edges) {
    for (const key of new Set([...edge].map(runningKey))) seenOn.set(key, (seenOn.get(key) ?? 0) + 1);
  }

  const removed = new Map<string, string>();
  const kept = pages.map((lines, index) => {
    if (lines.length < MIN_LINES_TO_TRIM) return lines;
    const drop = [...(edges[index] ?? [])].filter((line) => (seenOn.get(runningKey(line)) ?? 0) >= needed);
    if (drop.length === 0) return lines;
    const dropped = drop.reduce((total, line) => total + line.text.length, 0);
    const total = lines.reduce((sum, line) => sum + line.text.length, 0);
    if (dropped > total * MAX_TRIM_SHARE) return lines;
    for (const line of drop) {
      const key = runningKey(line);
      // Bare page numbers are not worth a warning.
      if (hasContent(key) && !removed.has(key)) removed.set(key, line.text);
    }
    return lines.filter((line) => !drop.includes(line));
  });
  return { pages: kept, removed: [...removed.values()] };
}

function edgeLines(lines: readonly Line[]): Set<Line> {
  const byHeight = [...lines].sort((first, second) => second.top - first.top);
  const edge = new Set<Line>([...lines.slice(0, 2), ...lines.slice(-2), ...byHeight.slice(0, 2), ...byHeight.slice(-2)]);
  for (const line of edge) if (line.text.length > RUNNING_LINE_MAX_CHARACTERS) edge.delete(line);
  return edge;
}

/** "Page 3 of 12" and "Page 4 of 12" are the same running line. */
function runningKey(line: Line): string {
  return line.text.replace(/\p{Nd}+/gu, '').replace(/\s+/gu, ' ').trim().toLowerCase();
}

interface Bookmark {
  title: string;
  level: number;
  dest: unknown;
}

/**
 * Headings from the PDF's bookmarks, when it has them and their titles can be
 * found on the pages they point to. A bookmark is never turned into text of its
 * own: it only says which lines already on the page are a heading.
 */
async function markFromBookmarks(doc: PDFDocumentProxy, pages: readonly Line[][], groups: Counter): Promise<boolean> {
  const bookmarks = flattenOutline(await doc.getOutline().catch(() => null));
  let located = 0;
  const marked: Line[] = [];
  let placed = 0;
  for (const bookmark of bookmarks) {
    const pageNumber = await bookmarkPage(doc, bookmark.dest);
    const lines = pageNumber === null ? undefined : pages[pageNumber - 1];
    if (!lines) continue;
    located += 1;
    const match = findTitle(lines, bookmark.title);
    if (!match) continue;
    placed += 1;
    const mark = { level: bookmark.level, group: groups.next++ };
    for (const line of match) {
      line.heading = mark;
      marked.push(line);
    }
  }
  // Bookmarks that mostly cannot be found are not describing this text.
  if (placed > 0 && placed * 2 >= located) return true;
  for (const line of marked) line.heading = null;
  return false;
}

function flattenOutline(outline: unknown): Bookmark[] {
  const found: Bookmark[] = [];
  const visit = (items: unknown, level: number): void => {
    if (!Array.isArray(items) || level > 9) return;
    for (const item of items) {
      if (found.length >= MAX_BOOKMARKS) return;
      const { title, dest, items: children } = (item ?? {}) as { title?: unknown; dest?: unknown; items?: unknown };
      if (typeof title === 'string' && hasContent(title)) found.push({ title, level, dest });
      visit(children, level + 1);
    }
  };
  visit(outline, 1);
  return found;
}

async function bookmarkPage(doc: PDFDocumentProxy, dest: unknown): Promise<number | null> {
  try {
    const target: unknown = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
    const first: unknown = Array.isArray(target) ? target[0] : null;
    if (typeof first === 'number' && Number.isInteger(first)) return first + 1;
    if (first && typeof first === 'object') return (await doc.getPageIndex(first as { num: number; gen: number })) + 1;
  } catch {
    // A bookmark that points nowhere is simply not used.
  }
  return null;
}

function titleKey(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Bookmarks and headings often differ only in punctuation or a section number. */
function sameTitle(first: string, second: string): boolean {
  if (titleKey(first) === titleKey(second)) return true;
  const bare = titleKey(first.replace(SECTION_NUMBER, ''));
  return bare.length >= 3 && bare === titleKey(second.replace(SECTION_NUMBER, ''));
}

function findTitle(lines: readonly Line[], title: string): Line[] | null {
  let best: Line[] | null = null;
  for (let start = 0; start < lines.length; start += 1) {
    let joined = '';
    for (let end = start; end < Math.min(lines.length, start + 3); end += 1) {
      const line = lines[end]!;
      if (line.heading || line.row) break;
      joined = `${joined} ${line.text}`.trim();
      if (!sameTitle(joined, title)) continue;
      // A running header often repeats the chapter title; the title itself is set larger.
      if (!best || lines[start]!.size > best[0]!.size) best = lines.slice(start, end + 1);
      break;
    }
  }
  return best;
}

function markFromTags(lines: readonly Line[]): boolean {
  const tagged = lines.filter((line) => line.tag && !line.row);
  if (tagged.length === 0 || tagged.length > lines.length * MAX_HEADING_SHARE) return false;
  for (const line of tagged) line.heading = line.tag;
  return true;
}

/**
 * Headings guessed from text size, for PDFs that say nothing about their own
 * structure. Larger sizes are higher levels.
 */
function markFromSize(pages: readonly Line[][], body: number, groups: Counter): boolean {
  const isLarge = (line: Line) =>
    !line.row &&
    line.size >= body * HEADING_SIZE_RATIO &&
    !DOT_LEADER.test(line.text) &&
    (line.text.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 2;
  const all = pages.flat();
  const large = all.filter(isLarge);
  if (large.length === 0 || large.length > all.length * MAX_HEADING_SHARE) return false;

  const levels = new Map<number, number>();
  let level = 0;
  let largestInLevel = Number.POSITIVE_INFINITY;
  for (const size of [...new Set(large.map((line) => line.size))].sort((first, second) => second - first)) {
    if (largestInLevel - size > SAME_LEVEL_POINTS) {
      level += 1;
      largestInLevel = size;
    }
    levels.set(size, level);
  }

  for (const lines of pages) {
    let above: Line | null = null;
    for (const line of lines) {
      if (!isLarge(line)) {
        above = null;
        continue;
      }
      const lineLevel = levels.get(line.size) ?? 1;
      const gap = above ? above.top - line.top : 0;
      const wraps = above?.heading?.level === lineLevel && gap > 0 && gap <= DEFAULT_PARAGRAPH_GAP * line.size;
      line.heading = wraps && above?.heading ? above.heading : { level: lineLevel, group: groups.next++ };
      above = line;
    }
  }
  return true;
}

/**
 * The document's line spacing, in text sizes, measured where one line certainly
 * runs on to the next: it reaches the margin and does not end a sentence. Null
 * when there are too few such lines to tell, as in a document made of lists.
 */
function lineSpacing(pages: readonly Line[][], body: number): number | null {
  const samples: number[] = [];
  for (const lines of pages) {
    let left = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    for (const line of lines) {
      if (line.row || !sameSize(line.size, body)) continue;
      left = Math.min(left, line.left);
      right = Math.max(right, line.right);
    }
    for (let index = 1; index < lines.length; index += 1) {
      const above = lines[index - 1]!;
      const below = lines[index]!;
      if (above.row || below.row || above.heading || below.heading) continue;
      if (!sameSize(above.size, body) || !sameSize(below.size, body)) continue;
      const gap = (above.top - below.top) / body;
      if (!(gap > 0.6 && gap < 3.2)) continue;
      if (above.right - left < (right - left) * FULL_LINE || SENTENCE_END.test(above.text)) continue;
      samples.push(gap);
    }
  }
  if (samples.length < 3) return null;
  // Whatever is mistaken for a continuation is a wider gap, never a narrower one.
  samples.sort((first, second) => first - second);
  return samples[Math.floor((samples.length - 1) / 4)] ?? null;
}

/** Whether `below` starts a block of its own rather than carrying on the one that `first` opened. */
function startsNewBlock(first: Line, above: Line, below: Line, spacing: number | null): boolean {
  if (below.row) return true;
  if (above.heading || below.heading) return above.heading?.group !== below.heading?.group;
  if (!sameSize(above.size, below.size) || BULLET.test(below.text)) return true;
  const size = Math.max(above.size, below.size);
  // A row is carried on only by lines set under its last cell, where that cell's text has wrapped.
  if (first.row && Math.abs(below.left - first.lastCell) > size) return true;
  const gap = above.top - below.top;
  // The next line sits higher up: the top of another column, or a box placed elsewhere.
  if (gap < -size / 2) return true;
  return gap > size * (spacing === null ? DEFAULT_PARAGRAPH_GAP : spacing * PARAGRAPH_GAP_FACTOR);
}

function toDraft(lines: readonly Line[]): DraftBlock {
  const first = lines[0]!;
  const text = lines.map((line) => line.text).join(' ');
  if (first.heading) return { kind: 'heading', text, page: first.page, level: first.heading.level };
  if (first.row) return { kind: 'table_row', text, page: first.page };
  const bullet = BULLET.exec(text);
  if (bullet) return { kind: 'list_item', text: text.slice(bullet[0].length), page: first.page };
  return { kind: 'paragraph', text, page: first.page };
}

/** Paragraphs never run across a page: each block has to name one page. */
function toDrafts(pages: readonly Line[][], spacing: number | null): DraftBlock[] {
  const drafts: DraftBlock[] = [];
  for (const lines of pages) {
    let group: Line[] = [];
    for (const line of lines) {
      const first = group[0];
      const above = group[group.length - 1];
      if (first && above && startsNewBlock(first, above, line, spacing)) {
        drafts.push(toDraft(group));
        group = [];
      }
      group.push(line);
    }
    if (group.length > 0) drafts.push(toDraft(group));
  }
  return drafts;
}

/** What the PDF says about itself that changes how far its text can be trusted. */
async function documentNotes(pdfjs: PdfJs, doc: PDFDocumentProxy): Promise<string[]> {
  const notes: string[] = [];
  const metadata = await doc.getMetadata().catch(() => null);
  const info = (metadata?.info ?? {}) as Record<string, unknown>;
  if (info.IsAcroFormPresent === true || info.IsXFAPresent === true) notes.push(FORM_FIELDS);

  // A Set in this version of the reader, an array in older ones; null when nothing is restricted.
  const permissions: unknown = await doc.getPermissions().catch(() => null);
  if (permissions instanceof Set || Array.isArray(permissions)) {
    if (![...permissions].includes(pdfjs.PermissionFlag.COPY)) notes.push(COPY_RESTRICTED);
  }
  return notes;
}

function count(value: number): string {
  return value.toLocaleString('en-US');
}

function quoted(texts: readonly string[]): string {
  const shown = texts.slice(0, 3).map((text) => `"${text}"`);
  const more = texts.length - shown.length;
  return more > 0 ? `${shown.join(', ')} and ${count(more)} more` : joinWithAnd(shown);
}

function joinWithAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** "Pages 3 and 7 have …", with long runs written as ranges and long lists cut short. */
function pagesSentence(numbers: readonly number[], singular: string, plural: string): string {
  const parts: { label: string; pages: number }[] = [];
  for (let start = 0; start < numbers.length; ) {
    let end = start;
    while (end + 1 < numbers.length && numbers[end + 1] === numbers[end]! + 1) end += 1;
    if (end - start >= 2) {
      parts.push({ label: `${numbers[start]}–${numbers[end]}`, pages: end - start + 1 });
    } else {
      for (let index = start; index <= end; index += 1) parts.push({ label: String(numbers[index]), pages: 1 });
    }
    start = end + 1;
  }
  const shown = parts.slice(0, MAX_PAGES_LISTED);
  const hidden = parts.slice(MAX_PAGES_LISTED).reduce((total, part) => total + part.pages, 0);
  const labels = shown.map((part) => part.label);
  const list = hidden > 0 ? `${labels.join(', ')} and ${count(hidden)} more` : joinWithAnd(labels);
  return numbers.length === 1 ? `Page ${list} ${singular}.` : `Pages ${list} ${plural}.`;
}
