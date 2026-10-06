// Reading a document's text from its bytes: which of the four formats a file
// really is, and the one entry point that hands it to the right reader.
//
// Nothing here touches the filesystem or Electron, so the worker thread and the
// unit tests run exactly the same code.

import { ACCEPTED_EXTENSIONS, type DocumentFormat } from '../../shared/funding.js';
import { FundingError, isFundingError } from '../funding/errors.js';
import { extractDocx, isLegacyWord, isZip, LEGACY_OR_PROTECTED_WORD, NOT_A_WORD_DOCUMENT } from './docx.js';
import { megabytes, withLimits, type ExtractionLimits } from './limits.js';
import { extractPdf } from './pdf.js';
import { decodeText, EMPTY_FILE, extractMarkdown, extractTxt } from './text.js';
import type { ExtractedDocument } from './types.js';

const ACCEPTED = 'Upload a PDF, a Word document (.docx), a Markdown file or a plain-text file.';
const WRONG_KIND = `This kind of file cannot be read. ${ACCEPTED}`;
const OLDER_WORD =
  'Older Word files (.doc) cannot be read. Open the file in Word, save it as a Word document (.docx) or a PDF, and upload that.';
const NOT_A_PDF =
  'This file is named as a PDF, but its contents are not one. Check that you picked the right file, or export it as a PDF again.';
const NOT_TEXT = `This file is named as a text file, but it does not contain plain text. ${ACCEPTED}`;
const UNREADABLE = 'This file could not be read. Try saving a new copy of it and uploading that.';

/** "%PDF-", which a PDF carries within its first 1,024 bytes. */
const PDF_MARKER = [0x25, 0x50, 0x44, 0x46, 0x2d];
const PDF_MARKER_WINDOW = 1024;
/** How much of a text file is looked at to decide that it is text. */
const TEXT_SAMPLE_BYTES = 8192;
/** "{\rtf": markup that opens in a word processor but is not plain text. */
const RICH_TEXT_MARKER = [0x7b, 0x5c, 0x72, 0x74, 0x66];

export interface ExtractOptions {
  signal?: AbortSignal;
  limits?: Partial<ExtractionLimits>;
}

function formatForName(fileName: string): DocumentFormat | null {
  const name = fileName.trim();
  const dot = name.lastIndexOf('.');
  if (dot < 0) return null;
  const extension = name.slice(dot + 1).toLowerCase();
  for (const format of Object.keys(ACCEPTED_EXTENSIONS) as DocumentFormat[]) {
    if (ACCEPTED_EXTENSIONS[format].includes(extension)) return format;
  }
  return null;
}

function hasPdfMarker(head: Uint8Array): boolean {
  const last = Math.min(head.byteLength, PDF_MARKER_WINDOW) - PDF_MARKER.length;
  for (let start = 0; start <= last; start += 1) {
    if (PDF_MARKER.every((byte, offset) => head[start + offset] === byte)) return true;
  }
  return false;
}

function isPlainText(head: Uint8Array): boolean {
  // A PDF or a rich-text file can be made of nothing but letters, yet it is
  // markup in another format, not the text of a document.
  if (hasPdfMarker(head) || RICH_TEXT_MARKER.every((byte, offset) => head[offset] === byte)) return false;
  return decodeText(head.subarray(0, TEXT_SAMPLE_BYTES)) !== null;
}

/**
 * The format of a file, or null when it cannot be read. The name has to carry
 * one of the accepted extensions and the contents have to agree with it: a file
 * is never read as something its name does not say, nor trusted for its name.
 */
export function detectFormat(fileName: string, head: Uint8Array): DocumentFormat | null {
  const named = formatForName(fileName);
  if (named === null) return null;
  if (named === 'pdf') return hasPdfMarker(head) ? 'pdf' : null;
  if (named === 'docx') return isZip(head) ? 'docx' : null;
  return isPlainText(head) ? named : null;
}

/** The format of a file, or a FundingError saying why it cannot be read and what to upload instead. */
export function requireFormat(fileName: string, head: Uint8Array): DocumentFormat {
  const named = formatForName(fileName);
  if (named === null) {
    throw new FundingError('UNSUPPORTED_FILE', /\.doc$/i.test(fileName.trim()) ? OLDER_WORD : WRONG_KIND);
  }
  if (head.byteLength === 0) throw new FundingError('EXTRACTION_FAILED', EMPTY_FILE);
  const format = detectFormat(fileName, head);
  if (format !== null) return format;
  if (named === 'pdf') throw new FundingError('UNSUPPORTED_FILE', NOT_A_PDF);
  if (named === 'docx') {
    throw new FundingError('UNSUPPORTED_FILE', isLegacyWord(head) ? LEGACY_OR_PROTECTED_WORD : NOT_A_WORD_DOCUMENT);
  }
  throw new FundingError('UNSUPPORTED_FILE', NOT_TEXT);
}

export function tooLarge(limits: ExtractionLimits): FundingError {
  return new FundingError(
    'FILE_TOO_LARGE',
    `This file is larger than ${megabytes(limits.maxFileBytes)} MB, the most that can be read. Split it into smaller files, or upload a shorter version.`,
  );
}

/**
 * Reads one document. Every failure is a FundingError whose message is written
 * for the person who uploaded the file; whatever a parsing library threw stays
 * here, because those messages can quote file contents and internal paths.
 */
export async function extractFromBytes(
  format: DocumentFormat,
  bytes: Uint8Array,
  options: ExtractOptions = {},
): Promise<ExtractedDocument> {
  if (options.signal?.aborted) throw new FundingError('CANCELLED', 'Cancelled.');
  const limits = withLimits(options.limits);
  try {
    if (bytes.byteLength > limits.maxFileBytes) throw tooLarge(limits);
    switch (format) {
      case 'pdf':
        return await extractPdf(bytes, options);
      case 'docx':
        return await extractDocx(bytes, options);
      case 'md':
        return extractMarkdown(bytes, options);
      case 'txt':
        return extractTxt(bytes, options);
      default:
        throw new FundingError('UNSUPPORTED_FILE', WRONG_KIND);
    }
  } catch (error) {
    if (isFundingError(error)) throw error;
    throw new FundingError('EXTRACTION_FAILED', UNREADABLE);
  }
}
