// Text from a Word document (.docx), as headings, paragraphs, list items and
// table rows.
//
// A .docx is a zip of XML parts, and both layers are read defensively because
// the file comes from outside. The zip is opened from memory and its entries
// are looked up by name in a table: nothing is ever unpacked to disk, so an
// entry's name cannot point anywhere. An entry is refused if it is encrypted,
// packed in an unusual way, listed twice, or larger than the limits allow,
// whether by what it declares or by what it unpacks to. A part is refused if it
// declares a document type, which is the only way XML can define entities or
// name outside files. Links to outside files are never followed, only counted.
//
// The walk over the body is done here rather than by a library so that headings
// come from the document's styles, tables keep their rows, and text a reader
// cannot see (deleted, hidden, field codes) stays out.

import type { Readable } from 'node:stream';
import { SaxesParser, type SaxesTagNS } from 'saxes';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import { FundingError, isFundingError } from '../funding/errors.js';
import { withLimits, type ExtractionLimits } from './limits.js';
import { assembleDocument, cleanText, cutAtWord, EMPTY_FILE, hasContent, type DraftBlock } from './text.js';
import type { BlockKind, ExtractedDocument } from './types.js';

export const LEGACY_OR_PROTECTED_WORD =
  'This file is either a password-protected Word document or an older Word file. Save it as an unprotected Word document (.docx) or a PDF and upload it again.';
export const NOT_A_WORD_DOCUMENT =
  'This file is named as a Word document, but its contents are not one. Open it in Word, save it as a Word document (.docx) or a PDF, and upload that.';
const DAMAGED =
  'This Word document is damaged or incomplete, so it could not be read. Open it in Word, save a new copy and upload that.';
const UNSAFE =
  'This Word document is put together in an unusual way that is not safe to open, so it was not read. Open it in Word, save a new copy and upload that.';
const TOO_LARGE =
  'This Word document unpacks to more than can be read. Split it into smaller documents and upload them separately.';
const NO_TEXT =
  'This Word document has no readable text. If its content is pictures or scans, upload a version with typed text instead.';
const INFERRED_HEADINGS =
  'This document does not use heading styles, so its section headings were worked out from bold and larger text and may be imperfect.';
const MISSING_NOTES = 'Some footnotes in this document could not be found and were left out.';
const FOREIGN_CONTENT = 'Part of this document is stored inside it in another format and was not read.';

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
/** The container of older .doc files, and of .docx files saved with a password. */
const LEGACY_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

// Each namespace has a transitional and a strict form; documents use either.
const WORD_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main',
]);
const MATH_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/math',
  'http://purl.oclc.org/ooxml/officeDocument/math',
]);
const CHART_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/drawingml/2006/chart',
  'http://purl.oclc.org/ooxml/drawingml/chart',
]);
const DIAGRAM_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/drawingml/2006/diagram',
  'http://purl.oclc.org/ooxml/drawingml/diagram',
]);
const COMPATIBILITY_NAMESPACE = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const RELATIONSHIPS_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_NAMESPACE = 'urn:schemas-microsoft-com:office:office';

/**
 * Elements whose runs are not text a reader sees: deletions and moved-away
 * text, phonetic guides, and the older copy of a drawing kept for programs that
 * cannot show the newer one (reading both would say it twice). Field codes and
 * properly marked deleted text need no entry: text is only ever taken from the
 * elements that hold visible text.
 */
const UNREAD = new Set(['w:del', 'w:moveFrom', 'w:rt', 'mc:Fallback']);

// Built-in styles are known by their English name or id. Which of the two a
// file translates depends on the edition of Word that saved it: one writes
// "heading 3" with the id "berschrift3", another "Nadpis 1" with the id
// "Heading1". The patterns fit both spellings and are tried on both.
const HEADING_STYLE = /^heading ?([1-9])$/i;
const TITLE_STYLE = /^title$/i;
const CONTENTS_STYLE = /^toc ?(?:[1-9]|heading)$/i;
const LIST_STYLE = /^list ?(?:paragraph|bullet|number) ?\d?$/i;
const MAX_STYLE_HOPS = 24;
/** Text size, in half-points, when neither the run nor any style gives one. */
const FALLBACK_SIZE = 20;

const INFERRED_HEADING_MAX_CHARACTERS = 120;
const INFERRED_HEADING_SIZE_RATIO = 1.15;
const INFERRED_HEADING_MAX_SHARE = 0.4;

// Symbols inserted from a picture font, which are stored as a code rather than
// a character. Only the ones whose meaning is certain; a wrong tick in a
// checkbox would be a wrong fact.
const SYMBOLS: Record<string, Record<number, string>> = {
  wingdings: {
    0x6c: '●', 0x6e: '■', 0x6f: '□', 0xa7: '▪', 0xa8: '☐', 0xd8: '➢', 0xe0: '→',
    0xfb: '✗', 0xfc: '✓', 0xfd: '☒', 0xfe: '☑',
  },
  'wingdings 2': { 0x50: '✓', 0x52: '☑', 0x54: '☒', 0xa3: '☐' },
  symbol: {
    0xa3: '≤', 0xae: '→', 0xb0: '°', 0xb1: '±', 0xb3: '≥', 0xb4: '×', 0xb7: '•', 0xb8: '÷',
    0xb9: '≠', 0xbb: '≈', 0xd2: '®', 0xd3: '©', 0xd4: '™',
  },
};

/** Thrown by a visitor that has read as much as the limits allow. */
class BudgetSpent extends Error {}

export interface DocxOptions {
  signal?: AbortSignal;
  limits?: Partial<ExtractionLimits>;
}

interface XmlVisitor {
  open(key: string, tag: SaxesTagNS): void;
  close(key: string): void;
  text(value: string): void;
}

interface Package {
  zip: ZipFile;
  entries: Map<string, Entry>;
  limits: ExtractionLimits;
  signal: AbortSignal | undefined;
}

interface Relationship {
  type: string;
  target: string;
  external: boolean;
}

interface StyleDefinition {
  name: string;
  basedOn: string | null;
  outline: number | null;
  numbered: boolean | null;
  bold: boolean | null;
  size: number | null;
  hidden: boolean | null;
}

/** What a style, with everything it inherits, says about a paragraph or run. */
interface StyleLook {
  /** Heading level 1–9, or null for body text. */
  level: number | null;
  listed: boolean;
  /** An entry in a table of contents, which only repeats the headings. */
  contents: boolean;
  bold: boolean | null;
  size: number | null;
  hidden: boolean | null;
}

interface Styles {
  definitions: Map<string, StyleDefinition>;
  looks: Map<string, StyleLook>;
  defaultParagraph: string | null;
  defaultSize: number;
}

interface RunLook {
  style: string | null;
  bold: boolean | null;
  size: number | null;
  hidden: boolean | null;
}

interface OpenParagraph {
  /** Its place in reading order, or -1 when it is folded into a table cell. */
  order: number;
  styleId: string | null;
  /** Its own outline level, which overrides the style: 0–8 are headings, 9 is body text. */
  outline: number | null;
  numId: string | null;
  text: string;
  ink: number;
  boldInk: number;
  sizes: Map<number, number>;
  broken: boolean;
  notes: string[];
  run: RunLook | null;
  look: StyleLook | null;
}

interface OpenCell {
  paragraphs: string[];
  span: number;
}

interface OpenRow {
  order: number;
  cells: string[];
  skipped: number;
  notes: string[];
  cell: OpenCell | null;
}

/**
 * rows        — a real table: each row becomes one block.
 * transparent — a single column, which is a frame around ordinary text.
 * folded      — a table inside a real table's cell, read as part of that cell.
 */
interface OpenTable {
  mode: 'undecided' | 'rows' | 'transparent' | 'folded';
  columns: number;
  row: OpenRow | null;
}

interface BodyRecord {
  /** Where it starts in the part. A text box closes before the paragraph that holds it. */
  order: number;
  kind: BlockKind;
  text: string;
  level: number;
  /** Used only to find headings in a document that has no heading styles. */
  size: number;
  bold: boolean;
  oneLine: boolean;
  /** Footnotes and endnotes cited here, as "footnote:3". */
  notes: string[];
}

interface Budget {
  characters: number;
  spent: boolean;
}

export function isLegacyWord(bytes: Uint8Array): boolean {
  return startsWith(bytes, LEGACY_SIGNATURE);
}

export function isZip(bytes: Uint8Array): boolean {
  return startsWith(bytes, ZIP_SIGNATURE);
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

export async function extractDocx(bytes: Uint8Array, options: DocxOptions = {}): Promise<ExtractedDocument> {
  const limits = withLimits(options.limits);
  if (bytes.byteLength === 0) throw new FundingError('EXTRACTION_FAILED', EMPTY_FILE);
  if (isLegacyWord(bytes)) throw new FundingError('UNSUPPORTED_FILE', LEGACY_OR_PROTECTED_WORD);
  if (!isZip(bytes)) throw new FundingError('UNSUPPORTED_FILE', NOT_A_WORD_DOCUMENT);

  let zip: ZipFile | null = null;
  try {
    zip = await openZip(bytes);
    if (zip.entryCount > limits.maxZipEntries) throw new FundingError('EXTRACTION_FAILED', UNSAFE);
    return await readPackage({ zip, entries: await listEntries(zip), limits, signal: options.signal });
  } catch (error) {
    // The zip and XML readers' own messages can quote the file; only ours are passed on.
    if (isFundingError(error)) throw error;
    throw new FundingError('EXTRACTION_FAILED', DAMAGED);
  } finally {
    try {
      zip?.close();
    } catch {
      // Already closed.
    }
  }
}

function openZip(bytes: Uint8Array): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      { lazyEntries: true, autoClose: false, decodeStrings: true, validateEntrySizes: true, strictFileNames: false },
      (error, opened) => (error ? reject(error) : resolve(opened)),
    );
  });
}

/**
 * Every entry by name. Two entries with one name are refused, because readers
 * disagree about which of them counts; names are compared without regard to
 * case, as Word compares them.
 */
function listEntries(zip: ZipFile): Promise<Map<string, Entry>> {
  return new Promise((resolve, reject) => {
    const entries = new Map<string, Entry>();
    const seen = new Set<string>();
    zip.on('error', reject);
    zip.on('end', () => resolve(entries));
    zip.on('entry', (entry: Entry) => {
      const folded = entry.fileName.toLowerCase();
      if (seen.has(folded)) {
        reject(new FundingError('EXTRACTION_FAILED', UNSAFE));
        return;
      }
      seen.add(folded);
      entries.set(entry.fileName, entry);
      zip.readEntry();
    });
    zip.readEntry();
  });
}

function openPart(zip: ZipFile, entry: Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => (error ? reject(error) : resolve(stream)));
  });
}

async function readPart(pkg: Package, name: string, maxBytes: number, visitor: XmlVisitor): Promise<void> {
  const entry = pkg.entries.get(name);
  if (!entry) throw new FundingError('EXTRACTION_FAILED', DAMAGED);
  if (entry.isEncrypted() || (entry.compressionMethod !== 0 && entry.compressionMethod !== 8)) {
    throw new FundingError('EXTRACTION_FAILED', UNSAFE);
  }
  // Refused on what the entry declares, before any of it is unpacked.
  if (entry.uncompressedSize > maxBytes) throw new FundingError('EXTRACTION_FAILED', TOO_LARGE);

  const stream = await openPart(pkg.zip, entry);
  // Reading may stop early; an error raised by the stream after that has nowhere else to go.
  stream.on('error', () => {});
  try {
    await readXml(stream, visitor, pkg, maxBytes);
  } catch (error) {
    if (!(error instanceof BudgetSpent)) throw error;
  } finally {
    stream.destroy();
  }
}

async function readXml(chunks: AsyncIterable<Uint8Array>, visitor: XmlVisitor, pkg: Package, maxBytes: number): Promise<void> {
  const parser = new SaxesParser({ xmlns: true, position: false });
  let depth = 0;
  parser.on('doctype', () => {
    throw new FundingError('EXTRACTION_FAILED', UNSAFE);
  });
  parser.on('error', () => {
    throw new FundingError('EXTRACTION_FAILED', DAMAGED);
  });
  parser.on('opentag', (tag) => {
    depth += 1;
    if (depth > pkg.limits.maxXmlDepth) throw new FundingError('EXTRACTION_FAILED', UNSAFE);
    visitor.open(tagKey(tag.uri, tag.local), tag);
  });
  parser.on('closetag', (tag) => {
    depth -= 1;
    visitor.close(tagKey(tag.uri, tag.local));
  });
  parser.on('text', (value) => visitor.text(value));
  parser.on('cdata', (value) => visitor.text(value));

  let decoder: TextDecoder | null = null;
  let unpacked = 0;
  for await (const chunk of chunks) {
    if (pkg.signal?.aborted) throw new FundingError('CANCELLED', 'Cancelled.');
    // Counted as it arrives too, in case the declared size was a lie.
    unpacked += chunk.byteLength;
    if (unpacked > maxBytes) throw new FundingError('EXTRACTION_FAILED', TOO_LARGE);
    decoder ??= new TextDecoder(encodingOf(chunk), { fatal: true });
    parser.write(decoder.decode(chunk, { stream: true }));
  }
  if (decoder) parser.write(decoder.decode());
  parser.close();
}

function encodingOf(start: Uint8Array): string {
  if (start[0] === 0xff && start[1] === 0xfe) return 'utf-16le';
  if (start[0] === 0xfe && start[1] === 0xff) return 'utf-16be';
  return 'utf-8';
}

/** A short name for the elements that matter, and '' for all others. */
function tagKey(uri: string, local: string): string {
  if (WORD_NAMESPACES.has(uri)) return `w:${local}`;
  if (MATH_NAMESPACES.has(uri)) return `m:${local}`;
  if (uri === COMPATIBILITY_NAMESPACE) return `mc:${local}`;
  if (uri === RELATIONSHIPS_NAMESPACE) return `rel:${local}`;
  if (CHART_NAMESPACES.has(uri)) return `c:${local}`;
  if (DIAGRAM_NAMESPACES.has(uri)) return `dgm:${local}`;
  if (uri === OFFICE_NAMESPACE) return `o:${local}`;
  return '';
}

function wordAttribute(tag: SaxesTagNS, local: string): string | undefined {
  for (const attribute of Object.values(tag.attributes)) {
    if (attribute.local === local && (attribute.uri === '' || WORD_NAMESPACES.has(attribute.uri))) return attribute.value;
  }
  return undefined;
}

/** A property such as bold is on when present, unless its value says otherwise. */
function isOn(tag: SaxesTagNS, attribute = 'val'): boolean {
  const value = wordAttribute(tag, attribute);
  return value === undefined || !['0', 'false', 'off'].includes(value.toLowerCase());
}

function toInteger(value: string | undefined): number | null {
  if (value === undefined || !/^-?\d{1,9}$/.test(value.trim())) return null;
  return Number(value);
}

/**
 * The part a relationship points to. Part names are keys in a table, never
 * paths on disk, so this only has to arrive at the name the package would use;
 * a target that climbs out of the package names nothing.
 */
function partName(base: string, target: string | undefined): string | null {
  if (!target) return null;
  const segments = target.startsWith('/') ? [] : base.split('/').slice(0, -1);
  for (const segment of target.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return null;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.join('/');
}

function relationshipsFor(part: string): string {
  const cut = part.lastIndexOf('/') + 1;
  return `${part.slice(0, cut)}_rels/${part.slice(cut)}.rels`;
}

async function readRelationships(pkg: Package, name: string): Promise<Relationship[]> {
  const found: Relationship[] = [];
  if (!pkg.entries.has(name)) return found;
  await readPart(pkg, name, pkg.limits.maxOtherPartBytes, {
    open(key, tag) {
      if (key !== 'rel:Relationship') return;
      found.push({
        type: tag.attributes.Type?.value ?? '',
        target: tag.attributes.Target?.value ?? '',
        external: (tag.attributes.TargetMode?.value ?? '').toLowerCase() === 'external',
      });
    },
    close() {},
    text() {},
  });
  return found;
}

async function readStyles(pkg: Package, name: string | null): Promise<Styles> {
  const styles: Styles = { definitions: new Map(), looks: new Map(), defaultParagraph: null, defaultSize: FALLBACK_SIZE };
  if (!name) return styles;

  const path: string[] = [];
  let current: { id: string; isDefault: boolean; paragraph: boolean; definition: StyleDefinition } | null = null;
  await readPart(pkg, name, pkg.limits.maxOtherPartBytes, {
    open(key, tag) {
      const parent = path[path.length - 1] ?? '';
      const grandparent = path[path.length - 2] ?? '';
      path.push(key);
      if (key === 'w:style') {
        const type = wordAttribute(tag, 'type') ?? 'paragraph';
        current = {
          id: wordAttribute(tag, 'styleId') ?? '',
          isDefault: wordAttribute(tag, 'default') !== undefined && isOn(tag, 'default'),
          paragraph: type === 'paragraph',
          definition: { name: '', basedOn: null, outline: null, numbered: null, bold: null, size: null, hidden: null },
        };
        return;
      }
      if (key === 'w:sz' && parent === 'w:rPr' && grandparent === 'w:rPrDefault') {
        styles.defaultSize = toInteger(wordAttribute(tag, 'val')) ?? styles.defaultSize;
        return;
      }
      if (!current) return;
      const definition = current.definition;
      // Only the style's own properties; a table style also holds properties
      // for parts of a table, one level further down.
      const ownParagraph = parent === 'w:pPr' && grandparent === 'w:style';
      const ownRun = parent === 'w:rPr' && grandparent === 'w:style';
      if (key === 'w:name' && parent === 'w:style') definition.name = wordAttribute(tag, 'val') ?? '';
      else if (key === 'w:basedOn' && parent === 'w:style') definition.basedOn = wordAttribute(tag, 'val') ?? null;
      else if (key === 'w:outlineLvl' && ownParagraph) definition.outline = toInteger(wordAttribute(tag, 'val'));
      else if (key === 'w:numId' && parent === 'w:numPr' && grandparent === 'w:pPr' && path[path.length - 4] === 'w:style') {
        definition.numbered = wordAttribute(tag, 'val') !== '0';
      } else if (key === 'w:b' && ownRun) definition.bold = isOn(tag);
      else if (key === 'w:sz' && ownRun) definition.size = toInteger(wordAttribute(tag, 'val'));
      else if (key === 'w:vanish' && ownRun) definition.hidden = isOn(tag);
    },
    close(key) {
      path.pop();
      if (key !== 'w:style' || !current) return;
      if (current.id) {
        styles.definitions.set(current.id, current.definition);
        if (current.isDefault && current.paragraph) styles.defaultParagraph = current.id;
      }
      current = null;
    },
    text() {},
  });
  return styles;
}

const PLAIN_LOOK: StyleLook = { level: null, listed: false, contents: false, bold: null, size: null, hidden: null };

/**
 * A style with what it inherits. For the heading level the first rule that
 * matches wins: a built-in heading style, the Title style, the style's own
 * outline level, and otherwise whatever the style it is based on says.
 */
function lookOf(styles: Styles, id: string | null): StyleLook {
  const key = id ?? styles.defaultParagraph;
  if (key === null) return PLAIN_LOOK;
  const known = styles.looks.get(key);
  if (known) return known;

  const look: StyleLook = { ...PLAIN_LOOK };
  let levelSettled = false;
  let listSettled = false;
  let currentId: string | undefined = key;
  for (let hops = 0; currentId !== undefined && hops < MAX_STYLE_HOPS; hops += 1) {
    const current = styles.definitions.get(currentId);
    if (!current) break;
    const labels = [current.name.trim(), currentId];
    look.contents ||= labels.some((label) => CONTENTS_STYLE.test(label));
    if (!levelSettled) {
      const numbered = labels.map((label) => HEADING_STYLE.exec(label)).find((match) => match !== null);
      const title = labels.some((label) => TITLE_STYLE.test(label));
      if (numbered) look.level = Number(numbered[1]);
      else if (title) look.level = 1;
      else if (current.outline !== null) look.level = current.outline <= 8 ? current.outline + 1 : null;
      levelSettled = numbered !== undefined || title || current.outline !== null;
    }
    if (!listSettled && (current.numbered !== null || labels.some((label) => LIST_STYLE.test(label)))) {
      look.listed = current.numbered ?? true;
      listSettled = true;
    }
    look.bold ??= current.bold;
    look.size ??= current.size;
    look.hidden ??= current.hidden;
    currentId = current.basedOn ?? undefined;
  }
  styles.looks.set(key, look);
  return look;
}

function symbolFor(font: string | undefined, code: string | undefined): string {
  const value = Number.parseInt(code ?? '', 16);
  if (!font || Number.isNaN(value)) return '';
  // Picture fonts store their characters in a private range, offset by 0xF000.
  return SYMBOLS[font.trim().toLowerCase()]?.[value >= 0xf000 ? value - 0xf000 : value] ?? '';
}

/**
 * Walks one part and collects what is in it. Paragraphs and tables are kept on
 * stacks because they nest: a text box puts whole paragraphs inside a run of
 * another paragraph, and a table cell can hold a table.
 */
function createWalker(
  styles: Styles,
  limits: ExtractionLimits,
  budget: Budget,
  expectedRoot: string,
  noteKind: 'footnote' | 'endnote' | null,
) {
  const path: string[] = [];
  const paragraphs: OpenParagraph[] = [];
  const tables: OpenTable[] = [];
  const controls: { placeholder: boolean }[] = [];
  const records: BodyRecord[] = [];
  const notes = new Map<string, string>();
  const found = { objects: 0, foreign: 0 };
  let note: { id: string; from: number } | null = null;
  let skipping = 0;
  let inText = false;

  let started = 0;
  const hostTable = () => tables.find((table) => table.mode === 'rows');

  function addText(value: string): void {
    const paragraph = paragraphs[paragraphs.length - 1];
    if (!paragraph || value === '') return;
    paragraph.look ??= lookOf(styles, paragraph.styleId);
    const run = paragraph.run;
    const character = run?.style ? lookOf(styles, run.style) : null;
    if (run?.hidden ?? character?.hidden ?? paragraph.look.hidden ?? false) return;

    // A single run can hold more than the whole budget; only what fits is kept.
    const room = limits.maxCharacters - budget.characters;
    const kept = cutAtWord(value, room);
    paragraph.text += kept;
    const ink = kept.replace(/\s+/gu, '').length;
    if (ink > 0) {
      const size = run?.size ?? character?.size ?? paragraph.look.size ?? styles.defaultSize;
      paragraph.ink += ink;
      if (run?.bold ?? character?.bold ?? paragraph.look.bold ?? false) paragraph.boldInk += ink;
      paragraph.sizes.set(size, (paragraph.sizes.get(size) ?? 0) + ink);
    }
    budget.characters += kept.length;
    if (kept.length < value.length || budget.characters >= limits.maxCharacters) {
      budget.spent = true;
      throw new BudgetSpent();
    }
  }

  function closeParagraph(): void {
    const paragraph = paragraphs.pop();
    if (!paragraph) return;
    const text = cleanText(paragraph.text);
    if (paragraph.order < 0) {
      const row = hostTable()?.row;
      if (text && row?.cell) row.cell.paragraphs.push(text);
      row?.notes.push(...paragraph.notes);
      return;
    }
    const look = paragraph.look ?? lookOf(styles, paragraph.styleId);
    if (!hasContent(text) || look.contents) return;

    const ownLevel = paragraph.outline === null ? undefined : paragraph.outline <= 8 ? paragraph.outline + 1 : null;
    const level = ownLevel === undefined ? look.level : ownLevel;
    const listed = paragraph.numId === null ? look.listed : paragraph.numId !== '0';
    let size = FALLBACK_SIZE;
    let most = -1;
    for (const [candidate, characters] of paragraph.sizes) {
      if (characters > most) {
        size = candidate;
        most = characters;
      }
    }
    records.push({
      order: paragraph.order,
      kind: level !== null ? 'heading' : listed ? 'list_item' : 'paragraph',
      text,
      level: level ?? 0,
      size,
      bold: paragraph.ink > 0 && paragraph.boldInk === paragraph.ink,
      oneLine: !paragraph.broken,
      notes: paragraph.notes,
    });
  }

  function closeCell(row: OpenRow): void {
    if (!row.cell) return;
    row.cells.push(row.cell.paragraphs.join(' / '));
    // A merged cell still takes up its columns, so later cells keep their places.
    for (let extra = 1; extra < row.cell.span; extra += 1) row.cells.push('');
    row.cell = null;
  }

  function closeRow(table: OpenTable): void {
    const row = table.row;
    if (!row) return;
    table.row = null;
    const cells = [...Array.from({ length: row.skipped }, () => ''), ...row.cells];
    while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
    const text = cleanText(cells.join(' | '));
    if (!hasContent(text)) return;
    records.push({ order: row.order, kind: 'table_row', text, level: 0, size: 0, bold: false, oneLine: false, notes: row.notes });
  }

  function open(key: string, tag: SaxesTagNS): void {
    if (path.length === 0 && key !== expectedRoot) {
      // A package whose main part is something else is a spreadsheet or a slide deck.
      throw noteKind ? new FundingError('EXTRACTION_FAILED', DAMAGED) : new FundingError('UNSUPPORTED_FILE', NOT_A_WORD_DOCUMENT);
    }
    const parent = path[path.length - 1] ?? '';
    const grandparent = path[path.length - 2] ?? '';
    path.push(key);
    if (skipping > 0) {
      skipping += 1;
      return;
    }
    // Tracked changes keep the old properties beside the new ones; only the new ones count.
    if (UNREAD.has(key) || (key.startsWith('w:') && key.endsWith('Change'))) {
      skipping = 1;
      return;
    }

    const paragraph = paragraphs[paragraphs.length - 1];
    const table = tables[tables.length - 1];
    switch (key) {
      case 'w:footnote':
      case 'w:endnote':
        // Separators are stored as notes too; nothing cites them, so they are never used.
        note = { id: wordAttribute(tag, 'id') ?? '', from: records.length };
        return;
      case 'w:sdt':
        controls.push({ placeholder: false });
        return;
      case 'w:showingPlcHdr': {
        const control = controls[controls.length - 1];
        if (control && parent === 'w:sdtPr' && isOn(tag)) control.placeholder = true;
        return;
      }
      case 'w:sdtContent':
        // A form field nobody filled in shows its prompt ("Click here to enter text").
        if (controls[controls.length - 1]?.placeholder) skipping = 1;
        return;
      case 'w:p':
        paragraphs.push({
          order: hostTable()?.row?.cell ? -1 : started++,
          styleId: null,
          outline: null,
          numId: null,
          text: '',
          ink: 0,
          boldInk: 0,
          sizes: new Map(),
          broken: false,
          notes: [],
          run: null,
          look: null,
        });
        return;
      case 'w:pStyle':
        if (paragraph && parent === 'w:pPr' && grandparent === 'w:p') paragraph.styleId = wordAttribute(tag, 'val') ?? null;
        return;
      case 'w:outlineLvl':
        if (paragraph && parent === 'w:pPr' && grandparent === 'w:p') paragraph.outline = toInteger(wordAttribute(tag, 'val'));
        return;
      case 'w:numId':
        if (paragraph && parent === 'w:numPr' && grandparent === 'w:pPr' && path[path.length - 4] === 'w:p') {
          paragraph.numId = wordAttribute(tag, 'val') ?? null;
        }
        return;
      case 'w:r':
      case 'm:r':
        if (paragraph) paragraph.run = { style: null, bold: null, size: null, hidden: null };
        return;
      case 'w:rStyle':
      case 'w:b':
      case 'w:sz':
      case 'w:vanish':
      case 'w:webHidden': {
        const run = paragraph?.run;
        if (!run || parent !== 'w:rPr' || (grandparent !== 'w:r' && grandparent !== 'm:r')) return;
        if (key === 'w:rStyle') run.style = wordAttribute(tag, 'val') ?? null;
        else if (key === 'w:b') run.bold = isOn(tag);
        else if (key === 'w:sz') run.size = toInteger(wordAttribute(tag, 'val'));
        else run.hidden = isOn(tag) || run.hidden === true;
        return;
      }
      case 'w:t':
      case 'm:t':
        inText = true;
        return;
      case 'w:tab':
        addText(' ');
        return;
      case 'w:br':
      case 'w:cr':
        if (paragraph) paragraph.broken = true;
        addText(' ');
        return;
      case 'w:noBreakHyphen':
        addText('-');
        return;
      case 'w:sym':
        addText(symbolFor(wordAttribute(tag, 'font'), wordAttribute(tag, 'char')));
        return;
      case 'w:footnoteReference':
      case 'w:endnoteReference': {
        const id = wordAttribute(tag, 'id');
        if (paragraph && id) paragraph.notes.push(`${key === 'w:footnoteReference' ? 'footnote' : 'endnote'}:${id}`);
        return;
      }
      case 'w:tbl':
        tables.push({
          mode: tables.some((outer) => outer.mode === 'rows' || outer.mode === 'folded') ? 'folded' : 'undecided',
          columns: 0,
          row: null,
        });
        return;
      case 'w:gridCol':
        if (table && parent === 'w:tblGrid') table.columns += 1;
        return;
      case 'w:tr':
        if (!table) return;
        if (table.mode === 'undecided') table.mode = table.columns === 1 ? 'transparent' : 'rows';
        if (table.mode === 'rows') table.row = { order: started++, cells: [], skipped: 0, notes: [], cell: null };
        return;
      case 'w:gridBefore':
        if (table?.row && parent === 'w:trPr') {
          table.row.skipped = Math.min(Math.max(toInteger(wordAttribute(tag, 'val')) ?? 0, 0), 63);
        }
        return;
      case 'w:tc':
        if (table?.row) table.row.cell = { paragraphs: [], span: 1 };
        return;
      case 'w:gridSpan':
        if (table?.row?.cell && parent === 'w:tcPr') {
          table.row.cell.span = Math.min(Math.max(toInteger(wordAttribute(tag, 'val')) ?? 1, 1), 63);
        }
        return;
      case 'w:altChunk':
        found.foreign += 1;
        return;
      case 'c:chart':
      case 'dgm:relIds':
      case 'o:OLEObject':
        found.objects += 1;
        return;
      default:
        return;
    }
  }

  function close(key: string): void {
    path.pop();
    if (skipping > 0) {
      skipping -= 1;
      return;
    }
    const table = tables[tables.length - 1];
    switch (key) {
      case 'w:t':
      case 'm:t':
        inText = false;
        return;
      case 'w:r':
      case 'm:r': {
        const paragraph = paragraphs[paragraphs.length - 1];
        if (paragraph) paragraph.run = null;
        return;
      }
      case 'w:p':
        closeParagraph();
        return;
      case 'w:tc':
        if (table?.row) closeCell(table.row);
        return;
      case 'w:tr':
        if (table) closeRow(table);
        return;
      case 'w:tbl':
        tables.pop();
        return;
      case 'w:sdt':
        controls.pop();
        return;
      case 'w:footnote':
      case 'w:endnote':
        if (note && noteKind) {
          const texts = records.slice(note.from).sort(byOrder).map((record) => record.text);
          notes.set(`${noteKind}:${note.id}`, texts.join(' '));
        }
        note = null;
        return;
      default:
        return;
    }
  }

  return {
    visitor: {
      open,
      close,
      text(value: string) {
        if (skipping === 0 && inText) addText(value);
      },
    } satisfies XmlVisitor,
    records,
    notes,
    found,
    /** Closes whatever reading stopped in the middle of, so its text is kept. */
    finish() {
      while (paragraphs.length > 0) closeParagraph();
      for (const table of tables) {
        if (table.row) closeCell(table.row);
        closeRow(table);
      }
      tables.length = 0;
    },
  };
}

function byOrder(first: BodyRecord, second: BodyRecord): number {
  return first.order - second.order;
}

/**
 * For a document with no heading styles at all: a short paragraph of one line
 * that is bold throughout, or set clearly larger than the body, is taken for a
 * heading. The result is used only if such paragraphs are a minority.
 */
function inferHeadings(records: BodyRecord[]): boolean {
  // Table rows and notes carry no size of their own and say nothing about the body text.
  const weight = new Map<number, number>();
  for (const record of records) {
    if (record.size > 0) weight.set(record.size, (weight.get(record.size) ?? 0) + record.text.length);
  }
  let body = FALLBACK_SIZE;
  let most = -1;
  for (const [size, characters] of weight) {
    if (characters > most) {
      body = size;
      most = characters;
    }
  }

  const candidates = records.filter(
    (record) =>
      record.kind === 'paragraph' &&
      record.oneLine &&
      record.text.length <= INFERRED_HEADING_MAX_CHARACTERS &&
      // A short bold sentence is emphasis, not a title.
      !/[.;,]$/.test(record.text) &&
      (record.bold || record.size >= body * INFERRED_HEADING_SIZE_RATIO),
  );
  if (candidates.length === 0 || candidates.length > records.length * INFERRED_HEADING_MAX_SHARE) return false;

  const sizes = [...new Set(candidates.map((record) => record.size))].sort((first, second) => second - first);
  for (const record of candidates) {
    record.kind = 'heading';
    record.level = sizes.indexOf(record.size) + 1;
  }
  return true;
}

async function readPackage(pkg: Package): Promise<ExtractedDocument> {
  const { limits } = pkg;
  const packageLinks = await readRelationships(pkg, '_rels/.rels');
  const mainLink = packageLinks.find((link) => !link.external && link.type.endsWith('/officeDocument'));
  // Without this link the zip is some other kind of file; with it, a missing part is damage.
  if (!mainLink) throw new FundingError('UNSUPPORTED_FILE', NOT_A_WORD_DOCUMENT);
  const main = partName('', mainLink.target);
  if (main === null || !pkg.entries.has(main)) throw new FundingError('EXTRACTION_FAILED', DAMAGED);

  const links = await readRelationships(pkg, relationshipsFor(main));
  const linkedPart = (typeSuffix: string): string | null => {
    const name = partName(main, links.find((link) => !link.external && link.type.endsWith(typeSuffix))?.target);
    return name !== null && pkg.entries.has(name) ? name : null;
  };

  const styles = await readStyles(pkg, linkedPart('/styles'));
  const budget: Budget = { characters: 0, spent: false };
  const body = createWalker(styles, limits, budget, 'w:document', null);
  await readPart(pkg, main, limits.maxMainPartBytes, body.visitor);
  body.finish();

  const records = body.records.sort(byOrder);
  const cited = new Set(records.flatMap((record) => record.notes));
  const noteTexts = new Map<string, string>();
  let missingNotes = false;
  // Notes are read only when the body cites them, and only the ones it cites are kept.
  for (const kind of ['footnote', 'endnote'] as const) {
    if (budget.spent || ![...cited].some((key) => key.startsWith(`${kind}:`))) continue;
    const name = linkedPart(`/${kind}s`);
    if (!name) continue;
    const reader = createWalker(styles, limits, budget, `w:${kind}s`, kind);
    await readPart(pkg, name, limits.maxOtherPartBytes, reader.visitor);
    reader.finish();
    for (const [key, text] of reader.notes) noteTexts.set(key, text);
  }

  // A note follows the block that cites it, as its own block and in its own words.
  const ordered: BodyRecord[] = [];
  for (const record of records) {
    ordered.push(record);
    for (const key of record.notes) {
      const text = noteTexts.get(key);
      if (text) ordered.push({ order: record.order, kind: 'paragraph', text, level: 0, size: 0, bold: false, oneLine: false, notes: [] });
      else if (text === undefined && !budget.spent) missingNotes = true;
    }
  }

  const warnings: string[] = [];
  if (budget.spent) {
    warnings.push(
      `This document is very long, so only the first part was read (about ${limits.maxCharacters.toLocaleString('en-US')} characters).`,
    );
  }
  if (!ordered.some((record) => record.kind === 'heading') && inferHeadings(ordered)) warnings.push(INFERRED_HEADINGS);
  if (missingNotes) warnings.push(MISSING_NOTES);

  const outside = links.filter((link) => link.external && !link.type.endsWith('/hyperlink')).length;
  if (outside > 0) {
    warnings.push(
      outside === 1
        ? 'This document links to 1 outside file, such as a linked picture or template. It was not opened.'
        : `This document links to ${outside.toLocaleString('en-US')} outside files, such as linked pictures or templates. They were not opened.`,
    );
  }
  if (body.found.objects > 0) {
    warnings.push(
      body.found.objects === 1
        ? 'This document contains a chart or embedded object. Its contents were not read.'
        : `This document contains ${body.found.objects.toLocaleString('en-US')} charts or embedded objects. Their contents were not read.`,
    );
  }
  if (body.found.foreign > 0) warnings.push(FOREIGN_CONTENT);

  const drafts: DraftBlock[] = ordered.map((record) => ({
    kind: record.kind,
    text: record.text,
    page: null,
    level: record.level,
  }));
  const document = assembleDocument('docx', drafts, null, warnings);
  if (document.blocks.length === 0) throw new FundingError('EXTRACTION_FAILED', NO_TEXT);
  return document;
}
