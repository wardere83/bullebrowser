// Reads one document on the device without letting it hold up, or bring down,
// the app. The file is checked here, in the main process; its text is extracted
// in a short-lived worker thread with a memory cap and a hard time limit.
//
// This is the only file that imports the worker. The '?nodeWorker' suffix is
// resolved by the app's bundler and means nothing to the unit tests, so nothing
// they load may import this file.

import { open } from 'node:fs/promises';
import type { Worker } from 'node:worker_threads';
import type { FundingErrorCode } from '../../shared/funding.js';
import { FundingError, isFundingError } from '../funding/errors.js';
import { requireFormat, tooLarge } from './extract.js';
import { DEFAULT_LIMITS } from './limits.js';
import type { ExtractedDocument } from './types.js';
import type { WorkerReply, WorkerRequest } from './worker.js';
import createWorker from './worker?nodeWorker';

const CANNOT_OPEN =
  'This file could not be opened. It may have been moved, renamed or deleted. Choose it again and try once more.';
const NOT_A_FILE =
  'That is not a file that can be read. Choose a PDF, a Word document (.docx), a Markdown file or a plain-text file.';
const TOO_SLOW = 'Reading this file took too long, so it was stopped. Try a shorter document, or split it into parts.';
const OUT_OF_MEMORY =
  'This file needs more memory to read than is available. Try a shorter document, or split it into parts.';
const STOPPED = 'Reading this file stopped unexpectedly. Try again, or save a new copy of the file and upload that.';

export interface ExtractFileOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * The file's bytes in a buffer of their own, which the worker takes over. The
 * size is checked on the open file before anything is read, and no more than
 * that many bytes are read even if the file grows afterwards.
 */
async function readWithinLimit(filePath: string): Promise<Uint8Array> {
  let handle;
  try {
    handle = await open(filePath, 'r');
  } catch {
    throw new FundingError('EXTRACTION_FAILED', CANNOT_OPEN);
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new FundingError('UNSUPPORTED_FILE', NOT_A_FILE);
    if (info.size > DEFAULT_LIMITS.maxFileBytes) throw tooLarge(DEFAULT_LIMITS);
    const bytes = new Uint8Array(info.size);
    let filled = 0;
    while (filled < bytes.byteLength) {
      const { bytesRead } = await handle.read(bytes, filled, bytes.byteLength - filled, filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    return filled === bytes.byteLength ? bytes : bytes.slice(0, filled);
  } catch (error) {
    if (isFundingError(error)) throw error;
    throw new FundingError('EXTRACTION_FAILED', CANNOT_OPEN);
  } finally {
    await handle.close().catch(() => {});
  }
}

function runWorker(request: WorkerRequest, timeoutMs: number, signal: AbortSignal | undefined): Promise<ExtractedDocument> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = createWorker({ resourceLimits: { maxOldGenerationSizeMb: DEFAULT_LIMITS.workerHeapMb } });
    } catch {
      reject(new FundingError('EXTRACTION_FAILED', STOPPED));
      return;
    }
    let settled = false;
    // Whichever of the answer, a crash, the time limit or a cancellation comes
    // first decides the outcome; the thread is stopped in every case.
    const settle = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      void worker.terminate();
      outcome();
    };
    const fail = (code: FundingErrorCode, message: string) => settle(() => reject(new FundingError(code, message)));
    const onAbort = () => fail('CANCELLED', 'Cancelled.');
    const timer = setTimeout(() => fail('EXTRACTION_FAILED', TOO_SLOW), timeoutMs);

    signal?.addEventListener('abort', onAbort, { once: true });
    worker.once('message', (answer: WorkerReply | undefined) => {
      if (answer?.ok) settle(() => resolve(answer.document));
      else if (answer?.error) fail(answer.error.code, answer.error.message);
      else fail('EXTRACTION_FAILED', STOPPED);
    });
    worker.once('error', (error: NodeJS.ErrnoException) => {
      fail('EXTRACTION_FAILED', error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? OUT_OF_MEMORY : STOPPED);
    });
    worker.once('exit', () => fail('EXTRACTION_FAILED', STOPPED));
    try {
      // Handed over rather than copied: the bytes are no longer usable on this side.
      worker.postMessage(request, [request.bytes.buffer as ArrayBuffer]);
    } catch {
      fail('EXTRACTION_FAILED', STOPPED);
    }
  });
}

/**
 * Reads the document at `filePath`. `fileName` is the name the person gave the
 * file, and decides which format it is expected to be. The main process chooses
 * the path; it is never taken from a renderer.
 */
export async function extractDocumentFile(
  filePath: string,
  fileName: string,
  options: ExtractFileOptions = {},
): Promise<ExtractedDocument> {
  if (options.signal?.aborted) throw new FundingError('CANCELLED', 'Cancelled.');
  const bytes = await readWithinLimit(filePath);
  const format = requireFormat(fileName, bytes);
  if (options.signal?.aborted) throw new FundingError('CANCELLED', 'Cancelled.');
  return runWorker({ format, bytes }, options.timeoutMs ?? DEFAULT_LIMITS.timeoutMs, options.signal);
}
