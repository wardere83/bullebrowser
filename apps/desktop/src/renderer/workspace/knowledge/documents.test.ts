import { describe, expect, it } from 'vitest';
import {
  ACCEPTED_EXTENSIONS,
  KNOWLEDGE_CATEGORY_LABELS,
  type KnowledgeDocument,
} from '../../../shared/funding.js';
import {
  ACCEPTED_FILES,
  CATEGORIES,
  DECIDE_FROM_FILE_NAME,
  FORMAT_NAMES,
  HELPFUL_DOCUMENTS,
  asCategory,
  documentFacts,
  draftReadiness,
  isBeingRead,
  listInWords,
  sortDocuments,
  tallyDocuments,
} from './documents.js';

function document(patch: Partial<KnowledgeDocument>): KnowledgeDocument {
  return {
    id: 'doc-1',
    organizationId: 'org-1',
    name: 'Plan.pdf',
    format: 'pdf',
    category: 'strategic_plan',
    sizeBytes: 2_516_582,
    sha256: 'abc',
    version: 1,
    status: 'ready',
    statusDetail: '',
    warnings: [],
    pageCount: 24,
    blockCount: 310,
    wordCount: 5210,
    uploadedAt: 1000,
    updatedAt: 1000,
    uploadedBy: 'user-1',
    ...patch,
  };
}

describe('what the Documents tab says', () => {
  it('names the files that are read and their size limit', () => {
    expect(ACCEPTED_FILES).toBe('PDF, DOCX, TXT and Markdown files, up to 40 MB each');
  });

  it('has a name for every format main accepts', () => {
    expect(Object.keys(FORMAT_NAMES).sort()).toEqual(Object.keys(ACCEPTED_EXTENSIONS).sort());
  });

  it('names the documents that help, in the plural', () => {
    expect(HELPFUL_DOCUMENTS).toBe(
      'strategic plans, organizational profiles, program descriptions, impact reports, budgets and previous proposals',
    );
  });

  it('offers every category, with the file name deciding by default', () => {
    expect(DECIDE_FROM_FILE_NAME).toBe('Decide from the file name');
    expect(CATEGORIES).toEqual(Object.keys(KNOWLEDGE_CATEGORY_LABELS));
    expect(asCategory('budget')).toBe('budget');
    expect(asCategory('other')).toBe('other');
    // The default choice has no category of its own.
    expect(asCategory('')).toBeNull();
    expect(asCategory('Budget')).toBeNull();
  });

  it('lists things in words', () => {
    expect(listInWords([])).toBe('');
    expect(listInWords(['a'])).toBe('a');
    expect(listInWords(['a', 'b'])).toBe('a and b');
    expect(listInWords(['a', 'b', 'c'])).toBe('a, b and c');
  });
});

describe('sortDocuments', () => {
  it('puts the newest upload first and keeps a batch in name order', () => {
    const sorted = sortDocuments([
      document({ id: '1', name: 'Budget.pdf', uploadedAt: 10 }),
      document({ id: '2', name: 'Plan.pdf', uploadedAt: 30 }),
      document({ id: '3', name: 'Annual report.pdf', uploadedAt: 30 }),
      document({ id: '4', name: 'Proposal.docx', uploadedAt: 20 }),
    ]);
    expect(sorted.map((entry) => entry.name)).toEqual([
      'Annual report.pdf',
      'Plan.pdf',
      'Proposal.docx',
      'Budget.pdf',
    ]);
  });

  it('leaves the list it was given untouched', () => {
    const given = [document({ id: '1', uploadedAt: 1 }), document({ id: '2', uploadedAt: 2 })];
    sortDocuments(given);
    expect(given.map((entry) => entry.id)).toEqual(['1', '2']);
  });
});

describe('documentFacts', () => {
  it('lists format, size, pages and words', () => {
    expect(documentFacts(document({}))).toEqual(['PDF', '2.4 MB', '24 pages', '5,210 words']);
  });

  it('leaves out pages for a format without them', () => {
    expect(documentFacts(document({ format: 'docx', pageCount: null, wordCount: 1 }))).toEqual([
      'DOCX',
      '2.4 MB',
      '1 word',
    ]);
  });

  it('leaves out pages and words until the document has been read', () => {
    expect(documentFacts(document({ status: 'queued', pageCount: null, wordCount: 0 }))).toEqual([
      'PDF',
      '2.4 MB',
    ]);
  });

  it('shows the version only once the file has been replaced', () => {
    expect(documentFacts(document({ version: 1 }))).not.toContain('Version 1');
    expect(documentFacts(document({ version: 2 }))).toContain('Version 2');
    expect(documentFacts(document({ version: 7 })).at(-1)).toBe('Version 7');
  });
});

describe('tallyDocuments and isBeingRead', () => {
  it('counts documents by where they have got to', () => {
    expect(
      tallyDocuments([
        { status: 'ready' },
        { status: 'ready' },
        { status: 'queued' },
        { status: 'extracting' },
        { status: 'indexing' },
        { status: 'failed' },
      ]),
    ).toEqual({ total: 6, ready: 2, reading: 3, failed: 1 });
    expect(tallyDocuments([])).toEqual({ total: 0, ready: 0, reading: 0, failed: 0 });
  });

  it('treats waiting, reading and indexing as still being read', () => {
    expect(isBeingRead('queued')).toBe(true);
    expect(isBeingRead('extracting')).toBe(true);
    expect(isBeingRead('indexing')).toBe(true);
    expect(isBeingRead('ready')).toBe(false);
    expect(isBeingRead('failed')).toBe(false);
  });
});

describe('draftReadiness', () => {
  it('asks for documents first when there are none', () => {
    expect(draftReadiness({ total: 0, ready: 0, reading: 0, failed: 0 })).toEqual({
      ready: false,
      reason: 'Upload documents first. A draft is made from the documents in your Knowledge Hub.',
      openDocuments: true,
    });
  });

  it('waits while every document is still being read', () => {
    const readiness = draftReadiness({ total: 2, ready: 0, reading: 2, failed: 0 });
    expect(readiness).toMatchObject({ ready: false, openDocuments: false });
  });

  it('says so when no document could be read', () => {
    const readiness = draftReadiness({ total: 2, ready: 0, reading: 0, failed: 2 });
    expect(readiness).toMatchObject({ ready: false, openDocuments: true });
    expect(readiness.ready ? '' : readiness.reason).toContain('could be read');
  });

  it('is ready once one document has been read, and says what is left out', () => {
    expect(draftReadiness({ total: 3, ready: 3, reading: 0, failed: 0 })).toEqual({
      ready: true,
      note: '',
    });
    expect(draftReadiness({ total: 3, ready: 2, reading: 1, failed: 0 })).toEqual({
      ready: true,
      note: 'One document is still being read and will not be included.',
    });
    expect(draftReadiness({ total: 4, ready: 1, reading: 2, failed: 1 })).toEqual({
      ready: true,
      note: '2 documents are still being read and will not be included.',
    });
  });

  it('leaves the decision to main when the documents could not be counted', () => {
    expect(draftReadiness(null)).toEqual({ ready: true, note: '' });
  });
});
