// What the Documents tab says and how it orders what it shows: the files the
// Knowledge Hub reads, the categories a document can have, the facts listed
// beside each document, and whether there is anything yet to draft a profile
// from. Kept apart from the components so it can be tested.

import {
  ACCEPTED_EXTENSIONS,
  KNOWLEDGE_CATEGORY_LABELS,
  MAX_DOCUMENT_BYTES,
  type DocumentFormat,
  type KnowledgeCategory,
  type KnowledgeDocument,
  type ProcessingStatus,
} from '../../../shared/funding.js';
import { formatFileSize, pluralize } from '../../lib/funding-client.js';

/** "a", "a and b", "a, b and c". */
export function listInWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export const FORMAT_NAMES: Record<DocumentFormat, string> = {
  pdf: 'PDF',
  docx: 'DOCX',
  txt: 'TXT',
  md: 'Markdown',
};

/**
 * Which files are read, as the end of a sentence. Built from the table main
 * checks uploads against, so the screen cannot promise a format main refuses.
 */
export const ACCEPTED_FILES = `${listInWords(
  (Object.keys(ACCEPTED_EXTENSIONS) as DocumentFormat[]).map((format) => FORMAT_NAMES[format]),
)} files, up to ${formatFileSize(MAX_DOCUMENT_BYTES)} each`;

// The kinds of document that tell BulleBrowser most, in the plural. Keyed by
// category so that a category added to the contract has to be named here too.
const HELPFUL_KINDS: Record<Exclude<KnowledgeCategory, 'other'>, string> = {
  strategic_plan: 'strategic plans',
  organizational_profile: 'organizational profiles',
  program_description: 'program descriptions',
  impact_report: 'impact reports',
  budget: 'budgets',
  previous_proposal: 'previous proposals',
};

/** "strategic plans, organizational profiles, … and previous proposals". */
export const HELPFUL_DOCUMENTS = listInWords(Object.values(HELPFUL_KINDS));

/** The upload choice that leaves the category to main, which reads it from the file's name. */
export const DECIDE_FROM_FILE_NAME = 'Decide from the file name';

/** Every category, in the contract's order. */
export const CATEGORIES = Object.keys(KNOWLEDGE_CATEGORY_LABELS) as KnowledgeCategory[];

/** The category a select's value stands for, or null for "decide from the file name". */
export function asCategory(value: string): KnowledgeCategory | null {
  return (CATEGORIES as string[]).includes(value) ? (value as KnowledgeCategory) : null;
}

/** True while a document is still on its way to being readable and searchable. */
export function isBeingRead(status: ProcessingStatus): boolean {
  return status === 'queued' || status === 'extracting' || status === 'indexing';
}

/** Newest upload first. Documents added together keep the order of their names. */
export function sortDocuments(documents: readonly KnowledgeDocument[]): KnowledgeDocument[] {
  return [...documents].sort(
    (a, b) =>
      b.uploadedAt - a.uploadedAt || a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id),
  );
}

/**
 * The facts listed under a document's name. Pages and words appear once the
 * document has been read, and the version only once the file has been replaced.
 */
export function documentFacts(
  document: Pick<KnowledgeDocument, 'format' | 'sizeBytes' | 'pageCount' | 'wordCount' | 'version'>,
): string[] {
  const facts = [FORMAT_NAMES[document.format], formatFileSize(document.sizeBytes)];
  if (typeof document.pageCount === 'number' && document.pageCount > 0) {
    facts.push(pluralize(document.pageCount, 'page'));
  }
  if (document.wordCount > 0) facts.push(pluralize(document.wordCount, 'word'));
  if (document.version > 1) facts.push(`Version ${document.version}`);
  return facts;
}

export interface DocumentTally {
  total: number;
  ready: number;
  reading: number;
  failed: number;
}

export function tallyDocuments(
  documents: readonly Pick<KnowledgeDocument, 'status'>[],
): DocumentTally {
  const tally: DocumentTally = { total: documents.length, ready: 0, reading: 0, failed: 0 };
  for (const document of documents) {
    if (document.status === 'ready') tally.ready += 1;
    else if (document.status === 'failed') tally.failed += 1;
    else tally.reading += 1;
  }
  return tally;
}

/**
 * Whether a profile can be drafted from what the Knowledge Hub holds.
 *  ready      — at least one document has been read; `note` says what is left out.
 *  not ready  — `reason` says why, and `openDocuments` says whether the
 *               Documents tab is where to fix it.
 */
export type DraftReadiness =
  | { ready: true; note: string }
  | { ready: false; reason: string; openDocuments: boolean };

/** A null tally means the documents could not be counted; main then has the say. */
export function draftReadiness(tally: DocumentTally | null): DraftReadiness {
  if (!tally) return { ready: true, note: '' };
  if (tally.total === 0) {
    return {
      ready: false,
      reason: 'Upload documents first. A draft is made from the documents in your Knowledge Hub.',
      openDocuments: true,
    };
  }
  if (tally.ready === 0) {
    return tally.reading > 0
      ? {
          ready: false,
          reason: 'Your documents are still being read. You can draft the profile once one is ready.',
          openDocuments: false,
        }
      : {
          ready: false,
          reason:
            'None of your documents could be read. Replace them or upload others in Documents.',
          openDocuments: true,
        };
  }
  if (tally.reading === 0) return { ready: true, note: '' };
  return {
    ready: true,
    note:
      tally.reading === 1
        ? 'One document is still being read and will not be included.'
        : `${pluralize(tally.reading, 'document')} are still being read and will not be included.`,
  };
}
