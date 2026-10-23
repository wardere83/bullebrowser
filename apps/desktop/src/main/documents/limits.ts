// How much the app is willing to read from one document. A file that is
// hostile, or simply enormous, is refused or read only up to these bounds, so
// it cannot use up the device's memory or keep a reader busy forever.
//
// These are starting values, not measured product requirements. Every reader
// takes an optional override so tests can reach a limit without a huge file.

import { MAX_DOCUMENT_BYTES } from '../../shared/funding.js';

const MEGABYTE = 1024 * 1024;

export interface ExtractionLimits {
  /** Largest file that is read at all. */
  maxFileBytes: number;
  /** Most pages a PDF may have. */
  maxPages: number;
  /** Text kept from one document. Reading stops there and a warning says so. */
  maxCharacters: number;
  /**
   * How much of a Markdown file is parsed. Lower than the general budget because
   * the parser's memory grows with the file: at 4 MB it took 6 seconds here, at
   * 8 MB it filled the worker's heap and took over a minute.
   */
  maxMarkdownCharacters: number;
  /** Most entries a DOCX package may list. */
  maxZipEntries: number;
  /** Largest unpacked size of the part holding a DOCX's body. */
  maxMainPartBytes: number;
  /** Largest unpacked size of any other DOCX part that is read. */
  maxOtherPartBytes: number;
  /** Deepest nesting of elements accepted in a DOCX part. */
  maxXmlDepth: number;
  /** Heap given to the worker thread that reads a document, in megabytes. */
  workerHeapMb: number;
  /** How long one document may take before its worker is stopped. */
  timeoutMs: number;
}

export const DEFAULT_LIMITS: Readonly<ExtractionLimits> = {
  maxFileBytes: MAX_DOCUMENT_BYTES,
  maxPages: 2_000,
  maxCharacters: 8_000_000,
  maxMarkdownCharacters: 3_000_000,
  maxZipEntries: 5_000,
  maxMainPartBytes: 96 * MEGABYTE,
  maxOtherPartBytes: 16 * MEGABYTE,
  maxXmlDepth: 256,
  workerHeapMb: 768,
  timeoutMs: 120_000,
};

/** The defaults with any overrides applied; an undefined override is ignored. */
export function withLimits(overrides: Partial<ExtractionLimits> = {}): ExtractionLimits {
  const limits = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(limits) as (keyof ExtractionLimits)[]) {
    const value = overrides[key];
    if (typeof value === 'number' && Number.isFinite(value)) limits[key] = value;
  }
  return limits;
}

/** A byte count as whole megabytes, for messages. */
export function megabytes(bytes: number): number {
  return Math.max(1, Math.round(bytes / MEGABYTE));
}
