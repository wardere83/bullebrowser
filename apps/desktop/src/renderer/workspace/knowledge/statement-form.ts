// The logic behind the form for writing a profile statement by hand: checking
// the wording, keeping track of the passages picked as evidence, and working
// out which part of a passage a person selected. Kept apart from the form so
// it can be tested.
//
// Evidence is only ever text the app read from a document. The form never
// lets a quotation be typed: a person picks a passage, and may narrow it to a
// part of that same text. Main verifies each quotation again before storing it.

import type { KnowledgePassage, NewClaimInput, ProfileFieldId } from '../../../shared/funding.js';
import { passageKey } from './passages.js';

// ───────────────────────────── a part of a passage ─────────────────────────────

/** A stretch of a passage's text, as offsets into it. */
export interface PartRange {
  start: number;
  end: number;
}

const LETTER = /\p{L}/u;
const DIGIT = /\p{N}/u;
const WHITE_SPACE = /\s/;
const CURRENCY_SIGN = /\p{Sc}/u;

/** True when the character at `index` belongs to a word or a number. */
function isWordAt(text: string, index: number): boolean {
  const character = text[index];
  if (character === undefined) return false;
  if (LETTER.test(character) || DIGIT.test(character)) return true;
  const before = text[index - 1] ?? '';
  const after = text[index + 1] ?? '';
  // "1,250" and "4.5" are each one number; "organization’s" is one word.
  if ((character === ',' || character === '.') && DIGIT.test(before) && DIGIT.test(after)) {
    return true;
  }
  return (character === "'" || character === '’') && LETTER.test(before) && LETTER.test(after);
}

/**
 * The part of a passage a person selected, or null when the selection is empty
 * or takes in the whole passage. White space at the ends is left out, and the
 * part is widened to whole words and whole numbers: main only accepts a
 * quotation that starts and ends on one, and "250 residents" cut out of
 * "1,250 residents" would say something the document does not.
 */
export function partOf(text: string, selectionStart: number, selectionEnd: number): PartRange | null {
  // A selection can be made backwards, and an offset the browser could not give counts as the start.
  const clamp = (value: number) =>
    Number.isFinite(value) ? Math.max(0, Math.min(text.length, Math.floor(value))) : 0;
  const from = clamp(selectionStart);
  const to = clamp(selectionEnd);
  let start = Math.min(from, to);
  let end = Math.max(from, to);

  while (start < end && WHITE_SPACE.test(text[start] ?? '')) start += 1;
  while (end > start && WHITE_SPACE.test(text[end - 1] ?? '')) end -= 1;
  if (start >= end) return null;

  while (start > 0 && isWordAt(text, start) && isWordAt(text, start - 1)) start -= 1;
  while (end < text.length && isWordAt(text, end - 1) && isWordAt(text, end)) end += 1;
  // An amount keeps its currency sign.
  if (start > 0 && DIGIT.test(text[start] ?? '') && CURRENCY_SIGN.test(text[start - 1] ?? '')) {
    start -= 1;
  }

  const leading = text.length - text.trimStart().length;
  const trailing = text.trimEnd().length;
  if (start <= leading && end >= trailing) return null;
  return { start, end };
}

// ──────────────────────────────── picked evidence ──────────────────────────────

export interface EvidencePick {
  passage: KnowledgePassage;
  /** The part to cite, or null to cite the whole passage. */
  part: PartRange | null;
}

/** The passages picked as evidence, by passage key, in the order they were picked. */
export type EvidencePicks = ReadonlyMap<string, EvidencePick>;

export const NO_PICKS: EvidencePicks = new Map();

/** A passage can be cited when it has text and a block for the citation to point at. */
export function canCite(passage: Pick<KnowledgePassage, 'blockIds' | 'text'>): boolean {
  return Boolean(passage.blockIds[0]) && passage.text.trim().length > 0;
}

export function togglePick(
  picks: EvidencePicks,
  passage: KnowledgePassage,
  picked: boolean,
): EvidencePicks {
  const key = passageKey(passage);
  if (picks.has(key) === picked) return picks;
  const next = new Map(picks);
  if (picked) next.set(key, { passage, part: null });
  else next.delete(key);
  return next;
}

/** Narrows a picked passage to a part of it, or widens it back to the whole with null. */
export function withPart(picks: EvidencePicks, key: string, part: PartRange | null): EvidencePicks {
  const pick = picks.get(key);
  if (!pick) return picks;
  const next = new Map(picks);
  next.set(key, { ...pick, part });
  return next;
}

/** The words that will be cited: the selected part, or the passage as the app read it. */
export function quoteOf(pick: EvidencePick): string {
  return pick.part ? pick.passage.text.slice(pick.part.start, pick.part.end) : pick.passage.text;
}

/**
 * The evidence as main expects it: the document, the first block the passage
 * is made of, and the words to cite. A passage with no block to point at is
 * left out.
 */
export function toEvidence(picks: Iterable<EvidencePick>): NewClaimInput['evidence'] {
  const evidence: NewClaimInput['evidence'] = [];
  for (const pick of picks) {
    const blockId = pick.passage.blockIds[0];
    const quote = quoteOf(pick);
    if (!blockId || !quote.trim()) continue;
    evidence.push({ documentId: pick.passage.documentId, blockId, quote });
  }
  return evidence;
}

// ─────────────────────────────────── the wording ───────────────────────────────

export const STATEMENT_MISSING = 'Write the statement before you save it.';

/** The statement as it will be saved, or what is wrong with it. Main has the final say. */
export function checkStatement(
  text: string,
): { ok: true; text: string } | { ok: false; error: string } {
  const tidy = text.trim();
  return tidy ? { ok: true, text: tidy } : { ok: false, error: STATEMENT_MISSING };
}

export function buildClaimInput(
  field: ProfileFieldId,
  text: string,
  picks: Iterable<EvidencePick>,
): { ok: true; input: NewClaimInput } | { ok: false; error: string } {
  const checked = checkStatement(text);
  if (!checked.ok) return checked;
  return { ok: true, input: { field, text: checked.text, evidence: toEvidence(picks) } };
}

/** True when an edit changes nothing worth saving. */
export function sameWording(original: string, edited: string): boolean {
  return original.trim() === edited.trim();
}

/**
 * What to say when a statement was saved with fewer sources than were picked.
 * Main leaves out any passage it cannot match to its document; this reports
 * the count without guessing which one. Empty when nothing was left out.
 */
export function leftOutNote(picked: number, cited: number): string {
  if (picked <= 0 || cited >= picked) return '';
  const rule = 'A passage that cannot be matched to its document is left out.';
  if (cited <= 0) {
    return picked === 1
      ? `The passage you picked is not cited. ${rule}`
      : `None of the ${picked} passages you picked is cited. ${rule}`;
  }
  return `Only ${cited} of the ${picked} passages you picked ${cited === 1 ? 'is' : 'are'} cited. ${rule}`;
}
