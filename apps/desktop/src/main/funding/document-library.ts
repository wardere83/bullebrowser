// A per-organization shelf of uploaded files and the text read from them.
//
// The Knowledge Hub and the RFP workspace are two shelves of the same kind kept
// in different places: each has a registry, the original bytes and the
// extracted blocks, all inside one organization's directory. This class owns
// that mechanics — copying, hashing, reading, status, replace and delete — and
// knows nothing about profiles or analyses; those hook in through `onProcessed`
// and `onRemoved`.
//
//   <organization>/<area>/documents.json      registry
//   <organization>/<area>/files/<id>          the file as uploaded
//   <organization>/<area>/text/<id>.json      blocks read from it

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, stat } from 'node:fs/promises';
import { basename, dirname, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import {
  ACCEPTED_EXTENSIONS,
  MAX_DOCUMENT_BYTES,
  type DocumentFormat,
  type ProcessingStatus,
} from '../../shared/funding.js';
import type { ExtractedBlock, ExtractedDocument } from '../documents/types.js';
import { FundingError, isCancellation, isFundingError } from './errors.js';
import { assertUuid, orgPath, readJson, removePath, writeJson } from './org-store.js';

/** The fields every shelf keeps for a document. */
export interface LibraryRecord {
  id: string;
  organizationId: string;
  name: string;
  format: DocumentFormat;
  sizeBytes: number;
  sha256: string;
  version: number;
  status: ProcessingStatus;
  statusDetail: string;
  warnings: string[];
  pageCount: number | null;
  blockCount: number;
  wordCount: number;
  uploadedAt: number;
  updatedAt: number;
  uploadedBy: string;
}

export type ExtractFile = (
  filePath: string,
  fileName: string,
  options: { signal: AbortSignal },
) => Promise<ExtractedDocument>;

export interface LibraryOptions<Extra extends object> {
  /** Directory name inside the organization, e.g. "knowledge" or "rfps". */
  area: string;
  extract: ExtractFile;
  /** Called whenever the registry of an organization changes. */
  onChange?: (organizationId: string) => void;
  /**
   * Called after a document has been read (blocks present) or has failed
   * (blocks null). `replaced` is true when this version took over from an
   * earlier one.
   */
  onProcessed?: (
    record: LibraryRecord & Extra,
    blocks: ExtractedBlock[] | null,
    replaced: boolean,
  ) => Promise<void> | void;
  /** Called after a document and its text have been deleted. */
  onRemoved?: (record: LibraryRecord & Extra) => Promise<void> | void;
  now?: () => number;
}

interface Registry<Extra extends object> {
  schemaVersion: 1;
  documents: (LibraryRecord & Extra)[];
}

interface StoredText {
  documentId: string;
  version: number;
  sha256: string;
  blocks: ExtractedBlock[];
}

const IN_PROGRESS: ProcessingStatus[] = ['queued', 'extracting', 'indexing'];

/** The format a file name claims, or null when the app does not read it. */
export function formatFromName(fileName: string): DocumentFormat | null {
  const extension = extname(fileName).slice(1).toLowerCase();
  for (const [format, extensions] of Object.entries(ACCEPTED_EXTENSIONS)) {
    if (extensions.includes(extension)) return format as DocumentFormat;
  }
  return null;
}

/** A display name: the file's own name, without directories or control characters. */
export function displayName(fileName: string): string {
  const cleaned = basename(fileName)
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .trim();
  return (cleaned || 'Untitled document').slice(0, 200);
}

function failureMessage(error: unknown): string {
  if (isFundingError(error)) return error.message;
  console.error('[funding] a document could not be read', error);
  return 'This file could not be read. Try saving it again as a PDF or DOCX and upload it once more.';
}

export class DocumentLibrary<Extra extends object = object> {
  private readonly now: () => number;
  // One organization's registry is read, changed and written as one step.
  private readonly registryQueues = new Map<string, Promise<unknown>>();
  // Reading files is memory-hungry, so documents are read one at a time.
  private processing: Promise<void> = Promise.resolve();
  private readonly pending = new Map<string, Set<Promise<void>>>();
  private readonly aborts = new Map<string, AbortController>();
  private readonly resumed = new Set<string>();

  constructor(private readonly options: LibraryOptions<Extra>) {
    this.now = options.now ?? (() => Date.now());
  }

  // ───────────────────────────── paths and registry ─────────────────────────────

  private registryFile(organizationId: string): string {
    return orgPath(organizationId, this.options.area, 'documents.json');
  }

  private filePath(organizationId: string, documentId: string): string {
    return orgPath(organizationId, this.options.area, 'files', assertUuid(documentId, 'document'));
  }

  private textPath(organizationId: string, documentId: string): string {
    return orgPath(organizationId, this.options.area, 'text', `${assertUuid(documentId, 'document')}.json`);
  }

  private async read(organizationId: string): Promise<Registry<Extra>> {
    const stored = await readJson<Partial<Registry<Extra>>>(this.registryFile(organizationId), {});
    const documents = Array.isArray(stored.documents) ? stored.documents : [];
    return {
      schemaVersion: 1,
      // A registry copied in from elsewhere must not introduce another organization's rows.
      documents: documents.filter((document) => document && document.organizationId === organizationId),
    };
  }

  private mutate<T>(
    organizationId: string,
    change: (registry: Registry<Extra>) => T | Promise<T>,
  ): Promise<T> {
    const previous = this.registryQueues.get(organizationId) ?? Promise.resolve();
    const run = previous.then(async () => {
      const registry = await this.read(organizationId);
      const result = await change(registry);
      await writeJson(this.registryFile(organizationId), registry);
      return result;
    });
    this.registryQueues.set(
      organizationId,
      run.catch(() => {}),
    );
    return run.then((result) => {
      this.options.onChange?.(organizationId);
      return result;
    });
  }

  private async patch(
    organizationId: string,
    documentId: string,
    change: Partial<LibraryRecord & Extra>,
  ): Promise<(LibraryRecord & Extra) | null> {
    return this.mutate(organizationId, (registry) => {
      const index = registry.documents.findIndex((document) => document.id === documentId);
      const existing = registry.documents[index];
      if (!existing) return null;
      const updated = { ...existing, ...change, updatedAt: this.now() };
      registry.documents[index] = updated;
      return updated;
    });
  }

  // ──────────────────────────────────── reads ────────────────────────────────────

  async list(organizationId: string): Promise<(LibraryRecord & Extra)[]> {
    await this.resumeInterrupted(organizationId);
    const registry = await this.read(organizationId);
    return [...registry.documents].sort((a, b) => b.uploadedAt - a.uploadedAt);
  }

  async get(organizationId: string, documentId: string): Promise<(LibraryRecord & Extra) | null> {
    assertUuid(documentId, 'document');
    const registry = await this.read(organizationId);
    return registry.documents.find((document) => document.id === documentId) ?? null;
  }

  private async require(organizationId: string, documentId: string): Promise<LibraryRecord & Extra> {
    const record = await this.get(organizationId, documentId);
    if (!record) throw new FundingError('NOT_FOUND', 'That document is no longer here.');
    return record;
  }

  /** The blocks read from a document, or null while it is unread or failed. */
  async blocks(organizationId: string, documentId: string): Promise<ExtractedBlock[] | null> {
    const record = await this.get(organizationId, documentId);
    if (!record || record.status !== 'ready') return null;
    const stored = await readJson<StoredText | null>(this.textPath(organizationId, documentId), null);
    // Text left behind by an earlier version must never be served for this one.
    if (!stored || stored.version !== record.version || stored.sha256 !== record.sha256) return null;
    return Array.isArray(stored.blocks) ? stored.blocks : null;
  }

  // ─────────────────────────────────── writes ────────────────────────────────────

  /**
   * Copies a file onto the shelf and starts reading it. A file identical to
   * one already here is not added twice; the existing document is returned.
   */
  async addFile(
    organizationId: string,
    input: { sourcePath: string; uploadedBy: string; extra: Extra; name?: string },
  ): Promise<LibraryRecord & Extra> {
    const name = displayName(input.name ?? input.sourcePath);
    const format = this.checkAcceptable(name);
    const size = await this.sizeOf(input.sourcePath);
    const id = randomUUID();
    const sha256 = await this.copyIn(input.sourcePath, this.filePath(organizationId, id));

    const { record, duplicate } = await this.mutate(organizationId, (registry) => {
      const existing = registry.documents.find((document) => document.sha256 === sha256);
      if (existing) return { record: existing, duplicate: true };
      const now = this.now();
      const created = {
        ...input.extra,
        id,
        organizationId,
        name,
        format,
        sizeBytes: size,
        sha256,
        version: 1,
        status: 'queued',
        statusDetail: '',
        warnings: [],
        pageCount: null,
        blockCount: 0,
        wordCount: 0,
        uploadedAt: now,
        updatedAt: now,
        uploadedBy: input.uploadedBy,
      } as LibraryRecord & Extra;
      registry.documents.push(created);
      return { record: created, duplicate: false };
    });
    if (duplicate) {
      await removePath(this.filePath(organizationId, id));
      return record;
    }
    this.schedule(organizationId, id, false);
    return record;
  }

  /**
   * Shelves text the app already has (for example an official listing), with
   * no file behind it. It is ready at once.
   */
  async addExtracted(
    organizationId: string,
    input: { name: string; uploadedBy: string; extra: Extra; document: ExtractedDocument },
  ): Promise<LibraryRecord & Extra> {
    const id = randomUUID();
    const serialized = JSON.stringify(input.document.blocks);
    const sha256 = createHash('sha256').update(serialized).digest('hex');
    await writeJson(this.textPath(organizationId, id), {
      documentId: id,
      version: 1,
      sha256,
      blocks: input.document.blocks,
    } satisfies StoredText);
    const record = await this.mutate(organizationId, (registry) => {
      const now = this.now();
      const created = {
        ...input.extra,
        id,
        organizationId,
        name: displayName(input.name),
        format: input.document.format,
        sizeBytes: Buffer.byteLength(serialized),
        sha256,
        version: 1,
        status: 'ready',
        statusDetail: '',
        warnings: input.document.warnings,
        pageCount: input.document.pageCount,
        blockCount: input.document.blocks.length,
        wordCount: input.document.wordCount,
        uploadedAt: now,
        updatedAt: now,
        uploadedBy: input.uploadedBy,
      } as LibraryRecord & Extra;
      registry.documents.push(created);
      return created;
    });
    await this.options.onProcessed?.(record, input.document.blocks, false);
    return record;
  }

  /** Puts a new file behind an existing document and reads it again. */
  async replaceFile(
    organizationId: string,
    documentId: string,
    input: { sourcePath: string; name?: string },
  ): Promise<LibraryRecord & Extra> {
    const current = await this.require(organizationId, documentId);
    const name = displayName(input.name ?? input.sourcePath);
    const format = this.checkAcceptable(name);
    const size = await this.sizeOf(input.sourcePath);

    this.aborts.get(documentId)?.abort();
    const staging = `${this.filePath(organizationId, documentId)}.incoming`;
    const sha256 = await this.copyIn(input.sourcePath, staging);
    const sameElsewhere = (await this.read(organizationId)).documents.find(
      (document) => document.sha256 === sha256 && document.id !== documentId,
    );
    if (sameElsewhere) {
      await removePath(staging);
      throw new FundingError('INVALID_INPUT', `That file is already here as "${sameElsewhere.name}".`);
    }
    if (sha256 === current.sha256) {
      await removePath(staging);
      return current;
    }

    // The old text goes first, so nothing can cite wording the user has replaced.
    await removePath(this.textPath(organizationId, documentId));
    await removePath(this.filePath(organizationId, documentId));
    await rename(staging, this.filePath(organizationId, documentId));
    const updated = await this.patch(organizationId, documentId, {
      name,
      format,
      sizeBytes: size,
      sha256,
      version: current.version + 1,
      status: 'queued',
      statusDetail: '',
      warnings: [],
      pageCount: null,
      blockCount: 0,
      wordCount: 0,
    } as Partial<LibraryRecord & Extra>);
    if (!updated) throw new FundingError('NOT_FOUND', 'That document is no longer here.');
    this.schedule(organizationId, documentId, true);
    return updated;
  }

  async update(
    organizationId: string,
    documentId: string,
    extra: Partial<Extra>,
  ): Promise<LibraryRecord & Extra> {
    await this.require(organizationId, documentId);
    const updated = await this.patch(organizationId, documentId, extra as Partial<LibraryRecord & Extra>);
    if (!updated) throw new FundingError('NOT_FOUND', 'That document is no longer here.');
    return updated;
  }

  /** Reads a failed document again from the file already on the shelf. */
  async retry(organizationId: string, documentId: string): Promise<LibraryRecord & Extra> {
    const record = await this.require(organizationId, documentId);
    if (IN_PROGRESS.includes(record.status)) return record;
    const updated = await this.patch(organizationId, documentId, {
      status: 'queued',
      statusDetail: '',
    } as Partial<LibraryRecord & Extra>);
    this.schedule(organizationId, documentId, false);
    return updated ?? record;
  }

  /** Deletes the document, its file and its text. */
  async remove(organizationId: string, documentId: string): Promise<void> {
    const record = await this.require(organizationId, documentId);
    this.aborts.get(documentId)?.abort();
    await this.mutate(organizationId, (registry) => {
      registry.documents = registry.documents.filter((document) => document.id !== documentId);
    });
    await removePath(this.filePath(organizationId, documentId));
    await removePath(this.textPath(organizationId, documentId));
    await this.options.onRemoved?.(record);
  }

  /** Resolves once nothing in this organization is waiting to be read. */
  async whenIdle(organizationId: string): Promise<void> {
    for (;;) {
      const waiting = [...(this.pending.get(organizationId) ?? [])];
      if (waiting.length === 0) return;
      await Promise.allSettled(waiting);
    }
  }

  // ────────────────────────────────── processing ─────────────────────────────────

  private checkAcceptable(name: string): DocumentFormat {
    const format = formatFromName(name);
    if (!format) {
      throw new FundingError(
        'UNSUPPORTED_FILE',
        `"${name}" is not a file type that can be read. Upload a PDF, DOCX, TXT or Markdown file.`,
      );
    }
    return format;
  }

  private async sizeOf(sourcePath: string): Promise<number> {
    let size: number;
    try {
      const info = await stat(sourcePath);
      if (!info.isFile()) throw new Error('not a file');
      size = info.size;
    } catch {
      throw new FundingError('NOT_FOUND', 'That file could not be opened. It may have been moved or deleted.');
    }
    if (size === 0) throw new FundingError('EXTRACTION_FAILED', 'That file is empty.');
    if (size > MAX_DOCUMENT_BYTES) {
      throw new FundingError(
        'FILE_TOO_LARGE',
        `That file is larger than ${Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024))} MB, the most that can be read.`,
      );
    }
    return size;
  }

  private async copyIn(sourcePath: string, destination: string): Promise<string> {
    const hash = createHash('sha256');
    const tap = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        hash.update(chunk);
        done(null, chunk);
      },
    });
    await mkdir(dirname(destination), { recursive: true });
    try {
      await pipeline(createReadStream(sourcePath), tap, createWriteStream(destination));
    } catch {
      await removePath(destination);
      throw new FundingError('NOT_FOUND', 'That file could not be copied. It may have been moved or deleted.');
    }
    return hash.digest('hex');
  }

  private schedule(organizationId: string, documentId: string, replaced: boolean): void {
    const task = this.processing.then(() => this.process(organizationId, documentId, replaced));
    this.processing = task.catch(() => {});
    const waiting = this.pending.get(organizationId) ?? new Set();
    this.pending.set(organizationId, waiting);
    const tracked: Promise<void> = task.catch(() => {}).finally(() => waiting.delete(tracked));
    waiting.add(tracked);
  }

  private async process(organizationId: string, documentId: string, replaced: boolean): Promise<void> {
    const starting = await this.get(organizationId, documentId);
    if (!starting || starting.status !== 'queued') return;
    const version = starting.version;
    const controller = new AbortController();
    this.aborts.set(documentId, controller);
    try {
      await this.patch(organizationId, documentId, { status: 'extracting' } as Partial<LibraryRecord & Extra>);
      const extracted = await this.options.extract(this.filePath(organizationId, documentId), starting.name, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (extracted.blocks.length === 0) {
        throw new FundingError('EXTRACTION_FAILED', 'No readable text was found in this file.');
      }
      await this.patch(organizationId, documentId, { status: 'indexing' } as Partial<LibraryRecord & Extra>);
      await writeJson(this.textPath(organizationId, documentId), {
        documentId,
        version,
        sha256: starting.sha256,
        blocks: extracted.blocks,
      } satisfies StoredText);
      // A replace or delete that arrived meanwhile wins; this result is discarded.
      const current = await this.get(organizationId, documentId);
      if (!current || current.version !== version || controller.signal.aborted) return;
      const ready = await this.patch(organizationId, documentId, {
        status: 'ready',
        statusDetail: '',
        format: extracted.format,
        warnings: extracted.warnings,
        pageCount: extracted.pageCount,
        blockCount: extracted.blocks.length,
        wordCount: extracted.wordCount,
      } as Partial<LibraryRecord & Extra>);
      if (ready) await this.options.onProcessed?.(ready, extracted.blocks, replaced);
    } catch (error) {
      if (controller.signal.aborted || isCancellation(error)) return;
      const current = await this.get(organizationId, documentId);
      if (!current || current.version !== version) return;
      await removePath(this.textPath(organizationId, documentId));
      const failed = await this.patch(organizationId, documentId, {
        status: 'failed',
        statusDetail: failureMessage(error),
        warnings: [],
        pageCount: null,
        blockCount: 0,
        wordCount: 0,
      } as Partial<LibraryRecord & Extra>);
      if (failed) await this.options.onProcessed?.(failed, null, replaced);
    } finally {
      if (this.aborts.get(documentId) === controller) this.aborts.delete(documentId);
    }
  }

  /** Picks up documents an earlier run of the app left half-read. */
  private async resumeInterrupted(organizationId: string): Promise<void> {
    if (this.resumed.has(organizationId)) return;
    this.resumed.add(organizationId);
    const registry = await this.read(organizationId);
    const stuck = registry.documents.filter(
      (document) => IN_PROGRESS.includes(document.status) && !this.aborts.has(document.id),
    );
    const waiting = this.pending.get(organizationId);
    if (stuck.length === 0 || (waiting && waiting.size > 0)) return;
    for (const document of stuck) {
      await this.patch(organizationId, document.id, { status: 'queued' } as Partial<LibraryRecord & Extra>);
      this.schedule(organizationId, document.id, false);
    }
  }
}
