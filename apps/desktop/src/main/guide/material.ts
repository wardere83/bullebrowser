// What the guidance pipelines share: the material an assistant is shown about
// a funder and an organization, and the checks that turn its answer back into
// cited statements.
//
// Alignment, the proposal guide and draft feedback work the same way. The
// funding document, the requirements found in it and the organization's own
// material are rendered as separate sealed sets, each with its own prefix, so
// an answer says which set a quotation comes from. Whatever comes back is
// checked here before any of it is shown: a quotation has to be in the stored
// text, a statement about the organization has to rest on one, and a figure has
// to be in the words quoted for it. What fails is left out and counted. Nothing
// is reworded to make it fit.

import { MODEL_ERRORS, applyTerminology } from '@bullebrowser/agent-core';
import { z } from 'zod';
import {
  RFP_SECTIONS,
  RFP_SECTION_LABELS,
  type Citation,
  type DocumentedFact,
  type KnowledgePassage,
  type LiteralFinding,
  type RfpAnalysis,
  type RfpItem,
  type RfpSectionId,
} from '../../shared/funding.js';
import { SECTION_SEPARATOR, type ExtractedBlock } from '../documents/types.js';
import { FundingError } from '../funding/errors.js';
import type { Complete, CompletionRequest, SourceDocument } from '../funding/pipeline.js';
import type { RawEvidence, RenderedDocuments } from '../funding/prompting.js';
import type { ApprovedBaseline, PassageSearch } from '../funding/services.js';
import { toCitation, unsupportedNumbers, verifyQuote } from '../knowledge/quote-verifier.js';
import {
  BASELINE_DOCUMENT_ID,
  baselineDocument,
  blockIdAt,
  claimIdForCitation,
  positionOfBlock,
} from './baseline-document.js';

/** The prefix each set of passages is rendered with, so its ids cannot be taken for another set's. */
export const PREFIX = {
  /** The funding document. */
  funding: 'F',
  /** The requirements the analysis found in it. */
  requirements: 'R',
  /** The organization's approved profile and its own documents. */
  organization: 'D',
  /** The part of a guide a draft was written for. */
  section: 'G',
  /** The user's own draft. */
  draft: 'U',
} as const;

// ─────────────────────────────── asking and answering ─────────────────────────

/** Quotations beyond this many for one statement are not looked at. */
const MAX_EVIDENCE = 8;

/** Evidence as it travels: a passage id and words copied from that passage. */
export const EVIDENCE_JSON: Record<string, unknown> = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['block_id', 'quote'],
    properties: { block_id: { type: 'string' }, quote: { type: 'string' } },
  },
};

// Nothing about a quotation is refused here. One that is blank, or names a
// passage that does not exist, is simply not found when it is looked for.
export const evidenceList: z.ZodType<RawEvidence[]> = z.array(z.object({ block_id: z.string(), quote: z.string() }));

/** A statement with the passages it rests on. */
export interface RawStatement {
  text: string;
  evidence: RawEvidence[];
}

export const STATEMENT_JSON: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'evidence'],
  properties: { text: { type: 'string' }, evidence: EVIDENCE_JSON },
};

export function statementOf(maxCharacters: number): z.ZodType<RawStatement> {
  return z.object({ text: z.string().min(1).max(maxCharacters), evidence: evidenceList });
}

export function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new FundingError('CANCELLED', 'Cancelled.');
}

/**
 * Asks one question. `complete` promises an answer that already matches the
 * schema; the answer is checked again here, so that what the pipelines build on
 * does not depend on who supplied `complete`.
 */
export async function ask<T>(complete: Complete, request: CompletionRequest<T>): Promise<T> {
  throwIfCancelled(request.signal);
  const answer = await complete(request);
  const parsed = request.schema.zod.safeParse(answer);
  if (!parsed.success || (request.schema.check?.(parsed.data) ?? []).length > 0) {
    throw new FundingError('ASSISTANT_ERROR', MODEL_ERRORS.OUTPUT_INVALID.message);
  }
  return parsed.data;
}

/** The sealed texts of several sets, as the documents part of one request. */
export function sealed(...sets: (RenderedDocuments | null)[]): string {
  return sets.flatMap((set) => (set ? [set.text] : [])).join('\n\n');
}

/** Raised when the material cannot be made to fit in one request. */
export function tooMuchText(): FundingError {
  return new FundingError('ASSISTANT_ERROR', MODEL_ERRORS.INPUT_TOO_LARGE.message);
}

/** A pipeline is handed material by its caller; material of another organization is refused. */
export function assertSameOrganization(organizationId: string, ...owners: (string | undefined)[]): void {
  if (owners.some((owner) => owner !== undefined && owner !== organizationId)) {
    throw new FundingError('INVALID_INPUT', 'That material belongs to a different organization.');
  }
}

/** Text an assistant wrote, on one line and in the product's wording. */
export function tidy(text: string): string {
  return applyTerminology(text.replace(/\s+/gu, ' ').trim());
}

/** "1 requirement", "3 requirements". */
export function counted(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

// ─────────────────────────────── what the funder asks ─────────────────────────

/** One thing the funder asks for, as the analysis of the funding document recorded it. */
export interface Requirement {
  section: RfpSectionId;
  item: RfpItem;
  /** True when it was found by pattern matching, so no section of the analysis names it. */
  textMatch: boolean;
}

// Where a requirement found by pattern matching is listed. Read from the
// headings it sits under, innermost first, and then from its own words. It
// only decides which group the requirement appears in.
const SECTION_SIGNS: [RfpSectionId, RegExp][] = [
  ['matching', /\b(?:match(?:ing|ed)?|cost[- ]shar\w*|in[- ]kind)\b/i],
  ['reporting', /\breport(?:s|ing)?\b/i],
  ['required_documents', /\b(?:attachments?|required documents?|appendi(?:x|ces)|forms?)\b/i],
  ['submission_steps', /\b(?:submi\w+|portal|regist\w+)\b/i],
  ['deadlines', /\b(?:deadlines?|due dates?|key dates)\b/i],
  ['evaluation_criteria', /\b(?:evaluation|scor(?:e|ed|ing)|criteri(?:a|on))\b/i],
  ['supported_activities', /\b(?:allowable|unallowable|expenses?|activities)\b/i],
  ['eligibility', /\b(?:eligib\w+|applicants?)\b/i],
];

function sectionFromSigns(finding: LiteralFinding): RfpSectionId {
  const headings = finding.citation.section.split(SECTION_SEPARATOR).reverse();
  for (const text of [...headings, finding.text]) {
    const sign = SECTION_SIGNS.find(([, pattern]) => pattern.test(text));
    if (sign) return sign[0];
  }
  return 'eligibility';
}

function textMatchRequirements(findings: LiteralFinding[]): Requirement[] {
  const found = new Map<string, { finding: LiteralFinding; match: boolean }>();
  for (const finding of findings) {
    if (finding.kind !== 'requirement' && finding.kind !== 'match') continue;
    // One sentence can be found twice: once as a requirement and once as a match.
    const key = `${finding.citation.documentId}\n${finding.citation.blockId}\n${finding.text}`;
    const earlier = found.get(key);
    found.set(key, {
      finding: earlier?.finding ?? finding,
      match: (earlier?.match ?? false) || finding.kind === 'match',
    });
  }
  return [...found.values()].map(({ finding, match }, position) => ({
    section: match ? 'matching' : sectionFromSigns(finding),
    item: {
      id: `text-match-${position + 1}`,
      text: finding.text,
      basis: 'explicit',
      citations: [finding.citation],
      needsReview: false,
    },
    textMatch: true,
  }));
}

/**
 * What the funder asks for, in the order of the analysis: the items of its
 * sections, or, when the analysis holds text matches only, the requirements
 * and matching rules it found, each as an explicit item with its citation.
 */
export function requirementsOf(analysis: RfpAnalysis): Requirement[] {
  const known = new Set<string>(RFP_SECTIONS);
  const stated = analysis.sections
    .filter((section) => known.has(section.id))
    .flatMap((section) =>
      section.items
        .filter((item) => item.text.trim() !== '')
        .map((item): Requirement => ({ section: section.id, item, textMatch: false })),
    );
  return stated.length > 0 ? stated : textMatchRequirements(analysis.literalFindings);
}

/**
 * The requirements as a document of their own, one passage each, so that they
 * reach an assistant sealed and it can name the one it is answering about.
 * Each passage notes where the funding document states it, when that is known.
 */
export function requirementsDocument(requirements: Requirement[], funding: SourceDocument | null): SourceDocument {
  const present = new Set(funding?.blocks.map((block) => block.id));
  const blocks = requirements.map((requirement, position): ExtractedBlock => {
    const stated = funding
      ? requirement.item.citations.find(
          (citation) => citation.documentId === funding.id && present.has(citation.blockId),
        )
      : undefined;
    const group = requirement.textMatch ? 'Found in the text' : RFP_SECTION_LABELS[requirement.section];
    return {
      id: blockIdAt(position),
      kind: 'list_item',
      text: requirement.item.text.replace(/\s+/gu, ' ').trim(),
      page: null,
      // The funding document is always the only one in its set, so its passages start "F1:".
      section: stated ? `${group}; stated in ${PREFIX.funding}1:${stated.blockId}` : group,
      headingLevel: null,
    };
  });
  return {
    id: 'funder-requirements',
    name: 'What the funder asks for',
    version: 1,
    label: 'Analysis of the funding document',
    blocks,
  };
}

/** The id an assistant sees for the requirement at a position. */
export function requirementAlias(position: number): string {
  return `${PREFIX.requirements}1:${blockIdAt(position)}`;
}

/**
 * A requirement with the funder's wording that was just quoted for it. It is
 * marked for review when it states a figure those quotations do not contain.
 */
export function citedRequirement(item: RfpItem, citations: Citation[]): RfpItem {
  const unquoted = unsupportedNumbers(item.text, quotesOf(citations));
  return { ...item, citations, needsReview: item.needsReview || unquoted.length > 0 };
}

/** The position of the requirement an id names, or null when it names none. */
export function requirementPosition(rendered: RenderedDocuments, alias: string): number | null {
  const target = rendered.resolve(alias);
  return target ? positionOfBlock(target.block.id) : null;
}

// ─────────────────────────── what the organization has ────────────────────────

const PASSAGES_PER_SEARCH = 6;
const MAX_SEARCHES = 48;
const MAX_QUERY_CHARACTERS = 400;

const flat = (text: string): string => text.replace(/\s+/gu, ' ').trim();

export function charactersIn(documents: SourceDocument[]): number {
  return documents.reduce(
    (total, document) => total + document.blocks.reduce((sum, block) => sum + block.text.length, 0),
    0,
  );
}

/** The organization's documents by id, for checking passages against the text that is stored now. */
export function knowledgeById(knowledge: SourceDocument[]): Map<string, SourceDocument> {
  return new Map(knowledge.map((document) => [document.id, document]));
}

/**
 * The stored blocks a passage names. Null when the passage does not belong to
 * the documents as they are now: an unknown document, an earlier version, or
 * wording that differs from what is stored.
 */
function storedPassage(
  passage: KnowledgePassage,
  knowledge: ReadonlyMap<string, SourceDocument>,
): { document: SourceDocument; blocks: ExtractedBlock[] } | null {
  const document = knowledge.get(passage.documentId);
  if (!document || document.version !== passage.documentVersion) return null;
  const named = new Set(passage.blockIds);
  const blocks = document.blocks.filter((block) => named.has(block.id));
  if (blocks.length === 0 || blocks.length !== named.size) return null;
  return flat(blocks.map((block) => block.text).join(' ')) === flat(passage.text) ? { document, blocks } : null;
}

export interface OrganizationMaterial {
  /** The approved profile first, then the organization's documents, or the passages chosen from them. */
  documents: SourceDocument[];
  /** True when the documents did not fit whole, so only passages found by search are included. */
  excerpted: boolean;
}

/**
 * The organization's side of a request: its approved profile and its documents.
 * When they do not fit in `budget` characters, the documents are replaced by
 * the passages a search finds for each query, kept as blocks of the documents
 * they come from so that every id and citation still points at the real text.
 */
export async function organizationMaterial(input: {
  baseline: ApprovedBaseline;
  knowledge: SourceDocument[];
  search: PassageSearch;
  /** What to look for when the documents do not fit whole. */
  queries: string[];
  budget: number;
  signal: AbortSignal;
}): Promise<OrganizationMaterial> {
  const profile = baselineDocument(input.baseline);
  // A citation into a document with the profile's id is read as an approved
  // statement, so no uploaded document may take that id.
  const own = input.knowledge.filter(
    (document) => document.id !== BASELINE_DOCUMENT_ID && document.blocks.length > 0,
  );
  if (charactersIn([profile, ...own]) <= input.budget) return { documents: [profile, ...own], excerpted: false };

  const byId = knowledgeById(own);
  const queries = [...new Set(input.queries.map((query) => flat(query).slice(0, MAX_QUERY_CHARACTERS)))]
    .filter((query) => query !== '')
    .slice(0, MAX_SEARCHES);
  const found: KnowledgePassage[][] = [];
  for (const query of queries) {
    throwIfCancelled(input.signal);
    found.push(await input.search(query, PASSAGES_PER_SEARCH));
  }

  const chosen = new Map<string, Set<string>>();
  let room = input.budget - charactersIn([profile]);
  // Every search contributes its best passage before any contributes its second.
  for (let rank = 0; rank < PASSAGES_PER_SEARCH; rank++) {
    for (const passages of found) {
      const passage = passages[rank];
      const stored = passage ? storedPassage(passage, byId) : null;
      if (!stored) continue;
      const taken = chosen.get(stored.document.id) ?? new Set<string>();
      const added = stored.blocks.filter((block) => !taken.has(block.id));
      const size = added.reduce((sum, block) => sum + block.text.length, 0);
      // A passage that does not fit is passed over; a shorter one further down still may.
      if (size > room) continue;
      room -= size;
      for (const block of added) taken.add(block.id);
      chosen.set(stored.document.id, taken);
    }
  }

  const excerpts = own.flatMap((document) => {
    const taken = chosen.get(document.id);
    return taken ? [{ ...document, blocks: document.blocks.filter((block) => taken.has(block.id)) }] : [];
  });
  return { documents: [profile, ...excerpts], excerpted: true };
}

/**
 * A passage found by search, offered word for word. The wording and every
 * citation come from the stored document, never from the search result. Null
 * when the passage cannot be confirmed there, or holds headings only.
 */
export function passageFact(
  passage: KnowledgePassage,
  knowledge: ReadonlyMap<string, SourceDocument>,
): DocumentedFact | null {
  const stored = storedPassage(passage, knowledge);
  if (!stored) return null;
  const citations = stored.blocks
    .filter((block) => block.kind !== 'heading')
    .flatMap((block) => {
      const verified = verifyQuote(stored.document.blocks, block.id, block.text);
      return verified && verified.blockId === block.id ? [toCitation(stored.document, verified)] : [];
    });
  if (citations.length === 0) return null;
  return { text: stored.blocks.map((block) => block.text).join('\n'), citations, claimId: null };
}

// ─────────────────────────────── checking an answer ───────────────────────────

export function quotesOf(citations: Citation[]): string[] {
  return citations.map((citation) => citation.quote);
}

/**
 * Citations for the evidence that is really in one of the sets. An id says
 * which set to look in; evidence whose id belongs to none of them is accepted
 * only where its words occur exactly. `dropped` counts what was not found.
 */
export function citeAcross(
  sets: RenderedDocuments[],
  evidence: RawEvidence[],
): { citations: Citation[]; dropped: number } {
  const citations: Citation[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const item of evidence.slice(0, MAX_EVIDENCE)) {
    const home = sets.find((set) => set.resolve(item.block_id) !== null);
    let found: Citation[] = [];
    for (const set of home ? [home] : sets) {
      found = set.cite([item]).citations;
      if (found.length > 0) break;
    }
    if (found.length === 0) dropped += 1;
    for (const citation of found) {
      const key = `${citation.documentId}:${citation.blockId}:${citation.quote}`;
      if (seen.has(key)) continue;
      seen.add(key);
      citations.push(citation);
    }
  }
  return { citations, dropped };
}

export interface FactCheck {
  facts: DocumentedFact[];
  /** Statements left out: no evidence was found for them, or they state a figure their quotations do not. */
  dropped: number;
  /** Single quotations that were not found, whether or not their statement survived. */
  evidenceDropped: number;
}

/**
 * Statements about the organization, kept only when the organization's own
 * material backs them. Each needs at least one quotation that is really there,
 * and every figure it states has to be in those quotations. A statement that
 * rests on the approved profile carries the id of the approved statement.
 */
export function verifyFacts(
  statements: RawStatement[],
  organization: RenderedDocuments,
  baseline: ApprovedBaseline,
): FactCheck {
  const facts: DocumentedFact[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  let evidenceDropped = 0;
  for (const statement of statements) {
    const cited = citeAcross([organization], statement.evidence);
    evidenceDropped += cited.dropped;
    const text = tidy(statement.text);
    const unsupported = unsupportedNumbers(text, quotesOf(cited.citations));
    if (text === '' || cited.citations.length === 0 || unsupported.length > 0) {
      dropped += 1;
      continue;
    }
    if (seen.has(text)) continue;
    seen.add(text);
    const claimId =
      cited.citations.map((citation) => claimIdForCitation(baseline, citation)).find((id) => id !== null) ?? null;
    facts.push({ text, citations: cited.citations, claimId });
  }
  return { facts, dropped, evidenceDropped };
}
