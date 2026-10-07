// The Organization Knowledge Hub: one organization's own documents, what can
// be searched in them, and the profile a person has confirmed from them.
//
// Three things are kept in step here. The shelf (a DocumentLibrary) holds the
// files and the text read from them. The index holds that text as passages, in
// memory, one index per organization. The profile holds statements that cite
// passages. Whenever the shelf changes, the other two follow: a replaced or
// deleted document leaves the index at once, and every statement that cited it
// is checked again against what is on the shelf now.
//
// Nothing here is shared between organizations. Every method names one
// organization, everything held in memory is keyed by that organization's id,
// and disk is reached only through the shelf and the profile store, which
// resolve every path inside that organization's own directory.

import {
  KNOWLEDGE_CATEGORY_LABELS,
  type Citation,
  type FundingEvent,
  type KnowledgeCategory,
  type KnowledgeDocument,
  type KnowledgePassage,
  type NewClaimInput,
  type OpportunityFilters,
  type Organization,
  type OrganizationProfile,
  type ProfileFieldId,
  type SetupStatus,
} from '../../shared/funding.js';
import type { ExtractedBlock } from '../documents/types.js';
import { DocumentLibrary, displayName, type ExtractFile, type LibraryRecord } from '../funding/document-library.js';
import { FundingError, isFundingError } from '../funding/errors.js';
import { assertUuid } from '../funding/org-store.js';
import type { SourceDocument } from '../funding/pipeline.js';
import type { Actor, ApprovedBaseline, ExtractionOutcome, KnowledgeHubApi } from '../funding/services.js';
import type { ProfileTerm } from '../opportunities/match.js';
import { guessCategory, isKnowledgeCategory } from './categories.js';
import { citeEvidence, citedVersions, type ReadableDocument, type SourceChange } from './claim-evidence.js';
import { PROFILE_FIELD_QUERIES } from './field-queries.js';
import { buildPassages } from './passages.js';
import { isProfileField, ProfileStore } from './profile-store.js';
import { profileTermsOf } from './profile-terms.js';
import { SearchIndex, type IndexedDocument } from './search-index.js';
import { setupStatusOf } from './setup-status.js';
import { suggestFiltersFor } from './suggest-filters.js';

export interface KnowledgeHubDeps {
  extract: ExtractFile;
  emit: (event: FundingEvent) => void;
  now?: () => number;
}

/** A document as the shelf records it. */
type Shelved = LibraryRecord & { category: KnowledgeCategory };

interface Refusal {
  name: string;
  code: FundingError['code'];
  reason: string;
}

const MAX_FILES_AT_ONCE = 25;
const DEFAULT_SEARCH_LIMIT = 8;
const MAX_SEARCH_LIMIT = 50;
const MAX_SUGGESTIONS = 8;
/** Longer than any search a person or a pipeline needs; the rest is not read. */
const MAX_QUERY_CHARS = 2_000;
/** How often a document's record and text are read again when one changed under the other. */
const READ_ATTEMPTS = 3;

const invalid = (message: string) => new FundingError('INVALID_INPUT', message);

const categoryOf = (record: Shelved): KnowledgeCategory =>
  isKnowledgeCategory(record.category) ? record.category : 'other';

function toDocument(record: Shelved): KnowledgeDocument {
  return {
    id: record.id,
    organizationId: record.organizationId,
    name: record.name,
    format: record.format,
    category: categoryOf(record),
    sizeBytes: record.sizeBytes,
    sha256: record.sha256,
    version: record.version,
    status: record.status,
    statusDetail: record.statusDetail,
    warnings: [...record.warnings],
    pageCount: record.pageCount,
    blockCount: record.blockCount,
    wordCount: record.wordCount,
    uploadedAt: record.uploadedAt,
    updatedAt: record.updatedAt,
    uploadedBy: record.uploadedBy,
  };
}

function indexed(record: Shelved, blocks: ExtractedBlock[]): IndexedDocument {
  return {
    documentId: record.id,
    documentName: record.name,
    documentVersion: record.version,
    category: categoryOf(record),
    passages: buildPassages(record.id, blocks),
  };
}

function refusalOf(path: string, error: unknown): Refusal {
  const name = displayName(path);
  if (isFundingError(error)) return { name, code: error.code, reason: error.message };
  // Whatever went wrong may quote a path, so only the log sees it.
  console.error('[funding] a document could not be added', error);
  return { name, code: 'INTERNAL', reason: 'This file could not be added. Try again.' };
}

/** One sentence per refused file, and what became of the rest. */
function refusalMessage(refused: Refusal[], added: number): string {
  const reasons = refused.map(({ name, reason }) => (reason.includes(`"${name}"`) ? reason : `"${name}": ${reason}`));
  const total = refused.length + added;
  if (total === 1) return reasons.join(' ');
  const count = `${refused.length} of ${total} files ${refused.length === 1 ? 'was' : 'were'} not added.`;
  let rest = 'No file was added.';
  if (added === 1) rest = 'The other file was added.';
  else if (added > 1) rest = `The other ${added} files were added.`;
  return [count, ...reasons, rest].join(' ');
}

export class KnowledgeHub implements KnowledgeHubApi {
  private readonly library: DocumentLibrary<{ category: KnowledgeCategory }>;
  private readonly profiles: ProfileStore;
  // One index per organization, built the first time that organization is
  // asked about. The promise is kept, not the index, so that everything which
  // happens while an index is being built waits for it and is applied after.
  private readonly indexes = new Map<string, Promise<SearchIndex>>();
  // Documents deleted during this run of the app, by organization. A reading
  // that was under way when one was deleted may still come back citing it.
  private readonly deleted = new Map<string, Set<string>>();

  constructor(private readonly deps: KnowledgeHubDeps) {
    const now = deps.now ?? (() => Date.now());
    this.library = new DocumentLibrary<{ category: KnowledgeCategory }>({
      area: 'knowledge',
      extract: deps.extract,
      now,
      onChange: (organizationId) => this.announce({ kind: 'documents_changed', organizationId }),
      onProcessed: (record, blocks) => this.documentRead(record, blocks),
      onRemoved: (record) => this.documentRemoved(record),
    });
    this.profiles = new ProfileStore({
      now,
      onChange: (organizationId) => this.announce({ kind: 'profile_changed', organizationId }),
    });
  }

  /** Tells whoever is listening. A listener that fails must not undo a change that is already stored. */
  private announce(event: FundingEvent): void {
    try {
      this.deps.emit(event);
    } catch (error) {
      console.error('[funding] a change could not be announced', error);
    }
  }

  // ────────────────────────────────── documents ──────────────────────────────────

  async listDocuments(organizationId: string): Promise<KnowledgeDocument[]> {
    return (await this.library.list(organizationId)).map(toDocument);
  }

  /**
   * Adds the files a person chose. Each file stands alone: one that is refused
   * does not stop the others, and the refusal that is raised afterwards names
   * every file that was left out and why.
   */
  async addDocuments(
    organizationId: string,
    input: { paths: string[]; category?: KnowledgeCategory; userId: string },
  ): Promise<KnowledgeDocument[]> {
    assertUuid(organizationId, 'organization');
    const paths: unknown = input?.paths;
    if (!Array.isArray(paths) || !paths.every((path): path is string => typeof path === 'string' && path !== '')) {
      throw invalid('Those files could not be added. Choose them again.');
    }
    if (paths.length > MAX_FILES_AT_ONCE) throw invalid(`Add up to ${MAX_FILES_AT_ONCE} files at a time.`);
    if (input.category !== undefined && !isKnowledgeCategory(input.category)) {
      throw invalid('That document category is not one the app uses.');
    }

    // A file already in the hub comes back as the document it already is, so
    // the same document can be answered twice; it is listed once.
    const added = new Map<string, Shelved>();
    const refused: Refusal[] = [];
    for (const path of paths) {
      try {
        const record = await this.library.addFile(organizationId, {
          sourcePath: path,
          uploadedBy: input.userId,
          extra: { category: input.category ?? guessCategory(path) },
        });
        added.set(record.id, record);
      } catch (error) {
        refused.push(refusalOf(path, error));
      }
    }
    const first = refused[0];
    if (first) throw new FundingError(first.code, refusalMessage(refused, paths.length - refused.length));
    return [...added.values()].map(toDocument);
  }

  async replaceDocument(organizationId: string, documentId: string, sourcePath: string): Promise<KnowledgeDocument> {
    const record = await this.library.replaceFile(organizationId, documentId, { sourcePath });
    // The old wording must not be found while the new file is being read.
    await this.reindex(organizationId, documentId);
    return toDocument(record);
  }

  async setCategory(
    organizationId: string,
    documentId: string,
    category: KnowledgeCategory,
  ): Promise<KnowledgeDocument> {
    if (!isKnowledgeCategory(category)) throw invalid('That document category is not one the app uses.');
    const record = await this.library.update(organizationId, documentId, { category });
    // A search result carries its document's category, so the index learns of it too.
    await this.reindex(organizationId, documentId);
    return toDocument(record);
  }

  async retryDocument(organizationId: string, documentId: string): Promise<KnowledgeDocument> {
    const record = await this.library.retry(organizationId, documentId);
    await this.reindex(organizationId, documentId);
    return toDocument(record);
  }

  async deleteDocument(organizationId: string, documentId: string): Promise<void> {
    if (!(await this.library.get(organizationId, documentId))) {
      throw new FundingError('NOT_FOUND', 'That document is no longer here.');
    }
    // Statements are flagged before the file goes. Should anything fail in
    // between, a statement is flagged for a document that is still here, which
    // a person can see and undo; the other order could leave an approved
    // statement quoting a document that no longer exists, with nothing to show it.
    this.rememberDeleted(organizationId, documentId);
    await this.profiles.sourcesChanged(organizationId, [{ kind: 'deleted', documentId }]);
    await this.library.remove(organizationId, documentId);
  }

  // ───────────────────────────── searchable knowledge ────────────────────────────

  async search(organizationId: string, query: string, limit = DEFAULT_SEARCH_LIMIT): Promise<KnowledgePassage[]> {
    assertUuid(organizationId, 'organization');
    if (typeof query !== 'string') throw invalid('That search is not valid.');
    if (!query.trim()) return [];
    const wanted =
      typeof limit === 'number' && Number.isFinite(limit)
        ? Math.min(MAX_SEARCH_LIMIT, Math.max(1, Math.floor(limit)))
        : DEFAULT_SEARCH_LIMIT;
    const index = await this.index(organizationId);
    return index.search(query.slice(0, MAX_QUERY_CHARS), { limit: wanted });
  }

  async suggestPassages(organizationId: string, field: ProfileFieldId): Promise<KnowledgePassage[]> {
    if (!isProfileField(field)) throw invalid('That part of the profile is not one the app uses.');
    const index = await this.index(organizationId);
    // The field's phrases are searched together, which ranks a passage by all
    // it shares with them. Two documents often hold the same paragraph (a plan
    // and its later revision), and the same wording is offered once.
    const found = index.search(PROFILE_FIELD_QUERIES[field].join(' '), { limit: MAX_SEARCH_LIMIT });
    const offered = new Set<string>();
    const passages: KnowledgePassage[] = [];
    for (const passage of found) {
      const wording = passage.text.toLowerCase().replace(/\s+/gu, ' ').trim();
      if (offered.has(wording)) continue;
      offered.add(wording);
      passages.push(passage);
      if (passages.length === MAX_SUGGESTIONS) break;
    }
    return passages;
  }

  /** The documents that have been read, oldest first, so the same shelf is always presented in the same order. */
  async sourceDocuments(organizationId: string): Promise<SourceDocument[]> {
    const ready = (await this.library.list(organizationId))
      .filter((record) => record.status === 'ready')
      .sort((a, b) => a.uploadedAt - b.uploadedAt || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.id < b.id ? -1 : 1));
    const documents: SourceDocument[] = [];
    for (const { id } of ready) {
      const source = await this.readable(organizationId, id);
      if (!source) continue;
      documents.push({
        id,
        name: source.record.name,
        version: source.record.version,
        label: KNOWLEDGE_CATEGORY_LABELS[categoryOf(source.record)],
        blocks: source.blocks,
      });
    }
    return documents;
  }

  /**
   * A document's record and its text as they stand together, or null when it
   * has no text to offer right now. The two are separate files, so the record
   * is read again afterwards: versions only go up, and an unchanged version
   * means the text read in between belongs to it.
   */
  private async readable(
    organizationId: string,
    documentId: string,
  ): Promise<{ record: Shelved; blocks: ExtractedBlock[] } | null> {
    for (let attempt = 0; attempt < READ_ATTEMPTS; attempt++) {
      const before = await this.library.get(organizationId, documentId);
      if (!before || before.status !== 'ready') return null;
      const blocks = await this.library.blocks(organizationId, documentId);
      const record = await this.library.get(organizationId, documentId);
      if (record?.status === 'ready' && record.version === before.version) return blocks ? { record, blocks } : null;
    }
    return null;
  }

  private index(organizationId: string): Promise<SearchIndex> {
    const held = this.indexes.get(organizationId);
    if (held) return held;
    const building = this.buildIndex(organizationId);
    this.indexes.set(organizationId, building);
    // A build that failed is forgotten, so the next question tries again.
    building.catch(() => {
      if (this.indexes.get(organizationId) === building) this.indexes.delete(organizationId);
    });
    return building;
  }

  private async buildIndex(organizationId: string): Promise<SearchIndex> {
    const index = new SearchIndex();
    for (const record of await this.library.list(organizationId)) {
      if (record.status !== 'ready') continue;
      const source = await this.readable(organizationId, record.id);
      if (source) index.add(indexed(source.record, source.blocks));
    }
    return index;
  }

  /**
   * Brings one document's entry in the index up to date with the shelf: its
   * current passages when it has been read, nothing otherwise. An organization
   * nobody has asked about has no index yet, and gets one from the shelf when
   * somebody does. `known` is text already at hand for one version.
   */
  private async reindex(
    organizationId: string,
    documentId: string,
    known?: { version: number; blocks: ExtractedBlock[] },
  ): Promise<void> {
    const held = this.indexes.get(organizationId);
    if (!held) return;
    const index = await held.catch(() => null);
    if (!index) return;
    const record = await this.library.get(organizationId, documentId);
    if (record?.status === 'ready' && known?.version === record.version) {
      index.add(indexed(record, known.blocks));
      return;
    }
    const source = record?.status === 'ready' ? await this.readable(organizationId, documentId) : null;
    if (source) index.add(indexed(source.record, source.blocks));
    else index.remove(documentId);
  }

  // ───────────────────────────── when the shelf changes ──────────────────────────

  private rememberDeleted(organizationId: string, documentId: string): void {
    const gone = this.deleted.get(organizationId) ?? new Set<string>();
    gone.add(documentId);
    this.deleted.set(organizationId, gone);
  }

  // The shelf takes an error from one of its callbacks for a failure to read
  // the file, which it is not. So a step that fails here is logged and not
  // thrown, and the profile is checked against the shelf again the next time
  // it is used (see `settled`).
  private async attempt(what: string, work: () => Promise<unknown>): Promise<void> {
    try {
      await work();
    } catch (error) {
      console.error(`[funding] ${what} could not be updated after a document changed`, error);
    }
  }

  /** A document has been read, or could not be. */
  private async documentRead(record: Shelved, blocks: ExtractedBlock[] | null): Promise<void> {
    const { organizationId, id, name, version } = record;
    await this.attempt('The search index', () =>
      this.reindex(organizationId, id, blocks ? { version, blocks } : undefined),
    );
    // Statements that cite an earlier version are checked against this one. A
    // first reading has no earlier version, so it changes nothing.
    await this.attempt('The profile', () =>
      this.profiles.sourcesChanged(organizationId, [{ kind: 'replaced', document: { id, name, version }, blocks }]),
    );
  }

  /** A document and its text have been deleted. */
  private async documentRemoved(record: Shelved): Promise<void> {
    const { organizationId, id } = record;
    this.rememberDeleted(organizationId, id);
    const held = this.indexes.get(organizationId);
    if (held) (await held.catch(() => null))?.remove(id);
    // Deleting flags the profile before the file goes; this catches a statement
    // that came to cite the document in between.
    await this.attempt('The profile', () =>
      this.profiles.sourcesChanged(organizationId, [{ kind: 'deleted', documentId: id }]),
    );
  }

  /**
   * The profile, once its citations agree with the shelf.
   *
   * Changes to documents are followed as they happen. This is the second line
   * of defence: a draft that was written while a document was being replaced,
   * a replacement that finished after the app was closed and opened again, or
   * a step that failed, each leave a citation to an older version than the one
   * on the shelf, or to a document deleted during this run. Those are settled
   * here, the same way, before the profile is used. A citation to a document
   * the shelf has no record of at all is left as it is.
   */
  private async settled(organizationId: string): Promise<OrganizationProfile> {
    const profile = await this.profiles.get(organizationId);
    const cited = citedVersions(profile.claims);
    if (cited.size === 0) return profile;

    const shelf = new Map((await this.library.list(organizationId)).map((record) => [record.id, record]));
    const gone = this.deleted.get(organizationId);
    const changes: SourceChange[] = [];
    for (const [documentId, oldestCited] of cited) {
      const record = shelf.get(documentId);
      if (!record) {
        if (gone?.has(documentId)) changes.push({ kind: 'deleted', documentId });
        continue;
      }
      if (oldestCited >= record.version) continue;
      const document = { id: record.id, name: record.name, version: record.version };
      if (record.status === 'failed') {
        changes.push({ kind: 'replaced', document, blocks: null });
      } else if (record.status === 'ready') {
        // Still being read, or changed again meanwhile: it will be reported when it is done.
        const source = await this.readable(organizationId, documentId);
        if (source && source.record.version === record.version) {
          changes.push({ kind: 'replaced', document, blocks: source.blocks });
        }
      }
    }
    return changes.length > 0 ? this.profiles.sourcesChanged(organizationId, changes) : profile;
  }

  // ──────────────────────────────────── profile ──────────────────────────────────

  getProfile(organizationId: string): Promise<OrganizationProfile> {
    return this.settled(organizationId);
  }

  async setupStatus(organization: Organization): Promise<SetupStatus> {
    const documents = await this.listDocuments(organization.id);
    return setupStatusOf(organization, documents, await this.settled(organization.id));
  }

  beginExtraction(organizationId: string): Promise<void> {
    return this.profiles.beginExtraction(organizationId);
  }

  async applyExtraction(organizationId: string, outcome: ExtractionOutcome): Promise<OrganizationProfile> {
    await this.profiles.applyExtraction(organizationId, outcome);
    // The documents may have changed while they were being read.
    return this.settled(organizationId);
  }

  endExtraction(organizationId: string, message: string): Promise<void> {
    return this.profiles.endExtraction(organizationId, message);
  }

  async approveClaims(organizationId: string, claimIds: string[], actor: Actor): Promise<OrganizationProfile> {
    await this.settled(organizationId);
    return this.profiles.approveClaims(organizationId, claimIds, actor);
  }

  async rejectClaims(organizationId: string, claimIds: string[], actor: Actor): Promise<OrganizationProfile> {
    await this.settled(organizationId);
    return this.profiles.rejectClaims(organizationId, claimIds, actor);
  }

  async addClaim(organizationId: string, input: NewClaimInput, actor: Actor): Promise<OrganizationProfile> {
    return this.profiles.addClaim(organizationId, input, actor, (evidence) => this.cite(organizationId, evidence));
  }

  async updateClaim(
    organizationId: string,
    claimId: string,
    text: string,
    actor: Actor,
  ): Promise<OrganizationProfile> {
    await this.settled(organizationId);
    return this.profiles.updateClaim(organizationId, claimId, text, actor);
  }

  async deleteClaim(organizationId: string, claimId: string, actor: Actor): Promise<OrganizationProfile> {
    await this.settled(organizationId);
    return this.profiles.deleteClaim(organizationId, claimId, actor);
  }

  async resolveConflict(
    organizationId: string,
    conflictId: string,
    keepClaimIds: string[],
    actor: Actor,
  ): Promise<OrganizationProfile> {
    await this.settled(organizationId);
    return this.profiles.resolveConflict(organizationId, conflictId, keepClaimIds, actor);
  }

  /**
   * Citations for the passages a person picked, each checked against the text
   * of a document that is on this organization's shelf and has been read.
   */
  private async cite(organizationId: string, evidence: NewClaimInput['evidence']): Promise<Citation[]> {
    const byDocument = new Map<string, NewClaimInput['evidence']>();
    for (const piece of evidence) {
      byDocument.set(piece.documentId, [...(byDocument.get(piece.documentId) ?? []), piece]);
    }
    const citations: Citation[] = [];
    for (const [documentId, pieces] of byDocument) {
      const record = await this.library.get(organizationId, documentId);
      if (!record) {
        throw invalid('A passage you chose is from a document that is no longer here. Choose the passage again.');
      }
      const source = await this.readable(organizationId, documentId);
      if (!source) {
        throw invalid(`"${record.name}" has not been read, so its passages cannot be used as evidence yet.`);
      }
      const document: ReadableDocument = {
        id: source.record.id,
        name: source.record.name,
        version: source.record.version,
        blocks: source.blocks,
      };
      citations.push(...citeEvidence(document, pieces));
    }
    return citations;
  }

  // ───────────────────────────── for guidance and search ─────────────────────────

  async baseline(organization: Organization): Promise<ApprovedBaseline> {
    const profile = await this.settled(organization.id);
    const claims = profile.claims.filter((claim) => claim.status === 'approved');
    return {
      organizationId: organization.id,
      organization: {
        name: organization.name,
        kind: organization.kind,
        location: { ...organization.location },
      },
      claims,
      approvedAt: claims.length > 0 ? profile.approvedAt : null,
    };
  }

  async profileTerms(organizationId: string): Promise<ProfileTerm[]> {
    return profileTermsOf((await this.settled(organizationId)).claims);
  }

  async suggestFilters(organization: Organization): Promise<{ filters: OpportunityFilters; basis: string[] }> {
    return suggestFiltersFor(organization, (await this.settled(organization.id)).claims);
  }

  // ─────────────────────────────────── lifetime ──────────────────────────────────

  async whenIdle(organizationId: string): Promise<void> {
    // Listing is what picks up documents an earlier run of the app left half-read.
    await this.library.list(organizationId);
    await this.library.whenIdle(organizationId);
  }

  forget(organizationId: string): void {
    this.indexes.delete(organizationId);
    this.deleted.delete(organizationId);
    this.profiles.forget(organizationId);
  }
}
