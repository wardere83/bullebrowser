// Keeping a statement's evidence honest.
//
// A statement in the profile points at passages in the organization's own
// documents. Each pointer is a Citation, built by the app from text it read
// itself. This file makes those pointers for statements a person writes, and
// checks them again when the document they point into is replaced or deleted.
//
// Evidence that can no longer be found is dropped. It is never reworded to
// fit, and the statement that relied on it is flagged for a person to look at
// again: the app does not decide whether a statement is still true.

import type { Citation, ProfileClaim, ReviewReason } from '../../shared/funding.js';
import type { ExtractedBlock } from '../documents/types.js';
import { FundingError } from '../funding/errors.js';
import { toCitation, verifyQuote, type VerifiedQuote } from './quote-verifier.js';

/** What a citation records about the document it points into. */
export interface CitedDocument {
  id: string;
  name: string;
  version: number;
}

/** A document whose text is at hand. */
export interface ReadableDocument extends CitedDocument {
  blocks: ExtractedBlock[];
}

/**
 * What happened to a document that statements may cite.
 *  replaced  a newer version is on the shelf; `blocks` is its text, or null
 *            when the new file could not be read.
 *  deleted   the document is gone.
 */
export type SourceChange =
  | { kind: 'replaced'; document: CitedDocument; blocks: ExtractedBlock[] | null }
  | { kind: 'deleted'; documentId: string };

/** A passage a person picked as evidence, as the interface sends it. */
export interface EvidencePiece {
  blockId: string;
  quote: string;
}

const isText = (value: unknown): value is string => typeof value === 'string';

/** A stored citation, or null when what was stored is not one. */
export function readCitation(value: unknown): Citation | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (!isText(raw.documentId) || !raw.documentId || !isText(raw.blockId) || !isText(raw.quote) || !raw.quote) {
    return null;
  }
  if (typeof raw.documentVersion !== 'number' || !Number.isFinite(raw.documentVersion)) return null;
  if (raw.match !== 'exact' && raw.match !== 'approximate') return null;
  return {
    documentId: raw.documentId,
    documentName: isText(raw.documentName) ? raw.documentName : '',
    documentVersion: raw.documentVersion,
    blockId: raw.blockId,
    page: typeof raw.page === 'number' && Number.isFinite(raw.page) ? raw.page : null,
    section: isText(raw.section) ? raw.section : '',
    quote: raw.quote,
    match: raw.match,
  };
}

/** True for a suggestion a reading produced that nobody has reworded or decided on. */
export function isUntouchedFinding(claim: ProfileClaim): boolean {
  return claim.status === 'proposed' && claim.origin !== 'user' && !claim.edited;
}

/** The documents a set of statements cites, each with the oldest version cited. */
export function citedVersions(claims: ProfileClaim[]): Map<string, number> {
  const oldest = new Map<string, number>();
  for (const claim of claims) {
    for (const citation of claim.citations) {
      const known = oldest.get(citation.documentId);
      if (known === undefined || citation.documentVersion < known) {
        oldest.set(citation.documentId, citation.documentVersion);
      }
    }
  }
  return oldest;
}

const sameCitation = (citation: Citation): string => `${citation.documentId}:${citation.blockId}:${citation.quote}`;

/** Adds citations to a list that holds each passage once. */
function collector(): { list: Citation[]; add(citation: Citation): void } {
  const list: Citation[] = [];
  const seen = new Set<string>();
  return {
    list,
    add(citation) {
      const key = sameCitation(citation);
      if (seen.has(key)) return;
      seen.add(key);
      list.push(citation);
    },
  };
}

// ───────────────────────── evidence a person points at ─────────────────────────

function locate(document: ReadableDocument, piece: EvidencePiece): VerifiedQuote[] {
  // A passage is several blocks, one to a line, and a quotation lives in one
  // block. So a passage picked whole is looked for line by line.
  const lines = piece.quote
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > 1) {
    const found: VerifiedQuote[] = [];
    let near: string | null = piece.blockId;
    for (const line of lines) {
      const verified = verifyQuote(document.blocks, near, line);
      if (!verified) break;
      found.push(verified);
      near = verified.blockId;
    }
    if (found.length === lines.length) {
      // A heading says where a passage sits, and a citation already records
      // that as its section. Cited on its own it would only be a second thing
      // to lose when the document changes.
      const kinds = new Map(document.blocks.map((block) => [block.id, block.kind]));
      const body = found.filter((quote) => kinds.get(quote.blockId) !== 'heading');
      return body.length > 0 ? body : found;
    }
  }
  const whole = verifyQuote(document.blocks, piece.blockId, piece.quote);
  return whole ? [whole] : [];
}

/**
 * Citations for the passages a person picked from one document. The wording
 * they sent is only used to find the passage: every citation is cut from the
 * stored text. A passage that is not in the document is refused, by name.
 */
export function citeEvidence(document: ReadableDocument, pieces: EvidencePiece[]): Citation[] {
  const citations = collector();
  for (const piece of pieces) {
    const found = locate(document, piece);
    if (found.length === 0) {
      throw new FundingError(
        'INVALID_INPUT',
        `That passage could not be found in "${document.name}". Choose the passage again.`,
      );
    }
    for (const quote of found) citations.add(toCitation(document, quote));
  }
  return citations.list;
}

// ─────────────────────────── when a document changes ───────────────────────────

function isStale(citation: Citation, change: SourceChange): boolean {
  if (change.kind === 'deleted') return citation.documentId === change.documentId;
  // Versions only go up. A citation already made against this version, or a
  // later one, has nothing to learn from this report.
  return citation.documentId === change.document.id && citation.documentVersion < change.document.version;
}

function reviewNote(change: SourceChange, formerName: string, remaining: number): string {
  const former = formerName ? `"${formerName}"` : 'A document';
  const nothingLeft = remaining === 0 ? ' The statement has no source left.' : '';
  if (change.kind === 'deleted') {
    return `${former} was deleted, so its passages no longer support this statement.${nothingLeft}`;
  }
  const renamed = change.document.name !== formerName && formerName !== '';
  if (change.blocks) {
    const replaced = renamed ? `${former} was replaced by "${change.document.name}"` : `${former} was replaced`;
    return `${replaced}, and a passage this statement cited is not in the new version.${nothingLeft}`;
  }
  const replaced = renamed
    ? `${former} was replaced by "${change.document.name}", which could not be read`
    : `${former} was replaced by a file that could not be read`;
  return `${replaced}, so its passages no longer support this statement.${nothingLeft}`;
}

/** One statement after a change. The same object when nothing in it cited the document; null when it is withdrawn. */
function settleClaim(claim: ProfileClaim, change: SourceChange, now: number): ProfileClaim | null {
  if (!claim.citations.some((citation) => isStale(citation, change))) return claim;

  const kept = collector();
  let lost = 0;
  let formerName = '';
  for (const citation of claim.citations) {
    if (!isStale(citation, change)) {
      kept.add(citation);
      continue;
    }
    const found =
      change.kind === 'replaced' && change.blocks ? verifyQuote(change.blocks, null, citation.quote) : null;
    if (found && change.kind === 'replaced') {
      kept.add(toCitation(change.document, found));
    } else {
      lost += 1;
      formerName ||= citation.documentName;
    }
  }

  const citations = kept.list;
  // Every passage is still there, or the statement was declined and is kept
  // only so that it is not offered again: nothing for a person to look at.
  if (lost === 0 || claim.status === 'rejected') return { ...claim, citations };
  // A suggestion nobody has touched, with nothing left to support it, is
  // withdrawn. Anything a person wrote, reworded or approved stays.
  if (isUntouchedFinding(claim) && citations.length === 0) return null;

  const reviewReason: ReviewReason = change.kind === 'deleted' ? 'source_deleted' : 'source_replaced';
  return {
    ...claim,
    citations,
    // An approved statement leaves the baseline until a person confirms it again.
    status: claim.status === 'approved' ? 'needs_review' : claim.status,
    reviewReason,
    reviewNote: reviewNote(change, formerName, citations.length),
    updatedAt: now,
  };
}

/**
 * Checks every citation into a changed document.
 *
 * - Replaced and read again: each quotation is looked for in the new text. One
 *   that is found points at the new version, with the new text's own wording
 *   and place. One that is not found is dropped.
 * - Replaced by a file that could not be read, or deleted: every citation into
 *   it is dropped.
 * - A statement that lost a citation is flagged with the reason and a sentence
 *   naming the document. An approved one becomes "needs_review". A proposed
 *   one stays proposed and carries the same note, so whoever reviews it knows.
 * - A suggestion from a reading that nobody has touched is withdrawn when it
 *   has no citation left.
 */
export function settleCitations(
  claims: ProfileClaim[],
  change: SourceChange,
  now: number,
): { claims: ProfileClaim[]; changed: boolean } {
  let changed = false;
  const settled = claims.flatMap((claim) => {
    const next = settleClaim(claim, change, now);
    if (next !== claim) changed = true;
    return next ? [next] : [];
  });
  return { claims: changed ? settled : claims, changed };
}
