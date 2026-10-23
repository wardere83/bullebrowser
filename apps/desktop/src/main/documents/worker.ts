// Runs in a worker thread: one document in, one answer out, then the thread is
// thrown away. Parsing happens here so that a document which exhausts memory or
// never finishes costs one thread rather than the app, and so that the PDF
// reader's changes to global objects stay out of the main process.

import { parentPort } from 'node:worker_threads';
import type { DocumentFormat, PublicError } from '../../shared/funding.js';
import { isFundingError } from '../funding/errors.js';
import { extractFromBytes } from './extract.js';
import type { ExtractedDocument } from './types.js';

export interface WorkerRequest {
  format: DocumentFormat;
  bytes: Uint8Array;
}

export type WorkerReply = { ok: true; document: ExtractedDocument } | { ok: false; error: PublicError };

function reply(message: WorkerReply): void {
  parentPort?.postMessage(message);
}

parentPort?.once('message', (request: WorkerRequest) => {
  extractFromBytes(request.format, request.bytes).then(
    (document) => reply({ ok: true, document }),
    (error: unknown) =>
      reply({
        ok: false,
        error: isFundingError(error)
          ? { code: error.code, message: error.message }
          : { code: 'EXTRACTION_FAILED', message: 'This file could not be read. Try saving a new copy of it and uploading that.' },
      }),
  );
});
