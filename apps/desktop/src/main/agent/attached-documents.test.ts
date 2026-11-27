import { describe, expect, it, vi } from 'vitest';
import { readAttachedDocuments, type AttachedDocumentSources } from './attached-documents.js';
import type { ExtractedDocument } from '../documents/types.js';

const pdf = (text: string): ExtractedDocument => ({
  format: 'pdf', pageCount: 1, wordCount: 3, warnings: [],
  blocks: [{ id: 'b0001', kind: 'paragraph', text, page: 1, section: '', headingLevel: null }],
} as ExtractedDocument);

function sources(over: Partial<AttachedDocumentSources> = {}): AttachedDocumentSources {
  return {
    documentFile: (id) => (id.startsWith('doc') ? { path: `/store/${id}`, name: `${id}.pdf` } : null),
    projectFileIds: () => ['doc-project', 'image-1'],
    extract: vi.fn(async (path: string) => pdf(`Text of ${path}`)),
    ...over,
  };
}

describe('readAttachedDocuments', () => {
  it('reads attached and project PDFs and skips other files', async () => {
    const src = sources();
    const texts = await readAttachedDocuments([
      { kind: 'file', fileId: 'doc-1' },
      { kind: 'file', fileId: 'image-2' },
      { kind: 'project', projectId: 'p1' },
    ] as never, src);
    expect([...texts.keys()]).toEqual(['doc-1', 'doc-project']);
    expect(texts.get('doc-1')).toBe('[Page 1]\nText of /store/doc-1');
    expect(src.extract).toHaveBeenCalledTimes(2);
  });

  it('leaves a file that cannot be read out instead of failing the task', async () => {
    const texts = await readAttachedDocuments([{ kind: 'file', fileId: 'doc-1' }] as never,
      sources({ extract: async () => { throw new Error('encrypted'); } }));
    expect(texts.size).toBe(0);
  });

  it('does nothing without attachments', async () => {
    expect((await readAttachedDocuments(undefined, sources())).size).toBe(0);
  });
});
