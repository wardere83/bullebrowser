// Reading an organization's profile out of its own documents.
//
// extractProfile is a pipeline: it is handed the documents and, when one is
// connected, the assistant. It reads nothing from disk and stores nothing. What
// it returns are proposals; the Knowledge Hub keeps them for a person to
// review, and nothing here becomes part of the profile on its own.
//
// With an assistant, the documents are shown sealed and the assistant answers
// with statements, each naming the passages that support it. Then the answer
// is checked here, and nothing in it is trusted before that:
//  - A statement is kept only when its evidence is found in the stored text
//    and every figure it states is in that evidence. Otherwise it is left out
//    and counted. It is never corrected.
//  - What it is told about the approved profile decides how a statement is
//    offered: not at all when a person has already approved it, as a
//    replacement, or as one side of a conflict.
//  - Documents that disagree stay two statements with a conflict between them.
//    Neither the assistant nor this code picks one.
// More text than one request can carry is read in groups and joined here, so a
// disagreement between two groups is not seen.
//
// Without an assistant, passages are offered word for word (profile-verbatim.ts).

import { applyTerminology } from '@bullebrowser/agent-core';
import {
  PROFILE_FIELDS,
  type Citation,
  type OrganizationKind,
  type ProfileFieldId,
  type ProfileGap,
} from '../../shared/funding.js';
import { cleanText } from '../documents/text.js';
import type { ExtractedBlock } from '../documents/types.js';
import { FundingError } from '../funding/errors.js';
import type { Complete, SourceDocument } from '../funding/pipeline.js';
import {
  DOCUMENT_RULES,
  MAX_DOCUMENT_CHARACTERS,
  renderDocuments,
  type RenderedDocuments,
} from '../funding/prompting.js';
import type {
  ExtractionInput,
  ExtractionOutcome,
  ExtractProfile,
  ProposedClaim,
  ProposedConflict,
} from '../funding/services.js';
import { profileAnswerSchema, type ProfileAnswer, type ProfileStatement } from './profile-extraction-schema.js';
import { gapNote, offerPassages, stopIfCancelled } from './profile-verbatim.js';
import { unsupportedNumbers } from './quote-verifier.js';

/** What belongs under each field, as the assistant is told. */
const FIELD_GUIDE: Record<ProfileFieldId, string> = {
  mission: 'why the organization exists, as it states its mission, purpose or vision.',
  populations_served:
    'who it serves: the people, households, customers or businesses it names, with any ages, incomes or other conditions it states.',
  geographic_scope: 'where it works: the neighborhoods, cities, counties, states or regions it names.',
  strategic_priorities:
    'what it has decided to pursue: adopted priorities, goals and planned investments, with their dates.',
  programs: 'what it does: its programs, services or products, and how each is delivered.',
  strengths:
    'what it has shown it can do: credentials, certifications, partnerships, experience and track record.',
  impact_evidence: 'results it reports: counts, rates and outcomes, and how they were measured.',
  capacity: 'what it has to work with: staff, governance, facilities, budget and financial management.',
  funding_goals: 'what it wants funded: amounts sought, their purposes and fundraising targets.',
};

/**
 * The rules of this task. Written by the app, the same for every organization,
 * and sent in the system prompt after the rules every document question shares.
 */
export const PROFILE_RULES = [
  "Your task is to report what an organization's own documents state about it, as short statements for a person to review. Nothing you report joins the organization's profile until a person approves it.",
  'Report what the documents state, and only that. Never infer a mission, a population or a figure that is not written. A field with nothing written is a gap, not a guess.',
  '',
  "Passages whose ids begin with D are the organization's documents. The section headed \"Approved profile\" names the organization and lists, with ids beginning with A, the statements a person has already approved. It may list none.",
  'Report on that organization only. A funder, partner, agency or other body that a document mentions is not the organization.',
  '',
  'Statements are sorted into nine fields:',
  ...PROFILE_FIELDS.map((field) => `- ${field}: ${FIELD_GUIDE[field]}`),
  '',
  'Each statement:',
  "- States one fact, in the organization's own terms, in at most 60 words. Two facts are two statements.",
  '- Has its position: 0 for your first statement, 1 for the next, and so on.',
  '- Has evidence: at least one passage from the documents (an id beginning with D) with a quotation that states the fact. An approved statement is not evidence, so never cite an id beginning with A.',
  '- Writes every number, date and amount exactly as its quotation does. If the passage spells a number out in words, spell it out too.',
  '- Says in "relation" how it stands to the approved statements, with the id of the approved statement in "related_id", copied as shown (for example A1:b0003):',
  '  - "new": no approved statement says this. Leave related_id empty.',
  '  - "same_as": an approved statement already says this, with the same figures.',
  '  - "updates": an approved statement in the same field covers the same point, this statement changes or adds a detail, and the document it comes from is plainly the later one: it is dated later, or says it replaces or refreshes the earlier one.',
  '  - "conflicts_with": it disagrees with an approved statement and the documents do not show which is later. When you are unsure between "updates" and "conflicts_with", use "conflicts_with".',
  '- Is reported even when it is the same as an approved statement, so that its field is not mistaken for a gap.',
  '',
  'Where documents disagree:',
  '- Where two documents disagree (a founding year, a service area, a budget total, a priority), give both statements separately, each with its own evidence, and add a conflict. Never choose between them, never combine them into one statement and never leave one out.',
  '- An older plan, proposal or budget is still one of the documents. Report what it states, and do not decide which document is current.',
  '- A conflict has the field, one sentence saying what differs, and the positions of the statements on each side. The sentence may use only figures that appear in those statements.',
  '- A statement that disagrees only with an approved statement needs no conflict. Its relation says so.',
  '',
  'Gaps:',
  '- For every field with no statement, add a gap with one sentence saying what is missing. Say only that it is missing. Do not suggest what the answer might be, and do not put a figure, a link or an address in it.',
].join('\n');

/** The whole system prompt: trusted text only, with nothing from any organization in it. */
export const PROFILE_SYSTEM = `${DOCUMENT_RULES}\n\n${PROFILE_RULES}`;

const NO_DOCUMENTS = 'Upload at least one document and wait for it to be read first.';
const READING = 'Reading your documents';
const CHECKING = 'Checking what was found against your documents';

const LEFT_OUT =
  'Statements were found for this field, but they could not be confirmed against your documents, so they were left out.';
const DOCUMENTS_DISAGREE = 'Your documents disagree on this point.';
const DISAGREES_WITH_APPROVED = 'A document disagrees with a statement you have already approved.';
const APPROVED_DISAGREE = 'Statements you have already approved disagree with each other.';

/** The approved statements shown with a request take at most this much of its room. */
const APPROVED_CHARACTERS = MAX_DOCUMENT_CHARACTERS / 4;
const ORGANIZATION_NAME_CHARACTERS = 200;
/** A sentence the assistant wrote that holds one of these is not shown: nothing stands behind it. */
const LINK_RE = /https?:\/\/|www\.|@/i;

type Approved = ExtractionInput['approved'][number];

/** The approved statements as one request shows them, and the way back from an id to a statement. */
interface ApprovedProfile {
  /** The sealed section. */
  text: string;
  characters: number;
  /** How many statements the section lists. */
  count: number;
  /** The approved statement an id in an answer names, or null when it names none. */
  find(id: string): Approved | null;
  /** The wording of an approved statement, by its own id. */
  textOf(claimId: string): string;
}

/**
 * Approved statements came from documents, so they are shown as documents are:
 * sealed, one passage each, under ids of their own. The organization's name is
 * typed by a person and travels the same way, as the name of the section.
 */
function showApproved(organizationName: string, approved: Approved[]): ApprovedProfile {
  const byBlock = new Map<string, Approved>();
  const byId = new Map<string, Approved>();
  const blocks: ExtractedBlock[] = [];
  let characters = 0;
  for (const claim of approved) {
    const text = cleanText(claim.text);
    // A statement that does not fit is not shown, so nothing can be related to it. It may then be proposed again.
    if (!text || characters + text.length > APPROVED_CHARACTERS) continue;
    const id = `b${String(blocks.length + 1).padStart(4, '0')}`;
    blocks.push({ id, kind: 'paragraph', text, page: null, section: claim.field, headingLevel: null });
    byBlock.set(id, claim);
    byId.set(claim.id, claim);
    characters += text.length;
  }

  const name = cleanText(organizationName).slice(0, ORGANIZATION_NAME_CHARACTERS) || 'name not given';
  const rendered = renderDocuments([{ id: 'approved-profile', name, version: 1, label: 'Approved profile', blocks }], 'A');
  return {
    text: rendered.text,
    characters,
    count: blocks.length,
    find: (id) => {
      const shown = rendered.resolve(id);
      return shown ? (byBlock.get(shown.block.id) ?? null) : null;
    },
    textOf: (claimId) => byId.get(claimId)?.text ?? '',
  };
}

/** Characters of text in blocks, counted as renderDocuments counts them. */
function sizeOf(blocks: ExtractedBlock[]): number {
  return blocks.reduce((total, block) => total + block.text.length, 0);
}

/**
 * A block longer than one request can carry, cut between words. Every piece
 * keeps the block's id, page and section, so a quotation found in a piece is
 * cited to the block it came from, and is still a slice of that block's text.
 */
function cutBlock(block: ExtractedBlock, limit: number): ExtractedBlock[] {
  if (block.text.length <= limit) return [block];
  const pieces: ExtractedBlock[] = [];
  let rest = block.text;
  while (rest.length > limit) {
    const space = rest.lastIndexOf(' ', limit);
    let end = space > 0 ? space : limit;
    // Not between the two halves of one character.
    const last = rest.charCodeAt(end - 1);
    if (end > 1 && last >= 0xd800 && last <= 0xdbff) end -= 1;
    pieces.push({ ...block, text: rest.slice(0, end) });
    rest = rest.slice(end).trimStart();
  }
  if (rest) pieces.push({ ...block, text: rest });
  return pieces;
}

/** A document too long for one request, as parts split at block boundaries. Block ids are kept. */
function splitDocument(document: SourceDocument, limit: number): SourceDocument[] {
  const parts: ExtractedBlock[][] = [];
  let current: ExtractedBlock[] = [];
  let used = 0;
  for (const piece of document.blocks.flatMap((block) => cutBlock(block, limit))) {
    // Two pieces of one block never share a part: both would answer to the same id.
    const full = used + piece.text.length > limit || current[current.length - 1]?.id === piece.id;
    if (current.length > 0 && full) {
      parts.push(current);
      current = [];
      used = 0;
    }
    current.push(piece);
    used += piece.text.length;
  }
  if (current.length > 0) parts.push(current);
  return parts.map((blocks, index) => ({
    ...document,
    label: `${document.label}, part ${index + 1} of ${parts.length}`,
    blocks,
  }));
}

/**
 * The documents as groups that each fit in one request of `limit` characters,
 * in the order given. A document stays whole wherever it can; only one longer
 * than the limit is split, at block boundaries.
 */
export function groupDocuments(documents: SourceDocument[], limit: number): SourceDocument[][] {
  const room = Math.max(1, Math.floor(limit));
  const groups: SourceDocument[][] = [];
  let current: SourceDocument[] = [];
  let used = 0;
  const add = (document: SourceDocument) => {
    const size = sizeOf(document.blocks);
    // Two parts of one document never share a request: their passage ids would collide.
    const full = used + size > room || current.some((held) => held.id === document.id);
    if (current.length > 0 && full) {
      groups.push(current);
      current = [];
      used = 0;
    }
    current.push(document);
    used += size;
  };
  for (const document of documents) {
    if (sizeOf(document.blocks) <= room) add(document);
    else for (const part of splitDocument(document, room)) add(part);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/**
 * What to do with one group of documents. Built only from words written here
 * and from counts: nothing a person typed or uploaded is ever part of it.
 */
function taskFor(kind: OrganizationKind, part: number, parts: number, approvedCount: number): string {
  const lines = [
    `Read the documents and report what they state about the organization, which is ${kind === 'cbo' ? 'a CBO' : 'a business'}.`,
  ];
  if (parts > 1) {
    lines.push(
      `These documents are part ${part} of ${parts} of what the organization has uploaded. Report only what these passages state. The other parts are read separately.`,
    );
  }
  lines.push(
    approvedCount > 0
      ? `The approved profile lists ${approvedCount} ${approvedCount === 1 ? 'statement' : 'statements'}. Say how each of your statements relates to them.`
      : 'No statement has been approved yet, so every relation is "new" and every related_id is empty.',
    'Return the statements, the conflicts between documents, and a gap for every field with no statement.',
  );
  return lines.join('\n');
}

/** What has been found so far, across every group read. */
interface Tally {
  claims: ProposedClaim[];
  /** Where a statement already in `claims` is, by field and wording. */
  placed: Map<string, number>;
  conflicts: ProposedConflict[];
  conflictKeys: Set<string>;
  /** Fields the documents were found to speak to, whether or not anything new is proposed for them. */
  covered: Set<ProfileFieldId>;
  /** Fields that lost a statement to the checks. */
  refused: Set<ProfileFieldId>;
  /** What the assistant said is missing, by field. */
  notes: Map<ProfileFieldId, string>;
  dropped: number;
}

/** What became of one statement in an answer. */
type Fate =
  | { kind: 'dropped' }
  /** A person has already approved this, so it is not proposed again. */
  | { kind: 'approved'; id: string }
  /** Proposed, at `index` in the claims. `against` is the approved statement it disagrees with. */
  | { kind: 'proposed'; index: number; against: string | null };

/**
 * A sentence the assistant wrote for people, ready to show, or empty when it
 * says something that nothing stands behind: a link, an address, or a figure
 * that `support` does not contain.
 */
function vetted(sentence: string, support: string[]): string {
  const text = applyTerminology(cleanText(sentence));
  return LINK_RE.test(text) || unsupportedNumbers(text, support).length > 0 ? '' : text;
}

function citationKey(citation: Citation): string {
  return `${citation.documentId}:${citation.blockId}:${citation.quote}`;
}

/** Adds a claim, or joins it to the same statement found earlier. Returns where it is. */
function place(tally: Tally, claim: ProposedClaim): number {
  const wording = claim.text.normalize('NFKC').toLowerCase().replace(/[.\s]+$/, '');
  const key = `${claim.field}\n${wording}`;
  const index = tally.placed.get(key);
  const existing = index === undefined ? undefined : tally.claims[index];
  if (index === undefined || !existing) {
    tally.placed.set(key, tally.claims.length);
    tally.claims.push(claim);
    return tally.claims.length - 1;
  }
  // The same statement, found again: one claim, with every passage that supports it.
  const held = new Set(existing.citations.map(citationKey));
  for (const citation of claim.citations) {
    if (held.has(citationKey(citation))) continue;
    held.add(citationKey(citation));
    existing.citations.push(citation);
  }
  existing.supersedesClaimId ??= claim.supersedesClaimId;
  return index;
}

/** Checks one statement against the stored text and the approved profile, and files it. */
function weigh(tally: Tally, statement: ProfileStatement, rendered: RenderedDocuments, approved: ApprovedProfile): Fate {
  const text = applyTerminology(cleanText(statement.text));
  const { citations } = rendered.cite(statement.evidence);
  const quotes = citations.map((citation) => citation.quote);
  // Kept only with evidence that is in the documents and that holds every
  // figure the statement states. Anything else is left out, not put right.
  if (!text || citations.length === 0 || unsupportedNumbers(text, quotes).length > 0) {
    tally.dropped += 1;
    tally.refused.add(statement.field);
    return { kind: 'dropped' };
  }
  tally.covered.add(statement.field);

  const related = statement.relation === 'new' ? null : approved.find(statement.related_id);
  // The relation is the assistant's reading of untrusted documents, so it may
  // hide a statement only when the two really can be the same: one that states
  // a figure the approved statement lacks is shown, whatever the answer says.
  if (statement.relation === 'same_as' && related && unsupportedNumbers(text, [related.text]).length === 0) {
    return { kind: 'approved', id: related.id };
  }

  const replaces = statement.relation === 'updates' && related?.field === statement.field;
  const index = place(tally, {
    field: statement.field,
    text,
    origin: 'extracted',
    citations,
    supersedesClaimId: replaces && related ? related.id : null,
  });
  return { kind: 'proposed', index, against: statement.relation === 'conflicts_with' && related ? related.id : null };
}

/** The app's own words for a conflict whose summary cannot be shown. */
function ownSummary(proposals: number, approvedStatements: number): string {
  if (approvedStatements === 0) return DOCUMENTS_DISAGREE;
  return proposals > 0 ? DISAGREES_WITH_APPROVED : APPROVED_DISAGREE;
}

function recordConflict(
  tally: Tally,
  approved: ApprovedProfile,
  conflict: { field: ProfileFieldId; summary: string; claimIndexes: Set<number>; existing: Set<string> },
): void {
  const claimIndexes = [...conflict.claimIndexes].sort((a, b) => a - b);
  const existingClaimIds = [...conflict.existing];
  const key = `${claimIndexes.join(',')}|${[...existingClaimIds].sort().join(',')}`;
  if (tally.conflictKeys.has(key)) return;
  tally.conflictKeys.add(key);

  // The summary may state only the figures its own sides state.
  const support = [
    ...claimIndexes.flatMap((index) => tally.claims[index]?.citations.map((citation) => citation.quote) ?? []),
    ...existingClaimIds.map((id) => approved.textOf(id)),
  ];
  tally.conflicts.push({
    field: conflict.field,
    summary: vetted(conflict.summary, support) || ownSummary(claimIndexes.length, existingClaimIds.length),
    claimIndexes,
    existingClaimIds,
  });
}

/** Takes one answer into the tally: its statements, then the conflicts and gaps that survive them. */
function absorb(tally: Tally, answer: ProfileAnswer, rendered: RenderedDocuments, approved: ApprovedProfile): void {
  const fates = answer.statements.map((statement) => weigh(tally, statement, rendered, approved));
  const placeOf = new Map(answer.statements.map((statement, index) => [statement.position, index]));
  const inConflict = new Set<number>();

  for (const conflict of answer.conflicts) {
    const claimIndexes = new Set<number>();
    const existing = new Set<string>();
    const members: number[] = [];
    for (const position of conflict.statements) {
      const index = placeOf.get(position);
      const fate = index === undefined ? undefined : fates[index];
      if (index === undefined || !fate || fate.kind === 'dropped') continue;
      members.push(index);
      if (fate.kind === 'approved') {
        existing.add(fate.id);
      } else {
        claimIndexes.add(fate.index);
        if (fate.against) existing.add(fate.against);
      }
    }
    // A disagreement has two sides. One that lost a side to the checks says nothing.
    if (claimIndexes.size + existing.size < 2) continue;
    for (const index of members) inConflict.add(index);
    recordConflict(tally, approved, { field: conflict.field, summary: conflict.summary, claimIndexes, existing });
  }

  // A statement that disagrees with an approved one is a conflict whether or
  // not the answer lists it as one. Those against the same statement go together.
  const againstApproved = new Map<string, { field: ProfileFieldId; claimIndexes: Set<number> }>();
  answer.statements.forEach((statement, index) => {
    const fate = fates[index];
    if (!fate || fate.kind !== 'proposed' || !fate.against || inConflict.has(index)) return;
    const entry = againstApproved.get(fate.against) ?? { field: statement.field, claimIndexes: new Set<number>() };
    entry.claimIndexes.add(fate.index);
    againstApproved.set(fate.against, entry);
  });
  for (const [id, entry] of againstApproved) {
    recordConflict(tally, approved, { ...entry, summary: DISAGREES_WITH_APPROVED, existing: new Set([id]) });
  }

  for (const gap of answer.gaps) {
    if (tally.notes.has(gap.field)) continue;
    // A note says what is missing. One that states a figure is saying more than that.
    const note = vetted(gap.note, []);
    if (note) tally.notes.set(gap.field, note);
  }
}

/** A gap for every field in which nothing was found that could be confirmed. */
function gapsOf(tally: Tally): ProfileGap[] {
  return PROFILE_FIELDS.filter((field) => !tally.covered.has(field)).map((field) => ({
    field,
    note: tally.refused.has(field) ? LEFT_OUT : (tally.notes.get(field) ?? gapNote(field)),
  }));
}

async function readWithAssistant(input: ExtractionInput, complete: Complete): Promise<ExtractionOutcome> {
  const { signal, progress } = input;
  const approved = showApproved(input.organization.name, input.approved);
  // The approved statements travel with every request, so the documents get what is left.
  const groups = groupDocuments(input.documents, MAX_DOCUMENT_CHARACTERS - approved.characters);
  const schema = profileAnswerSchema((id) => approved.find(id) !== null);
  const tally: Tally = {
    claims: [],
    placed: new Map(),
    conflicts: [],
    conflictKeys: new Set(),
    covered: new Set(),
    refused: new Set(),
    notes: new Map(),
    dropped: 0,
  };

  for (const [index, group] of groups.entries()) {
    stopIfCancelled(signal);
    const reading = groups.length === 1 ? READING : `${READING}, part ${index + 1} of ${groups.length}`;
    progress(reading, Math.round(5 + (90 * index) / groups.length));

    const rendered = renderDocuments(group);
    let answer: ProfileAnswer;
    try {
      answer = await complete({
        system: PROFILE_SYSTEM,
        documents: `${rendered.text}\n\n${approved.text}`,
        task: taskFor(input.organization.kind, index + 1, groups.length, approved.count),
        schema,
        signal,
      });
    } catch (error) {
      // However a stopped request fails, the person asked for it to stop.
      stopIfCancelled(signal);
      throw error;
    }
    stopIfCancelled(signal);

    progress(CHECKING, Math.round(5 + (90 * (index + 0.9)) / groups.length));
    absorb(tally, answer, rendered, approved);
  }

  return {
    method: 'assistant',
    claims: tally.claims,
    conflicts: tally.conflicts,
    gaps: gapsOf(tally),
    dropped: tally.dropped,
  };
}

/**
 * Proposes profile statements from an organization's documents: with the
 * assistant when one is connected, and otherwise as passages offered word for
 * word. Every claim returned carries at least one citation cut from the
 * stored text.
 */
export const extractProfile: ExtractProfile = async (input) => {
  stopIfCancelled(input.signal);
  const documents = input.documents.filter((document) => document.blocks.length > 0);
  if (documents.length === 0) throw new FundingError('INVALID_INPUT', NO_DOCUMENTS);
  return input.complete
    ? readWithAssistant({ ...input, documents }, input.complete)
    : offerPassages({ ...input, documents });
};
