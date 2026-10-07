// The approved profile, shaped as a document.
//
// Alignment, the proposal guide and draft feedback all rest on what a person at
// the organization has confirmed. Showing those statements to an assistant as
// one more document means they travel sealed, like any other reference
// material, and can be cited by passage like any other. A citation into this
// document leads back to the approved statement it came from.

import { PROFILE_FIELDS, PROFILE_FIELD_LABELS, type Citation, type ProfileClaim } from '../../shared/funding.js';
import type { ExtractedBlock } from '../documents/types.js';
import type { SourceDocument } from '../funding/pipeline.js';
import type { ApprovedBaseline } from '../funding/services.js';

/** Not a UUID, so it can never be the id of an uploaded document. */
export const BASELINE_DOCUMENT_ID = 'approved-profile';
export const BASELINE_DOCUMENT_LABEL = 'Approved profile';

const BLOCK_ID_RE = /^b(\d{1,6})$/;

/**
 * The statements the profile document is made of, in the order of its blocks:
 * by profile field, then in the order the baseline lists them. Only approved
 * statements with wording count, whatever else a baseline is handed.
 */
export function approvedClaims(baseline: ApprovedBaseline): ProfileClaim[] {
  const usable = baseline.claims.filter(
    (claim) =>
      claim.status === 'approved' && Object.hasOwn(PROFILE_FIELD_LABELS, claim.field) && claim.text.trim() !== '',
  );
  return PROFILE_FIELDS.flatMap((field) => usable.filter((claim) => claim.field === field));
}

/**
 * The id of the block at a position in a document the app composes itself, in
 * the same form the readers give the blocks of an uploaded file.
 */
export function blockIdAt(position: number): string {
  return `b${String(position + 1).padStart(4, '0')}`;
}

/** The position a composed block's id stands for, or null when it is not such an id. */
export function positionOfBlock(blockId: string): number | null {
  const match = BLOCK_ID_RE.exec(blockId);
  return match ? Number(match[1]) - 1 : null;
}

/**
 * The approved profile as one document: a block for each approved statement,
 * its wording prefixed with the name of the field it belongs to.
 */
export function baselineDocument(baseline: ApprovedBaseline): SourceDocument {
  const blocks = approvedClaims(baseline).map((claim, position): ExtractedBlock => {
    const label = PROFILE_FIELD_LABELS[claim.field];
    return {
      id: blockIdAt(position),
      kind: 'paragraph',
      // Blocks hold single-spaced text; a statement typed on several lines is one block.
      text: `${label}: ${claim.text.replace(/\s+/gu, ' ').trim()}`,
      page: null,
      section: label,
      headingLevel: null,
    };
  });
  return {
    id: BASELINE_DOCUMENT_ID,
    name: BASELINE_DOCUMENT_LABEL,
    version: 1,
    label: BASELINE_DOCUMENT_LABEL,
    blocks,
  };
}

/** True when a citation points into the approved profile rather than an uploaded document. */
export function isBaselineCitation(citation: Pick<Citation, 'documentId'>): boolean {
  return citation.documentId === BASELINE_DOCUMENT_ID;
}

/**
 * The approved statement a citation into the profile document rests on, or
 * null when the citation points anywhere else.
 */
export function claimIdForCitation(
  baseline: ApprovedBaseline,
  citation: Pick<Citation, 'documentId' | 'blockId'>,
): string | null {
  if (!isBaselineCitation(citation)) return null;
  const position = positionOfBlock(citation.blockId);
  if (position === null) return null;
  return approvedClaims(baseline)[position]?.id ?? null;
}
