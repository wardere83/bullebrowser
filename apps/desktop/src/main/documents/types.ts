// The shape every document takes once its text has been read. Blocks are the
// unit of citation: a quotation shown to the user is always a slice of one
// block's text, located by the block's page or section.

import type { DocumentFormat } from '../../shared/funding.js';

export type BlockKind = 'heading' | 'paragraph' | 'list_item' | 'table_row';

export interface ExtractedBlock {
  /**
   * Stable within one version of a document: "b0001", "b0002", … in reading
   * order. The same file always yields the same ids.
   */
  id: string;
  kind: BlockKind;
  /** Plain text with single spaces; never empty. */
  text: string;
  /** 1-based page number for PDFs; null for formats without pages. */
  page: number | null;
  /** Headings above this block, outermost first, joined with " › ". Empty if none. */
  section: string;
  /** 1–6 for headings; null otherwise. */
  headingLevel: number | null;
}

export interface ExtractedDocument {
  format: DocumentFormat;
  blocks: ExtractedBlock[];
  /** Pages for PDFs; null for formats without pages. */
  pageCount: number | null;
  wordCount: number;
  /** Non-fatal findings the user should see, e.g. pages with no readable text. */
  warnings: string[];
}

export const SECTION_SEPARATOR = ' › ';
