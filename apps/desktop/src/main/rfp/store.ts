// Funding documents under analysis: solicitations the user uploaded and
// official listings shelved as text, each with its analysis and its alignment
// report.
//
// They are kept on a shelf of their own, apart from the organization's
// permanent knowledge. Nothing here reads or writes the Knowledge Hub, its
// search index or the organization's profile, so a funder's document can be
// analyzed and thrown away without ever changing what the organization has
// confirmed about itself.
//
//   <organization>/rfps/documents.json         registry
//   <organization>/rfps/files/<id>             the file as uploaded
//   <organization>/rfps/text/<id>.json         blocks read from it
//   <organization>/rfps/analysis/<id>.json     its analysis
//   <organization>/rfps/alignment/<id>.json    its alignment report

import type {
  AlignmentReport,
  AnalysisStatus,
  FundingDocumentOrigin,
  FundingErrorCode,
  FundingEvent,
  OpportunityDetail,
  ProcessingStatus,
  RfpAnalysis,
  RfpDocument,
} from '../../shared/funding.js';
import type { ExtractedBlock } from '../documents/types.js';
import { DocumentLibrary, displayName, type ExtractFile, type LibraryRecord } from '../funding/document-library.js';
import { FundingError, isFundingError } from '../funding/errors.js';
import { assertUuid, orgPath, readJson, removePath, writeJson } from '../funding/org-store.js';
import type { SourceDocument } from '../funding/pipeline.js';
import type { RfpStoreApi } from '../funding/services.js';
import { assertOpportunityId } from '../opportunities/saved-store.js';
import { listingToDocument, sameListingText } from './from-listing.js';

/** What the shelf keeps for a funding document beside the file itself. */
interface RfpExtra {
  origin: FundingDocumentOrigin;
  /** The listing a document was read from; empty for an upload. */
  opportunityId: string;
  analysisStatus: AnalysisStatus;
  alignmentStatus: AnalysisStatus;
}

type RfpRecord = LibraryRecord & RfpExtra;
type ResultKind = 'analysis' | 'alignment';

const AREA = 'rfps';
const MAX_FILES_AT_ONCE = 10;
const MAX_ERROR_CHARACTERS = 1_000;
const NOT_HERE = 'That funding document is no longer here.';
const IN_PROGRESS: ProcessingStatus[] = ['queued', 'extracting', 'indexing'];

const none = (): AnalysisStatus => ({ state: 'none', updatedAt: null, error: '' });

/** A status as stored, or null when what is there is not one. */
function readStatus(value: unknown): AnalysisStatus | null {
  if (!value || typeof value !== 'object') return null;
  const { state, updatedAt, error } = value as Partial<AnalysisStatus>;
  if (state !== 'none' && state !== 'running' && state !== 'ready' && state !== 'failed') return null;
  return {
    state,
    updatedAt: typeof updatedAt === 'number' && Number.isFinite(updatedAt) ? updatedAt : null,
    error: typeof error === 'string' ? error.slice(0, MAX_ERROR_CHARACTERS) : '',
  };
}

/** The document as the renderer sees it: who uploaded it and the shelf's version counter stay in main. */
function toRfpDocument(record: RfpRecord): RfpDocument {
  return {
    id: record.id,
    organizationId: record.organizationId,
    origin: record.origin === 'listing' ? 'listing' : 'upload',
    opportunityId: typeof record.opportunityId === 'string' ? record.opportunityId : '',
    name: record.name,
    format: record.format,
    sizeBytes: record.sizeBytes,
    sha256: record.sha256,
    status: record.status,
    statusDetail: record.statusDetail,
    warnings: record.warnings,
    pageCount: record.pageCount,
    blockCount: record.blockCount,
    wordCount: record.wordCount,
    uploadedAt: record.uploadedAt,
    updatedAt: record.updatedAt,
    analysisStatus: readStatus(record.analysisStatus) ?? none(),
    alignmentStatus: readStatus(record.alignmentStatus) ?? none(),
  };
}

// The shelf treats a name as a file name and keeps only what follows the last
// slash, which would cut a title such as "Housing/Homelessness Services" in
// half. A listing's title is not a path, so its slashes are written with
// look-alike characters that the shelf leaves alone. The title inside the
// document keeps its own characters.
const shelfName = (name: string): string => name.replace(/\//g, '∕').replace(/\\/g, '∖');

interface Refusal {
  name: string;
  code: FundingErrorCode;
  reason: string;
}

/** One error for every file that was refused, saying what happened to the rest. */
function refusalError(refused: Refusal[], chosen: number): FundingError {
  const [first] = refused;
  const code = first && refused.every((entry) => entry.code === first.code) ? first.code : 'INVALID_INPUT';
  const reasons = refused
    // A reason that already names its file stands as it is.
    .map((entry) => (entry.reason.includes(`"${entry.name}"`) ? entry.reason : `"${entry.name}" was not added: ${entry.reason}`))
    .join(' ');
  if (chosen === 1) return new FundingError(code, reasons);
  const others = chosen - refused.length;
  if (others === 0) return new FundingError(code, `None of the ${chosen} files could be added. ${reasons}`);
  return new FundingError(
    code,
    `${refused.length} of ${chosen} files could not be added. ${reasons} ` +
      (others === 1 ? 'The other file was added.' : `The other ${others} files were added.`),
  );
}

export class RfpStore implements RfpStoreApi {
  private readonly library: DocumentLibrary<RfpExtra>;
  private readonly now: () => number;
  // Listings are shelved one at a time for an organization, so the same listing added twice at once is still one document.
  private readonly listingQueues = new Map<string, Promise<unknown>>();
  // The runs this instance was told about, by organization. A "running" status that is not among them was left by an earlier launch of the app.
  private readonly started = new Map<string, Set<string>>();
  private readonly restored = new Map<string, Promise<void>>();

  constructor(private readonly deps: { extract: ExtractFile; emit: (event: FundingEvent) => void; now?: () => number }) {
    this.now = deps.now ?? (() => Date.now());
    this.library = new DocumentLibrary<RfpExtra>({
      area: AREA,
      extract: deps.extract,
      now: this.now,
      onChange: (organizationId) => this.announce(organizationId),
      onProcessed: (record, blocks, replaced) => this.afterReading(record, blocks, replaced),
      onRemoved: (record) => this.dropResults(record.organizationId, record.id),
    });
  }

  // ─────────────────────────────────── documents ──────────────────────────────────

  async list(organizationId: string): Promise<RfpDocument[]> {
    await this.restoreInterrupted(organizationId);
    return (await this.library.list(organizationId)).map(toRfpDocument);
  }

  async get(organizationId: string, rfpId: string): Promise<RfpDocument | null> {
    const id = assertUuid(rfpId, 'funding document');
    await this.restoreInterrupted(organizationId);
    const record = await this.library.get(organizationId, id);
    return record ? toRfpDocument(record) : null;
  }

  /**
   * Shelves the files that can be shelved. If any was refused, the rest are
   * still added, and one error then names each refused file and why.
   */
  async addFiles(organizationId: string, input: { paths: string[]; userId: string }): Promise<RfpDocument[]> {
    assertUuid(organizationId, 'organization');
    const paths = input?.paths;
    if (!Array.isArray(paths) || paths.some((path) => typeof path !== 'string' || !path) || typeof input.userId !== 'string') {
      throw new FundingError('INVALID_INPUT', 'Those files are not valid.');
    }
    if (paths.length > MAX_FILES_AT_ONCE) {
      throw new FundingError(
        'INVALID_INPUT',
        `You can add up to ${MAX_FILES_AT_ONCE} funding documents at a time. Choose fewer files, then add the rest.`,
      );
    }

    const added = new Map<string, RfpRecord>();
    const refused: Refusal[] = [];
    for (const path of paths) {
      try {
        let record = await this.library.addFile(organizationId, {
          sourcePath: path,
          uploadedBy: input.userId,
          extra: { origin: 'upload', opportunityId: '', analysisStatus: none(), alignmentStatus: none() },
        });
        // The same file chosen again after it failed is a request to try once more.
        if (record.status === 'failed') record = await this.library.retry(organizationId, record.id);
        added.set(record.id, record);
      } catch (error) {
        const name = displayName(path);
        if (isFundingError(error)) {
          refused.push({ name, code: error.code, reason: error.message });
        } else {
          console.error('[funding] a funding document could not be added', error);
          refused.push({ name, code: 'INTERNAL', reason: 'Something went wrong. Try adding it again.' });
        }
      }
    }
    if (refused.length > 0) throw refusalError(refused, paths.length);
    return [...added.values()].map(toRfpDocument);
  }

  /**
   * Shelves an official listing's own text. A listing that is already here is
   * returned as it is. When the source's text has changed since, the new text
   * takes its place and the earlier document goes, with everything made from it.
   */
  async addListing(organizationId: string, input: { detail: OpportunityDetail; userId: string }): Promise<RfpDocument> {
    assertUuid(organizationId, 'organization');
    const opportunity = input?.detail?.opportunity;
    if (!opportunity || typeof opportunity !== 'object' || typeof input.userId !== 'string') {
      throw new FundingError('INVALID_INPUT', 'That listing is not valid.');
    }
    const opportunityId = assertOpportunityId(opportunity.id);
    const { name, document } = listingToDocument(input.detail);

    const previous = this.listingQueues.get(organizationId) ?? Promise.resolve();
    const run = previous.then(async () => {
      const held = (await this.library.list(organizationId)).filter(
        (record) => record.origin === 'listing' && record.opportunityId === opportunityId,
      );
      let current: RfpRecord | null = null;
      for (const record of held) {
        const blocks = await this.library.blocks(organizationId, record.id);
        if (blocks && sameListingText(blocks, document.blocks)) {
          current = record;
          break;
        }
      }
      // The new text is shelved before the old one goes, so a failure in between loses nothing.
      current ??= await this.library.addExtracted(organizationId, {
        name: shelfName(name),
        uploadedBy: input.userId,
        extra: { origin: 'listing', opportunityId, analysisStatus: none(), alignmentStatus: none() },
        document,
      });
      for (const record of held) {
        if (record.id !== current.id) await this.library.remove(organizationId, record.id).catch(() => {});
      }
      return toRfpDocument(current);
    });
    this.listingQueues.set(
      organizationId,
      run.catch(() => {}),
    );
    return run;
  }

  /** Removes the document, the text read from it, its analysis and its alignment report. */
  async remove(organizationId: string, rfpId: string): Promise<void> {
    const record = await this.require(organizationId, rfpId);
    await this.library.remove(organizationId, record.id);
  }

  async source(organizationId: string, rfpId: string): Promise<SourceDocument> {
    const record = await this.require(organizationId, rfpId);
    if (IN_PROGRESS.includes(record.status)) {
      throw new FundingError('INVALID_INPUT', 'This funding document is still being read. Try again in a moment.');
    }
    if (record.status === 'failed') {
      throw new FundingError(
        'INVALID_INPUT',
        `This funding document could not be read, so there is nothing to analyze. ${record.statusDetail}`.trim(),
      );
    }
    const blocks = await this.library.blocks(organizationId, record.id);
    if (!blocks || blocks.length === 0) {
      throw new FundingError(
        'INVALID_INPUT',
        'The text of this funding document is missing. Remove the document, then add it again.',
      );
    }
    return {
      id: record.id,
      name: record.name,
      version: record.version,
      label: record.origin === 'listing' ? 'Official listing' : 'Funding document',
      blocks,
    };
  }

  async whenIdle(organizationId: string): Promise<void> {
    await this.listingQueues.get(organizationId);
    await this.library.whenIdle(organizationId);
  }

  // ─────────────────────────── analyses and alignment reports ───────────────────────────

  analysis(organizationId: string, rfpId: string): Promise<RfpAnalysis | null> {
    return this.readResult<RfpAnalysis>(organizationId, 'analysis', rfpId);
  }

  saveAnalysis(organizationId: string, analysis: RfpAnalysis): Promise<void> {
    return this.saveResult(organizationId, 'analysis', analysis);
  }

  setAnalysisStatus(organizationId: string, rfpId: string, status: AnalysisStatus): Promise<void> {
    return this.setStatus(organizationId, 'analysis', rfpId, status);
  }

  alignment(organizationId: string, rfpId: string): Promise<AlignmentReport | null> {
    return this.readResult<AlignmentReport>(organizationId, 'alignment', rfpId);
  }

  saveAlignment(organizationId: string, report: AlignmentReport): Promise<void> {
    return this.saveResult(organizationId, 'alignment', report);
  }

  setAlignmentStatus(organizationId: string, rfpId: string, status: AnalysisStatus): Promise<void> {
    return this.setStatus(organizationId, 'alignment', rfpId, status);
  }

  private resultFile(organizationId: string, kind: ResultKind, rfpId: string): string {
    return orgPath(organizationId, AREA, kind, `${assertUuid(rfpId, 'funding document')}.json`);
  }

  private async readResult<T extends RfpAnalysis | AlignmentReport>(
    organizationId: string,
    kind: ResultKind,
    rfpId: string,
  ): Promise<T | null> {
    const id = assertUuid(rfpId, 'funding document');
    if (!(await this.library.get(organizationId, id))) return null;
    const stored = await readJson<Partial<T> | null>(this.resultFile(organizationId, kind, id), null);
    // A file copied in from another organization, or from another document, is not this document's result.
    const belongs =
      stored !== null &&
      typeof stored === 'object' &&
      stored.schemaVersion === 1 &&
      stored.rfpId === id &&
      stored.organizationId === organizationId;
    return belongs ? (stored as T) : null;
  }

  private async saveResult(organizationId: string, kind: ResultKind, result: RfpAnalysis | AlignmentReport): Promise<void> {
    if (!result || typeof result !== 'object' || result.schemaVersion !== 1) {
      throw new FundingError('INVALID_INPUT', 'That result is not valid, so it was not saved.');
    }
    if (result.organizationId !== organizationId) {
      throw new FundingError('INVALID_INPUT', 'That result belongs to a different organization, so it was not saved.');
    }
    const record = await this.require(organizationId, result.rfpId);
    if (record.status !== 'ready') {
      throw new FundingError('INVALID_INPUT', 'This funding document has not been read, so there is nothing to save a result for.');
    }
    const file = this.resultFile(organizationId, kind, record.id);
    await writeJson(file, result);
    const ready: AnalysisStatus = { state: 'ready', updatedAt: this.now(), error: '' };
    try {
      await this.library.update(organizationId, record.id, kind === 'analysis' ? { analysisStatus: ready } : { alignmentStatus: ready });
    } catch (error) {
      // The document went while its result was being written. Nothing may be left behind for it.
      await removePath(file);
      throw error;
    }
    this.started.get(organizationId)?.delete(`${kind}:${record.id}`);
  }

  private async setStatus(organizationId: string, kind: ResultKind, rfpId: string, status: AnalysisStatus): Promise<void> {
    assertUuid(organizationId, 'organization');
    const id = assertUuid(rfpId, 'funding document');
    const next = readStatus(status);
    if (!next) throw new FundingError('INVALID_INPUT', 'That status is not valid.');

    // Noted before anything is awaited, so a reading of the shelf made at the same moment does not take this run for an abandoned one.
    const runs = this.started.get(organizationId) ?? new Set<string>();
    this.started.set(organizationId, runs);
    if (next.state === 'running') runs.add(`${kind}:${id}`);
    else runs.delete(`${kind}:${id}`);

    try {
      await this.require(organizationId, id);
      await this.library.update(organizationId, id, kind === 'analysis' ? { analysisStatus: next } : { alignmentStatus: next });
    } catch (error) {
      runs.delete(`${kind}:${id}`);
      throw error;
    }
  }

  // ─────────────────────────────────── housekeeping ──────────────────────────────────

  private async require(organizationId: string, rfpId: string): Promise<RfpRecord> {
    const record = await this.library.get(organizationId, assertUuid(rfpId, 'funding document'));
    if (!record) throw new FundingError('NOT_FOUND', NOT_HERE);
    return record;
  }

  private announce(organizationId: string): void {
    try {
      this.deps.emit({ kind: 'rfps_changed', organizationId });
    } catch (error) {
      // A listener that fails must not undo a change that is already on disk.
      console.error('[funding] a change to the funding documents could not be announced', error);
    }
  }

  private async dropResults(organizationId: string, rfpId: string): Promise<void> {
    await removePath(this.resultFile(organizationId, 'analysis', rfpId));
    await removePath(this.resultFile(organizationId, 'alignment', rfpId));
    const runs = this.started.get(organizationId);
    runs?.delete(`analysis:${rfpId}`);
    runs?.delete(`alignment:${rfpId}`);
  }

  /**
   * After a document has been read. A first reading has nothing to undo. A
   * reading that failed, or one that replaced earlier text, leaves any analysis
   * and alignment report describing words that are no longer there, so both go
   * and both statuses return to none.
   */
  private async afterReading(record: RfpRecord, blocks: ExtractedBlock[] | null, replaced: boolean): Promise<void> {
    if (blocks !== null && !replaced) return;
    await this.dropResults(record.organizationId, record.id);
    const untouched = readStatus(record.analysisStatus)?.state === 'none' && readStatus(record.alignmentStatus)?.state === 'none';
    if (untouched) return;
    await this.library
      .update(record.organizationId, record.id, { analysisStatus: none(), alignmentStatus: none() })
      // Removed in the meantime: there is nothing left to update.
      .catch(() => {});
  }

  /**
   * A run that was under way when the app last closed left "running" behind,
   * and nothing would ever end it. Once per organization, such a status is put
   * back to what it was before that run: ready when an earlier result is still
   * stored, none otherwise.
   */
  private restoreInterrupted(organizationId: string): Promise<void> {
    assertUuid(organizationId, 'organization');
    const known = this.restored.get(organizationId);
    if (known) return known;
    const work = (async () => {
      for (const record of await this.library.list(organizationId)) {
        const analysisLeft = readStatus(record.analysisStatus)?.state === 'running';
        const alignmentLeft = readStatus(record.alignmentStatus)?.state === 'running';
        if (!analysisLeft && !alignmentLeft) continue;
        const analysis = analysisLeft ? await this.analysis(organizationId, record.id) : null;
        const alignment = alignmentLeft ? await this.alignment(organizationId, record.id) : null;
        // Looked up only now, with nothing awaited before the update: a run that has started since is left alone.
        const runs = this.started.get(organizationId);
        const patch: Partial<RfpExtra> = {};
        if (analysisLeft && !runs?.has(`analysis:${record.id}`)) patch.analysisStatus = this.asBefore(analysis);
        if (alignmentLeft && !runs?.has(`alignment:${record.id}`)) patch.alignmentStatus = this.asBefore(alignment);
        if (patch.analysisStatus || patch.alignmentStatus) {
          await this.library.update(organizationId, record.id, patch).catch(() => {});
        }
      }
    })();
    this.restored.set(organizationId, work);
    // A failed attempt is not remembered, so the next reading of the shelf tries again.
    work.catch(() => {
      if (this.restored.get(organizationId) === work) this.restored.delete(organizationId);
    });
    return work;
  }

  private asBefore(result: { createdAt: number } | null): AnalysisStatus {
    if (!result) return none();
    return { state: 'ready', updatedAt: typeof result.createdAt === 'number' ? result.createdAt : this.now(), error: '' };
  }
}
