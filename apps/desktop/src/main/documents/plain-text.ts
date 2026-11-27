// Turns an extracted document into the plain text the assistant reads: blocks
// in reading order, a page marker where a PDF page starts, headings set on
// their own line, and a clear note when the text was cut short.

import type { ExtractedDocument } from './types.js';

export const AGENT_DOCUMENT_CHARS = 40_000;

export function documentToText(doc: ExtractedDocument, maxChars = AGENT_DOCUMENT_CHARS): string {
  const lines: string[] = [];
  let page: number | null = null;
  for (const block of doc.blocks) {
    if (block.page !== null && block.page !== page) {
      page = block.page;
      lines.push(`\n[Page ${page}]`);
    }
    if (block.kind === 'heading') lines.push(`\n${'#'.repeat(Math.min(6, Math.max(1, block.headingLevel ?? 2)))} ${block.text}`);
    else if (block.kind === 'list_item') lines.push(`- ${block.text}`);
    else lines.push(block.text);
  }
  const text = lines.join('\n').trim();
  const notes = doc.warnings.length ? `\n\n(Reading notes: ${doc.warnings.join(' ')})` : '';
  if (text.length <= maxChars) return text + notes;
  return `${text.slice(0, maxChars)}\n…[document continues; ${doc.pageCount ? `${doc.pageCount} pages in all` : 'text shortened'}]${notes}`;
}

/** Names whose contents the document reader can turn into text. */
export function isReadableDocumentName(name: string): boolean {
  return /\.(pdf|docx)$/i.test(name);
}
