import { describe, expect, it } from 'vitest';
import { documentToText, isReadableDocumentName } from './plain-text.js';
import type { ExtractedDocument } from './types.js';

const doc = (over: Partial<ExtractedDocument> = {}): ExtractedDocument => ({
  format: 'pdf',
  pageCount: 2,
  wordCount: 8,
  warnings: [],
  blocks: [
    { id: 'b0001', kind: 'heading', text: 'Eligibility', page: 1, section: '', headingLevel: 1 },
    { id: 'b0002', kind: 'paragraph', text: 'Open to public colleges.', page: 1, section: 'Eligibility', headingLevel: null },
    { id: 'b0003', kind: 'list_item', text: 'Deadline March 10', page: 2, section: 'Eligibility', headingLevel: null },
  ],
  ...over,
} as ExtractedDocument);

describe('documentToText', () => {
  it('keeps reading order with page markers, headings and list items', () => {
    expect(documentToText(doc())).toBe('[Page 1]\n\n# Eligibility\nOpen to public colleges.\n\n[Page 2]\n- Deadline March 10');
  });

  it('says when the text was shortened and passes on reading notes', () => {
    const text = documentToText(doc({ warnings: ['Page 3 has no readable text.'] }), 20);
    expect(text).toContain('…[document continues; 2 pages in all]');
    expect(text).toContain('(Reading notes: Page 3 has no readable text.)');
  });

  it('recognizes the documents it can read', () => {
    expect(isReadableDocumentName('Grant RFP.PDF')).toBe(true);
    expect(isReadableDocumentName('notes.docx')).toBe(true);
    expect(isReadableDocumentName('photo.png')).toBe(false);
  });
});
