// Keyword search over one organization's passages.
//
// One SearchIndex holds one organization's documents and nothing else. All of
// its state lives in the instance, so two indexes can never see each other's
// passages: keeping organizations apart is a matter of which index is asked.
//
// Ranking is BM25 over the terms from tokenize(). The document's name and the
// passage's section count as part of the passage, so a search for "budget"
// finds the budget file and a search for "mission" finds the text under that
// heading even when the text never uses the word.

import type { KnowledgeCategory, KnowledgePassage } from '../../shared/funding.js';
import type { Passage } from './passages.js';
import { tokenize } from './text.js';

export interface IndexedDocument {
  documentId: string;
  documentName: string;
  documentVersion: number;
  category: KnowledgeCategory;
  passages: Passage[];
}

export interface SearchOptions {
  /** How many passages to return. Default 8, at most 50. */
  limit?: number;
  /** Only these documents. An empty list matches nothing. */
  documentIds?: string[];
  /** Only documents in these categories. An empty list matches nothing. */
  categories?: KnowledgeCategory[];
}

const K1 = 1.2;
const B = 0.75;
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 50;

interface Entry {
  document: StoredDocument;
  /** Position of the passage within its document. */
  order: number;
  blockIds: string[];
  page: number | null;
  section: string;
  text: string;
  /** Number of terms, repeats included. */
  length: number;
  frequencies: Map<string, number>;
}

interface StoredDocument {
  documentId: string;
  documentName: string;
  documentVersion: number;
  category: KnowledgeCategory;
  entries: Entry[];
}

/** A file name without its extension, so "pdf" is not a search term for every passage. */
function nameWithoutExtension(name: string): string {
  return name.replace(/\.[A-Za-z0-9]{1,8}$/, '');
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export class SearchIndex {
  private readonly documents = new Map<string, StoredDocument>();
  /** For each term, the passages that contain it and how often. */
  private readonly postings = new Map<string, Map<Entry, number>>();
  private passages = 0;
  private totalLength = 0;

  get documentCount(): number {
    return this.documents.size;
  }

  get passageCount(): number {
    return this.passages;
  }

  has(documentId: string): boolean {
    return this.documents.has(documentId);
  }

  /** Adds a document. One already held under the same id is replaced entirely. */
  add(document: IndexedDocument): void {
    this.remove(document.documentId);
    const stored: StoredDocument = {
      documentId: document.documentId,
      documentName: document.documentName,
      documentVersion: document.documentVersion,
      category: document.category,
      entries: [],
    };
    const nameTerms = tokenize(nameWithoutExtension(document.documentName));

    document.passages.forEach((passage, order) => {
      const terms = [...tokenize(passage.text), ...tokenize(passage.section), ...nameTerms];
      const frequencies = new Map<string, number>();
      for (const term of terms) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
      const entry: Entry = {
        document: stored,
        order,
        blockIds: [...passage.blockIds],
        page: passage.page,
        section: passage.section,
        text: passage.text,
        length: terms.length,
        frequencies,
      };
      stored.entries.push(entry);
      for (const [term, count] of frequencies) {
        const posting = this.postings.get(term) ?? new Map<Entry, number>();
        posting.set(entry, count);
        this.postings.set(term, posting);
      }
      this.passages += 1;
      this.totalLength += terms.length;
    });
    this.documents.set(stored.documentId, stored);
  }

  /** Removes a document and every passage it contributed. Unknown ids are ignored. */
  remove(documentId: string): void {
    const stored = this.documents.get(documentId);
    if (!stored) return;
    for (const entry of stored.entries) {
      for (const term of entry.frequencies.keys()) {
        const posting = this.postings.get(term);
        posting?.delete(entry);
        if (posting?.size === 0) this.postings.delete(term);
      }
      this.passages -= 1;
      this.totalLength -= entry.length;
    }
    this.documents.delete(documentId);
  }

  /**
   * The passages that best match the query, best first. Order is fully
   * determined: score, then document name, then document id, then the passage's
   * place in its document. Scores are comparable within one result list only;
   * they are computed over the whole index, whatever filters are given.
   */
  search(query: string, options: SearchOptions = {}): KnowledgePassage[] {
    // Sorted, so the sum below does not depend on the order the query was typed in.
    const terms = [...new Set(tokenize(query))].sort(compareText);
    if (terms.length === 0 || this.passages === 0) return [];

    const requested = options.limit;
    const limit =
      typeof requested === 'number' && Number.isFinite(requested)
        ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(requested)))
        : DEFAULT_LIMIT;
    const documentIds = options.documentIds ? new Set(options.documentIds) : null;
    const categories = options.categories ? new Set(options.categories) : null;

    const averageLength = this.totalLength / this.passages || 1;
    const scores = new Map<Entry, number>();
    for (const term of terms) {
      const posting = this.postings.get(term);
      if (!posting) continue;
      const inverse = Math.log(1 + (this.passages - posting.size + 0.5) / (posting.size + 0.5));
      for (const [entry, frequency] of posting) {
        if (documentIds && !documentIds.has(entry.document.documentId)) continue;
        if (categories && !categories.has(entry.document.category)) continue;
        const normalized = frequency + K1 * (1 - B + (B * entry.length) / averageLength);
        scores.set(entry, (scores.get(entry) ?? 0) + (inverse * frequency * (K1 + 1)) / normalized);
      }
    }

    return [...scores]
      .map(([entry, score]) => ({ entry, score: Math.round(score * 10_000) / 10_000 }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          compareText(a.entry.document.documentName, b.entry.document.documentName) ||
          compareText(a.entry.document.documentId, b.entry.document.documentId) ||
          a.entry.order - b.entry.order,
      )
      .slice(0, limit)
      .map(({ entry, score }) => ({
        documentId: entry.document.documentId,
        documentName: entry.document.documentName,
        documentVersion: entry.document.documentVersion,
        category: entry.document.category,
        blockIds: [...entry.blockIds],
        page: entry.page,
        section: entry.section,
        text: entry.text,
        score,
      }));
  }
}
