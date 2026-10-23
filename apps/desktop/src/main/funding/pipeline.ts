// What the analysis pipelines share: the shape of one question to the
// assistant, and the documents a question is asked about.
//
// A pipeline never talks to a provider. It is handed `complete`, asks for data
// in a fixed shape, and then checks every quotation in the answer against the
// text the app itself read. That keeps the pipelines testable with a scripted
// assistant and keeps provider details in one place (assistant.ts).

import type { z } from 'zod';
import type { ExtractedBlock } from '../documents/types.js';

/** The shape an answer must have: enforced on the wire, then checked again here. */
export interface OutputSchema<T> {
  /** Letters, digits, underscores and hyphens; at most 64 characters. */
  name: string;
  /**
   * JSON Schema sent to the assistant. Every object is closed
   * (additionalProperties: false) and lists every property as required; there
   * are no nullable or union types. Lengths and ranges are not enforceable on
   * the wire, so they live in `zod`.
   */
  json: Record<string, unknown>;
  zod: z.ZodType<T>;
  /** Rules across fields. A non-empty result asks the assistant to correct itself once. */
  check?: (value: T) => string[];
}

export interface CompletionRequest<T> {
  /** Trusted instructions only. Document text never goes here. */
  system: string;
  /** The sealed reference material, rendered by prompting.ts. Placed first so it can be reused. */
  documents: string;
  /** What to do with the documents. */
  task: string;
  schema: OutputSchema<T>;
  maxTokens?: number;
  signal: AbortSignal;
}

/**
 * Asks the connected assistant one question. Rejects with a FundingError:
 * NO_ASSISTANT when none is connected, ASSISTANT_ERROR for anything else the
 * user should see, CANCELLED when the signal fires.
 */
export type Complete = <T>(request: CompletionRequest<T>) => Promise<T>;

/** Reports what a pipeline is doing. Percent is 0–100 or null when unknown. */
export type Progress = (message: string, percent?: number | null) => void;

/** A document as a pipeline sees it: identity for citations, and its blocks. */
export interface SourceDocument {
  id: string;
  name: string;
  version: number;
  /** What kind of document it is, in words, e.g. "Strategic plan" or "Funding document". */
  label: string;
  blocks: ExtractedBlock[];
}
