// Offering an organization's own passages, word for word, when no assistant is
// connected.
//
// Without an assistant the app cannot say what a document means, so it does
// not try. For each part of the profile it searches the organization's
// documents with the phrases in field-queries.ts and offers the passages that
// rank best, exactly as they were read: whole sentences, nothing reworded,
// nothing joined from two places, and no judgement about whether two documents
// agree. The words offered are cut from the documents handed in, never from
// the search result, and each carries the citation that proves where it is.
// Nothing here uses the network.

import {
  PROFILE_FIELDS,
  type Citation,
  type KnowledgePassage,
  type ProfileFieldId,
  type ProfileGap,
} from '../../shared/funding.js';
import type { ExtractedBlock } from '../documents/types.js';
import { FundingError } from '../funding/errors.js';
import type { SourceDocument } from '../funding/pipeline.js';
import type { ExtractionInput, ExtractionOutcome, ProposedClaim } from '../funding/services.js';
import { PROFILE_FIELD_QUERIES } from './field-queries.js';
import { toCitation, verifyQuote } from './quote-verifier.js';
import { tokenize } from './text.js';

/** How many passages a field is offered. */
export const MAX_OFFERED_PER_FIELD = 3;
/** Asked of the search for each field: more than is offered, because a passage goes to one field only. */
const SEARCH_LIMIT = 10;
/** A passage is offered up to about this length, ending on a whole sentence. */
const TEXT_CHARACTERS = 400;
/** One sentence a little longer than that is still offered whole rather than not at all. */
const LONE_SENTENCE_CHARACTERS = 480;
// The verifier accepts nothing shorter than this as a quotation unless it is a
// whole block, so a shorter run of words is not treated as a sentence either:
// "Priority 1." stays with the sentence it numbers.
const SHORTEST_SENTENCE_CHARACTERS = 20;
const SHORTEST_SENTENCE_WORDS = 4;

// Closing punctuation with any quotation mark or bracket that closes with it,
// before a space and something that can begin a sentence. Scripts written
// without spaces end a sentence on their own full stop.
const SENTENCE_END_RE =
  /[.!?…]+["'”’»)\]]*(?=\s+["'“‘«([]*[\p{Lu}\p{Lt}\p{Lo}\p{Nd}\p{Sc}])|[。！？]+["'”’」』）]*/gu;
// "U.S.", "p.m." and "e.g." end in a full stop without ending a sentence, and
// so do these titles and short forms.
const ABBREVIATION_RE =
  /(?:^|[\s([“‘"'])(?:(?:\p{L}\.)+|(?:Mr|Mrs|Ms|Dr|Prof|St|Mt|Inc|Ltd|Co|Corp|No|Nos|vs|etc|Jr|Sr|Dept|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.)$/u;

const SEARCHING = 'Looking through your documents for each part of the profile';
const CHECKING = 'Checking each passage against your documents';

// Said by the app when a field has nothing to show. "Stood out" is deliberate:
// a passage that touches on a field may be offered under another one it matches
// more closely, so the app cannot say the documents are silent. With an
// assistant these stand in when it gives no usable note of its own.
const NOTHING_STOOD_OUT: Record<ProfileFieldId, string> = {
  mission: 'No passage about the mission stood out in your documents.',
  populations_served: 'No passage about who the organization serves stood out in your documents.',
  geographic_scope: 'No passage about where the organization works stood out in your documents.',
  strategic_priorities: 'No passage about strategic priorities stood out in your documents.',
  programs: 'No passage about programs or services stood out in your documents.',
  strengths: 'No passage about demonstrated strengths stood out in your documents.',
  impact_evidence: 'No passage about results or other evidence of impact stood out in your documents.',
  capacity: 'No passage about staffing, governance or finances stood out in your documents.',
  funding_goals: 'No passage about funding goals stood out in your documents.',
};

/** What the app says about a field the documents gave it nothing for. */
export function gapNote(field: ProfileFieldId): string {
  return NOTHING_STOOD_OUT[field];
}

/** Ends the work between steps once the person has stopped it. */
export function stopIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new FundingError('CANCELLED', 'Cancelled.');
}

function standsAlone(sentence: string): boolean {
  const trimmed = sentence.trim();
  return trimmed.length >= SHORTEST_SENTENCE_CHARACTERS && trimmed.split(/\s+/).length >= SHORTEST_SENTENCE_WORDS;
}

/** Where each sentence of a text ends, in order. The last end is the end of the text. */
function sentenceEnds(text: string): number[] {
  const ends: number[] = [];
  let start = 0;
  for (const match of text.matchAll(SENTENCE_END_RE)) {
    const end = match.index + match[0].length;
    if (end >= text.length) break;
    const sentence = text.slice(start, end);
    if (!standsAlone(sentence) || ABBREVIATION_RE.test(text.slice(start, match.index + 1))) continue;
    ends.push(end);
    start = end;
  }
  ends.push(text.length);
  return ends;
}

/**
 * The opening of a text: as many whole sentences as fit in `limit` characters,
 * exactly as written. Empty when not even the first sentence fits; a sentence
 * is never cut.
 */
export function leadingSentences(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let end = 0;
  for (const candidate of sentenceEnds(text)) {
    if (candidate > limit) break;
    end = candidate;
  }
  return text.slice(0, end);
}

/** What a block contributes to a passage that has `room` characters left. */
function opening(text: string, room: number, first: boolean): string {
  const fitting = leadingSentences(text, room);
  if (fitting || !first) return fitting;
  const [end = text.length] = sentenceEnds(text);
  return end <= LONE_SENTENCE_CHARACTERS ? text.slice(0, end) : '';
}

interface Shelved {
  document: SourceDocument;
  blocks: Map<string, ExtractedBlock>;
}

type Offer = Pick<ProposedClaim, 'text' | 'citations'>;

/**
 * A passage as it may be offered: the opening sentences of its text, block by
 * block, each with the citation the verifier builds from the stored block.
 * Headings are left to the citation's section. "stale" means the passage does
 * not belong to the documents handed in, so it cannot be checked at all; null
 * means it holds nothing that can be offered whole.
 */
function readPassage(passage: KnowledgePassage, shelved: Shelved | undefined): Offer | 'stale' | null {
  if (!shelved || shelved.document.version !== passage.documentVersion) return 'stale';
  const blocks: ExtractedBlock[] = [];
  for (const blockId of passage.blockIds) {
    const block = shelved.blocks.get(blockId);
    if (!block) return 'stale';
    blocks.push(block);
  }

  const citations: Citation[] = [];
  let room = TEXT_CHARACTERS;
  for (const block of blocks) {
    if (block.kind === 'heading') continue;
    const started = citations.length > 0;
    const piece = opening(block.text, room, !started);
    const verified = piece ? verifyQuote(shelved.document.blocks, block.id, piece) : null;
    // Offered only as stored: found in the same block, as the same characters.
    if (!verified || verified.match !== 'exact' || verified.blockId !== block.id || verified.quote !== piece) {
      // Once a passage has begun it runs on without a hole, so it stops here.
      if (started) break;
      continue;
    }
    citations.push(toCitation(shelved.document, verified));
    room -= piece.length + 1;
    if (piece.length < block.text.length) break;
  }
  if (citations.length === 0) return null;
  return { text: citations.map((citation) => citation.quote).join('\n'), citations };
}

interface Candidate {
  field: ProfileFieldId;
  /** The field's place in PROFILE_FIELDS. */
  order: number;
  /** The passage's place in the field's search results, best first. */
  rank: number;
  /** How well the passage matches the field, comparable between fields. */
  strength: number;
  passage: KnowledgePassage;
}

/**
 * How well a passage matches a field. Scores from different searches are only
 * roughly comparable: a field with more phrases collects more score from the
 * same passage. Dividing by the number of terms searched for evens that out,
 * so a mission statement is not handed to a field that merely has more words
 * to match it with.
 */
function strengthOf(score: number, terms: number): number {
  return Number.isFinite(score) && score > 0 ? score / terms : 0;
}

export type VerbatimInput = Pick<ExtractionInput, 'documents' | 'search' | 'signal' | 'progress'>;

/**
 * Up to three passages for each part of the profile, word for word.
 *
 * - A passage is offered under one field only: the one it matches best that
 *   still has room. So a field can be left without a passage that touches on
 *   it, when that passage says more about another field.
 * - The same words are offered once, even when two documents hold them.
 * - Nothing is compared, so there are never conflicts. A field with no passage
 *   is reported as a gap.
 * - `dropped` counts passages the search returned that are not in the
 *   documents handed in, such as one from a file replaced since it was indexed.
 */
export async function offerPassages(input: VerbatimInput): Promise<ExtractionOutcome> {
  const { documents, search, signal, progress } = input;
  const shelf = new Map<string, Shelved>(
    documents.map((document) => [
      document.id,
      { document, blocks: new Map(document.blocks.map((block) => [block.id, block])) },
    ]),
  );

  const candidates: Candidate[] = [];
  for (const [order, field] of PROFILE_FIELDS.entries()) {
    stopIfCancelled(signal);
    progress(SEARCHING, Math.round((order / PROFILE_FIELDS.length) * 90));
    const query = PROFILE_FIELD_QUERIES[field].join(' ');
    let found: KnowledgePassage[];
    try {
      found = await search(query, SEARCH_LIMIT);
    } catch (error) {
      stopIfCancelled(signal);
      throw error;
    }
    const terms = Math.max(1, new Set(tokenize(query)).size);
    found.slice(0, SEARCH_LIMIT).forEach((passage, rank) => {
      candidates.push({ field, order, rank, strength: strengthOf(passage.score, terms), passage });
    });
  }
  stopIfCancelled(signal);
  progress(CHECKING, 90);

  // The strongest match anywhere is placed first. Where strength cannot tell,
  // every field's best passage comes before any field's second best.
  candidates.sort((a, b) => b.strength - a.strength || a.rank - b.rank || a.order - b.order);

  const offered = new Map<ProfileFieldId, ProposedClaim[]>();
  const usedBlocks = new Set<string>();
  const usedTexts = new Set<string>();
  const stale = new Set<string>();
  for (const { field, passage } of candidates) {
    const claims = offered.get(field) ?? [];
    if (claims.length >= MAX_OFFERED_PER_FIELD) continue;
    const keys = passage.blockIds.map((blockId) => `${passage.documentId}:${blockId}`);
    if (keys.some((key) => usedBlocks.has(key))) continue;

    const read = readPassage(passage, shelf.get(passage.documentId));
    if (read === 'stale') {
      stale.add(`${passage.documentId}:${passage.documentVersion}:${passage.blockIds.join(',')}`);
      continue;
    }
    if (!read || usedTexts.has(read.text)) continue;

    for (const key of keys) usedBlocks.add(key);
    usedTexts.add(read.text);
    claims.push({ field, text: read.text, origin: 'verbatim', citations: read.citations, supersedesClaimId: null });
    offered.set(field, claims);
  }

  const gaps: ProfileGap[] = PROFILE_FIELDS.filter((field) => !offered.has(field)).map((field) => ({
    field,
    note: gapNote(field),
  }));
  return {
    method: 'verbatim',
    claims: PROFILE_FIELDS.flatMap((field) => offered.get(field) ?? []),
    conflicts: [],
    gaps,
    dropped: stale.size,
  };
}
