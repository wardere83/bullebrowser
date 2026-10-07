// Reading a funding document for someone who may apply: what the funder is
// investing in, who may apply, what it asks for and when, each point beside the
// passage that says so.
//
// A pipeline: it is handed the document and, when one is connected, an
// assistant, and it returns an analysis without reading or writing anything.
// The assistant writes the plain-language points; everything after that is
// decided here, in code, against the text the app itself read:
//
//  - Evidence is looked up in the stored text. What cannot be found is dropped
//    and counted, never repaired.
//  - A point with no evidence left is dropped. If it claimed to be the
//    document's own statement, its section is marked unclear.
//  - A point whose wording carries a figure or a date that its evidence does
//    not is kept and flagged for a person to check.
//  - A position on AI tools counts only with evidence, and where the wording
//    sets a limit it is recorded as restricted.
//
// Without an assistant the result is the literal findings alone, and says so.

import { applyTerminology } from '@bullebrowser/agent-core';
import {
  RFP_SECTIONS,
  RFP_SECTION_LABELS,
  type AiUsePolicy,
  type AiUseStance,
  type AnalysisNote,
  type Citation,
  type GlossaryTerm,
  type LiteralFinding,
  type RfpAnalysis,
  type RfpItem,
  type RfpSection,
  type RfpSectionId,
  type StatementBasis,
} from '../../shared/funding.js';
import { cleanText } from '../documents/text.js';
import type { ExtractedBlock } from '../documents/types.js';
import { FundingError } from '../funding/errors.js';
import {
  DOCUMENT_RULES,
  MAX_DOCUMENT_CHARACTERS,
  renderDocuments,
  type RawEvidence,
  type RenderedDocuments,
} from '../funding/prompting.js';
import type { AnalyzeRfp } from '../funding/services.js';
import { numbersIn, unsupportedNumbers } from '../knowledge/quote-verifier.js';
import {
  RFP_ANALYSIS_SCHEMA,
  type Coverage,
  type RawNote,
  type RawRfpAnalysis,
  type RawSection,
} from './analysis-schema.js';
import { MAX_FINDINGS_PER_KIND, datesIn, findLiterals } from './literal-findings.js';

/** Passage ids of a funding document start with this letter, e.g. [F1:b0007]. */
const PREFIX = 'F';
/** Room for an answer with thirteen sections of quoted evidence. */
const ANSWER_TOKENS = 48_000;
// More than any real document needs. A longer list is cut, and the analysis says so.
const MAX_ITEMS_PER_SECTION = 80;
const MAX_GLOSSARY_TERMS = 80;
const MAX_NOTES = 40;

// ─────────────────────────────── what the assistant is told ───────────────────────────────

const ANALYSIS_RULES = [
  'This task: explain a funding document to someone who may be applying for funding for the first time. It may be a request for proposals, a notice of funding or the text of an official listing.',
  'Rules for this task:',
  '- Write for a reader who is new to grants. Use short sentences and everyday words, and make one point at a time.',
  '- The first time you use a funding term, such as "match", "indirect costs" or "letter of intent", explain it in a few plain words in the same sentence, and list the term in the glossary. Where the document itself defines the term, give the document\'s meaning and cite that passage in the glossary entry.',
  '- Give evidence for every point. The reader is shown the page or section of each passage you cite, so cite the passage that states the point, not one that is merely near it.',
  '- Keep what the document requires apart from your own reading of it. Mark a point "explicit" only when the document states it in so many words. Mark it "interpretation" when it is your reading of what the document means or implies, and word it so the reader can tell, for example "This appears to mean".',
  '- Write every figure and date the way the document writes it: if it says "three years", write "three years", not "3 years". Leave passage ids, page numbers and section numbers out of your sentences; the reader is shown where each point comes from.',
  '- Do not fill a gap. When the document does not cover something, or mentions it without enough detail to rely on, say so, and list it under the uncertainties or the questions. Never supply a typical value, a usual practice or a guess.',
  '- Report what the document says. Do not advise the reader whether to apply, and say nothing about any particular applicant.',
  '- Identify amendments and revised requirements. Use a replacement requirement only when the reference explicitly establishes that it supersedes an earlier one; cite the current requirement and the statement establishing precedence. Do not infer precedence from a file name, upload order or an assumed date. Flag conflicting deadlines, eligibility rules, amounts or instructions in uncertainties when their precedence remains unresolved, and ask the applicant to confirm them with the funder.',
].join('\n');

/** Trusted instructions only: the shared rules for reading documents, then the rules for this task. */
export const ANALYSIS_SYSTEM = `${DOCUMENT_RULES}\n\n${ANALYSIS_RULES}`;

const TOPICS: Record<RfpSectionId, string> = {
  purpose: 'why the funder is offering this funding and what it is meant to change',
  priorities: 'what the funder says it prefers or will give priority to',
  outcomes: 'the results the funder expects funded work to produce, with any targets it sets',
  eligibility: 'who may apply, who may not, and the conditions an applicant has to meet',
  supported_activities: 'what the funding may be spent on, what it may not be spent on, and any limits on costs',
  award_amounts: 'the size of an award, the total available and how many awards are expected',
  matching: 'any share of the cost the applicant has to provide itself, in money or in kind',
  funding_period: 'when funded work starts, how long it runs and whether it can be renewed',
  deadlines: 'every date an applicant has to meet, with the time and time zone where given',
  evaluation_criteria: 'how applications are judged, with the points or weights where given',
  required_documents: 'everything an application has to include, with page limits and formats where given',
  submission_steps: 'how and where to apply, step by step, including anything to register for first',
  reporting: 'what a funded applicant has to report afterwards, and when',
};

/** What to do with the document. Fixed wording: nothing from a document is ever placed here. */
function analysisTask(part: number, parts: number): string {
  const split = parts > 1;
  return [
    `Analyze the funding document in the reference material. Its passages have ids that begin with "${PREFIX}1:".`,
    ...(split
      ? [
          `The document is too long to read in one pass, so it is being read in ${parts} parts, and this is part ${part}. Report only what this part says. Where this part does not cover a topic, give that topic the coverage "missing": the other parts are read separately.`,
        ]
      : []),
    'Return these fields.',
    'overview: two or three plain sentences on what the funder is investing in and who the funding is for. Leave amounts and dates to the sections, where each is cited.' +
      (split ? ' If this part does not say what the funder is investing in, return an empty string.' : ''),
    [
      'sections: one entry for each topic listed below. For each topic give',
      '- coverage: "stated" when the document covers the topic, "unclear" when it mentions the topic without enough detail to rely on, "missing" when it does not cover it;',
      '- note: when coverage is "unclear" or "missing", one or two sentences on what is unclear or missing; otherwise an empty string;',
      '- items: the separate points the document makes on the topic, one point to an item, in the document\'s own order. Each item has a text of one or two plain sentences, a basis ("explicit" or "interpretation") and its evidence.',
      'The topics:',
      ...RFP_SECTIONS.map((id) => `- ${id} (${RFP_SECTION_LABELS[id]}): ${TOPICS[id]}.`),
    ].join('\n'),
    "glossary: each funding term you explained, with what it means in one or two plain sentences. Give the meaning of the term, not this document's figures. Add evidence only where the document itself defines or explains the term; otherwise leave the evidence empty.",
    [
      'ai_use: what the document says about using AI tools, such as writing assistants or chatbots, to prepare an application. Choose the stance this way:',
      '- "not_stated": the document says nothing about it.',
      '- "prohibited": the document bans their use.',
      '- "restricted": the document limits their use in any way short of a ban, for example to certain tasks or certain parts of the application, or sets conditions on what is submitted. If you are unsure whether the document limits their use, choose this.',
      '- "permitted_with_disclosure": the document allows their use, and the only condition is telling the funder.',
      '- "permitted": the document allows their use with no conditions.',
      'Give a summary of one or two plain sentences, and as evidence every passage that sets the rule. When the stance is "not_stated", leave the evidence empty.',
    ].join('\n'),
    'uncertainties: things the document leaves open, states without enough detail, or says in two ways that do not agree, which an applicant should settle before applying. One point each, with evidence where a passage shows the problem.',
    "questions: questions to put to the funder, or to answer inside the applicant's own organization, before applying. One question each, with evidence where a passage prompts it.",
  ].join('\n\n');
}

// ─────────────────────────────── sentences the app writes ───────────────────────────────

const INVALID_ANSWER = "The assistant's answer did not pass our checks, so it was not used. Try again.";
const NOTHING_TO_READ = 'This funding document has no readable text to analyze.';

const NEEDS_ASSISTANT =
  'A connected assistant is needed for a written summary of this part of the document. The text matches below list what was found by its wording.';
const TEXT_MATCHES_ONLY =
  'No assistant is connected, so this lists text matches only: dates, amounts and sentences found by their wording. Nothing is summarized or interpreted, and a match can mean something other than its label suggests.';
const AI_NEEDS_ASSISTANT =
  'A connected assistant is needed to summarize what this document says about AI tools. Passages that mention AI tools, if there are any, are listed under the text matches for you to read.';
const TOO_LONG_FOR_ASSISTANT =
  'The text of this document is not divided into passages short enough to send to the assistant, so it could not be summarized.';

const NOT_COVERED = 'The document does not cover this.';
const NOT_ENOUGH_DETAIL = 'The document mentions this without enough detail to rely on.';
const NOTHING_CONFIRMED =
  'The assistant reported that the document covers this, but gave no point that could be confirmed in the document. Check the document for this.';
const CONTRADICTED = 'The assistant marked this as not covered, but also listed the points shown here. Check them against the document.';
const leftOutHere = (count: number): string =>
  count === 1
    ? 'One point the assistant gave here was left out, because the passage it quoted could not be found in the document. Check the document for this.'
    : `${count} points the assistant gave here were left out, because the passages it quoted could not be found in the document. Check the document for this.`;

const AI_NOTHING_FOUND = 'The assistant found nothing in this document about using AI tools to prepare an application.';
const AI_UNCONFIRMED =
  "The assistant reported that this document says something about using AI tools, but the wording it pointed to could not be confirmed in the document, so no position is recorded here. Read the document's own terms before using AI tools on this application.";
const AI_SEE_MATCHES = 'Passages that mention AI tools are listed under the text matches for you to read.';
const AI_TIGHTENED = 'The wording cited here sets a limit on that use, so it is recorded as restricted.';
const AI_ALSO_UNCONFIRMED =
  "Something else the assistant reported about AI tools could not be confirmed in the document, so read the document's own terms as well.";
const AI_DEFAULT_SUMMARY: Record<Exclude<AiUseStance, 'not_stated'>, string> = {
  permitted: 'The document allows AI tools to be used in preparing an application. Read the cited passages for its exact terms.',
  permitted_with_disclosure:
    'The document allows AI tools to be used in preparing an application, as long as their use is disclosed. Read the cited passages for its exact terms.',
  restricted: 'The document sets limits on using AI tools to prepare an application. Read the cited passages for its exact terms.',
  prohibited: 'The document does not allow AI tools to be used in preparing an application. Read the cited passages for its exact terms.',
};

const plural = (count: number, one: string, many: string): string => (count === 1 ? one : many.replace('#', String(count)));

// ─────────────────────────────── reading one answer ───────────────────────────────

interface KeptItem {
  text: string;
  basis: StatementBasis;
  citations: Citation[];
}

interface SectionReading {
  coverage: Coverage;
  note: string;
  /** True when the assistant called the topic missing and listed points for it all the same. */
  contradicted: boolean;
  items: KeptItem[];
  droppedExplicit: number;
  droppedInterpretation: number;
}

interface NoteReading {
  text: string;
  citations: Citation[];
}

interface AiReading {
  stance: AiUseStance;
  summary: string;
  citations: Citation[];
  /** True when a position was reported and none of its evidence could be found. */
  unconfirmed: boolean;
}

/** One answer, with every quotation already looked up in the text it was written about. */
interface Reading {
  overview: string;
  sections: Record<RfpSectionId, SectionReading>;
  glossary: GlossaryTerm[];
  aiUse: AiReading;
  uncertainties: NoteReading[];
  questions: NoteReading[];
  /** Quotations that could not be found. */
  droppedQuotes: number;
}

type Cite = (evidence: RawEvidence[]) => Citation[];

/** Text written by the assistant, as it is shown: one line, nothing invisible, in the product's wording. */
const say = (text: string): string => applyTerminology(cleanText(text));

function readSection(raw: RawSection, cite: Cite): SectionReading {
  const items: KeptItem[] = [];
  let droppedExplicit = 0;
  let droppedInterpretation = 0;
  for (const item of raw.items) {
    const text = say(item.text);
    if (!text) continue;
    const citations = cite(item.evidence);
    if (citations.length > 0) items.push({ text, basis: item.basis, citations });
    else if (item.basis === 'explicit') droppedExplicit += 1;
    else droppedInterpretation += 1;
  }
  const contradicted = raw.coverage === 'missing' && items.length > 0;
  return {
    coverage: contradicted ? 'unclear' : raw.coverage,
    note: say(raw.note),
    contradicted,
    items,
    droppedExplicit,
    droppedInterpretation,
  };
}

function readNotes(raw: RawNote[], cite: Cite): NoteReading[] {
  // An open point or a question may stand without a passage; what it does cite still has to be there.
  return raw.map((note) => ({ text: say(note.text), citations: cite(note.evidence) })).filter((note) => note.text);
}

function readAnswer(answer: unknown, rendered: RenderedDocuments): Reading {
  // The answer was checked where it was received. It is checked again here, so
  // that nothing below depends on who supplied `complete`.
  const parsed = RFP_ANALYSIS_SCHEMA.zod.safeParse(answer);
  if (!parsed.success) throw new FundingError('ASSISTANT_ERROR', INVALID_ANSWER);
  const raw: RawRfpAnalysis = parsed.data;

  let droppedQuotes = 0;
  const cite: Cite = (evidence) => {
    const { citations, dropped } = rendered.cite(evidence);
    droppedQuotes += dropped;
    return citations;
  };

  const sections = {} as Record<RfpSectionId, SectionReading>;
  for (const id of RFP_SECTIONS) sections[id] = readSection(raw.sections[id], cite);

  const glossary: GlossaryTerm[] = [];
  for (const entry of raw.glossary) {
    const term = say(entry.term);
    const plainLanguage = say(entry.plain_language);
    if (term && plainLanguage) glossary.push({ term, plainLanguage, citations: cite(entry.evidence) });
  }

  const aiCitations = cite(raw.ai_use.evidence);
  const unconfirmed = raw.ai_use.stance !== 'not_stated' && aiCitations.length === 0;
  const aiUse: AiReading = {
    stance: unconfirmed ? 'not_stated' : raw.ai_use.stance,
    summary: unconfirmed ? '' : say(raw.ai_use.summary),
    citations: aiCitations,
    unconfirmed,
  };

  return {
    overview: say(raw.overview),
    sections,
    glossary,
    aiUse,
    uncertainties: readNotes(raw.uncertainties, cite),
    questions: readNotes(raw.questions, cite),
    droppedQuotes,
  };
}

// ─────────────────────────────── putting the answers together ───────────────────────────────

const STRENGTH: Record<Coverage, number> = { missing: 0, unclear: 1, stated: 2 };
const STRICTNESS: Record<AiUseStance, number> = {
  not_stated: 0,
  permitted: 1,
  permitted_with_disclosure: 2,
  restricted: 3,
  prohibited: 4,
};

// Wording that sets a limit. "Not prohibited" and "without restriction" say the
// opposite, so a negation just before the word is not a limit.
const NOT_NEGATED = '(?<!\\b(?:not|no|without|never|nor)\\s)';
const SETS_A_LIMIT = new RegExp(
  [
    '\\b(?:may|must|shall|should|can|will)\\s?not\\b',
    '\\bcannot\\b',
    `${NOT_NEGATED}\\b(?:only|solely|except|unless)\\b`,
    `${NOT_NEGATED}\\blimited to\\b`,
    `${NOT_NEGATED}\\b(?:prohibit|forbid|restrict|disallow)\\w*`,
    '\\b(?:original|own) (?:work|words|writing)\\b',
  ].join('|'),
  'iu',
);

const unique = (values: string[]): string[] => [...new Set(values)];
const sum = <T>(values: T[], of: (value: T) => number): number => values.reduce((total, value) => total + of(value), 0);

function addCitations(into: Citation[], more: Citation[]): void {
  for (const citation of more) {
    const held = into.some(
      (known) => known.documentId === citation.documentId && known.blockId === citation.blockId && known.quote === citation.quote,
    );
    if (!held) into.push(citation);
  }
}

/** The months named in a statement's dates that none of the quotations name. */
function unsupportedMonths(statement: string, quotes: string[]): number[] {
  const quoted = new Set(quotes.flatMap((quote) => datesIn(quote).flatMap((date) => date.months)));
  return datesIn(statement)
    .filter((date) => date.named)
    .flatMap((date) => date.months)
    .filter((month) => !quoted.has(month));
}

/**
 * True when the wording carries a figure or a date that the cited text does
 * not. Figures are compared by value; a month has to be one the cited text
 * names, which a comparison of figures alone would miss ("March 16" against
 * "April 16").
 */
function needsReview(text: string, citations: Citation[]): boolean {
  const quotes = citations.map((citation) => citation.quote);
  return unsupportedNumbers(text, quotes).length > 0 || unsupportedMonths(text, quotes).length > 0;
}

interface BuiltSection {
  section: RfpSection;
  dropped: number;
  flagged: number;
  cut: boolean;
}

function buildSection(id: RfpSectionId, readings: SectionReading[]): BuiltSection {
  // As reported: where the parts differ, the one that found the most decides.
  let coverage: Coverage = 'missing';
  for (const reading of readings) {
    if (STRENGTH[reading.coverage] > STRENGTH[coverage]) coverage = reading.coverage;
  }

  const items: RfpItem[] = [];
  const byText = new Map<string, RfpItem>();
  for (const kept of readings.flatMap((reading) => reading.items)) {
    const held = byText.get(kept.text.toLowerCase());
    if (held) {
      // The same point from two parts is one point, with the evidence of both and the more cautious label.
      addCitations(held.citations, kept.citations);
      if (kept.basis === 'interpretation') held.basis = 'interpretation';
      continue;
    }
    const item: RfpItem = { id: '', text: kept.text, basis: kept.basis, citations: [...kept.citations], needsReview: false };
    byText.set(kept.text.toLowerCase(), item);
    items.push(item);
  }
  const shown = items.slice(0, MAX_ITEMS_PER_SECTION);
  shown.forEach((item, index) => {
    item.id = `${id}-${index + 1}`;
    item.needsReview = needsReview(item.text, item.citations);
  });

  const droppedExplicit = sum(readings, (reading) => reading.droppedExplicit);
  const added: string[] = [];
  if (coverage === 'unclear' && readings.some((reading) => reading.contradicted)) added.push(CONTRADICTED);
  if (droppedExplicit > 0) {
    // Something the assistant called the document's own statement could not be found in it.
    coverage = 'unclear';
    added.push(leftOutHere(droppedExplicit));
  } else if (coverage === 'stated' && shown.length === 0) {
    coverage = 'unclear';
    added.push(NOTHING_CONFIRMED);
  }

  let note = '';
  if (coverage === 'missing') {
    // One part's note speaks for that part only, so it is used when the document was read whole.
    note = (readings.length === 1 ? readings[0]?.note : '') || NOT_COVERED;
  } else if (coverage === 'unclear') {
    const said = readings.filter((reading) => reading.coverage === 'unclear' && !reading.contradicted).map((reading) => reading.note);
    note = [...unique(said.filter(Boolean)), ...added].join(' ') || NOT_ENOUGH_DETAIL;
  }

  return {
    section: { id, items: shown, coverage, note },
    dropped: droppedExplicit + sum(readings, (reading) => reading.droppedInterpretation),
    flagged: shown.filter((item) => item.needsReview).length,
    cut: items.length > shown.length,
  };
}

function buildGlossary(readings: Reading[]): { glossary: GlossaryTerm[]; cut: boolean } {
  const terms = new Map<string, GlossaryTerm>();
  for (const entry of readings.flatMap((reading) => reading.glossary)) {
    const held = terms.get(entry.term.toLowerCase());
    // The first explanation of a term stands; later parts can only add where the document defines it.
    if (held) addCitations(held.citations, entry.citations);
    else terms.set(entry.term.toLowerCase(), { ...entry, citations: [...entry.citations] });
  }
  const all = [...terms.values()];
  return { glossary: all.slice(0, MAX_GLOSSARY_TERMS), cut: all.length > MAX_GLOSSARY_TERMS };
}

function buildNotes(prefix: string, notes: NoteReading[]): { notes: AnalysisNote[]; cut: boolean } {
  const byText = new Map<string, AnalysisNote>();
  for (const note of notes) {
    const held = byText.get(note.text.toLowerCase());
    if (held) addCitations(held.citations, note.citations);
    else byText.set(note.text.toLowerCase(), { id: '', text: note.text, citations: [...note.citations] });
  }
  const all = [...byText.values()];
  const shown = all.slice(0, MAX_NOTES);
  shown.forEach((note, index) => {
    note.id = `${prefix}-${index + 1}`;
  });
  return { notes: shown, cut: all.length > shown.length };
}

function buildAiUse(readings: AiReading[], mentions: LiteralFinding[]): AiUsePolicy {
  const confirmed = readings.filter((reading) => reading.stance !== 'not_stated');
  const citations: Citation[] = [];

  if (confirmed.length === 0) {
    const unconfirmed = readings.some((reading) => reading.unconfirmed);
    let summary = AI_UNCONFIRMED;
    if (!unconfirmed) {
      // The assistant's own words are kept when it read the whole document; a part can only speak for itself.
      const [only] = readings;
      summary = (readings.length === 1 && only ? only.summary : '') || AI_NOTHING_FOUND;
      for (const reading of readings) addCitations(citations, reading.citations);
    }
    if (mentions.length > 0) {
      // The assistant may have missed them, so the passages are put where the reader will look.
      summary = `${summary} ${AI_SEE_MATCHES}`;
      addCitations(
        citations,
        mentions.map((finding) => finding.citation),
      );
    }
    return { stance: 'not_stated', summary, citations };
  }

  // Where parts of the document differ, the strictest position is the one to plan around.
  let stance: AiUseStance = 'not_stated';
  for (const reading of confirmed) {
    if (STRICTNESS[reading.stance] > STRICTNESS[stance]) stance = reading.stance;
    addCitations(citations, reading.citations);
  }
  let summary = unique(confirmed.map((reading) => reading.summary).filter(Boolean)).join(' ');
  if (stance !== 'not_stated' && !summary) summary = AI_DEFAULT_SUMMARY[stance];
  if ((stance === 'permitted' || stance === 'permitted_with_disclosure') && citations.some((citation) => SETS_A_LIMIT.test(citation.quote))) {
    stance = 'restricted';
    summary = `${summary} ${AI_TIGHTENED}`;
  }
  // What could not be confirmed may have been the stricter rule, so the reader is told it was there.
  if (readings.some((reading) => reading.unconfirmed)) summary = `${summary} ${AI_ALSO_UNCONFIRMED}`;
  return { stance, summary, citations };
}

// ─────────────────────────────── the pipeline ───────────────────────────────

type Shell = Pick<RfpAnalysis, 'schemaVersion' | 'rfpId' | 'organizationId' | 'createdAt' | 'literalFindings'>;

function stopIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new FundingError('CANCELLED', 'Cancelled.');
}

/** Lets the app answer its window between two stretches of work. */
const breathe = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function matchLimitNote(findings: LiteralFinding[]): string[] {
  const counts = new Map<string, number>();
  for (const finding of findings) counts.set(finding.kind, (counts.get(finding.kind) ?? 0) + 1);
  return [...counts.values()].some((count) => count >= MAX_FINDINGS_PER_KIND)
    ? [`Only the first ${MAX_FINDINGS_PER_KIND} text matches of each kind are listed.`]
    : [];
}

/** The analysis when nothing was summarized: the literal findings, and a plain statement that this is all there is. */
function textMatchesOnly(shell: Shell, limitations: string[]): RfpAnalysis {
  return {
    ...shell,
    method: 'text_matches',
    overview: '',
    sections: RFP_SECTIONS.map((id) => ({ id, items: [], coverage: 'unclear', note: NEEDS_ASSISTANT })),
    glossary: [],
    aiUse: {
      stance: 'not_stated',
      summary: AI_NEEDS_ASSISTANT,
      citations: shell.literalFindings.filter((finding) => finding.kind === 'ai_tools').map((finding) => finding.citation),
    },
    uncertainties: [],
    questions: [],
    limitations: [...limitations, ...matchLimitNote(shell.literalFindings)],
  };
}

interface Division {
  /** The document in reading order, in pieces that each fit one question. */
  parts: ExtractedBlock[][];
  /** Passages that are longer than one question can carry. A passage is never cut, so these are not sent. */
  tooLong: ExtractedBlock[];
}

function divide(blocks: ExtractedBlock[], limit: number): Division {
  const tooLong = blocks.filter((block) => block.text.length > limit);
  const readable = blocks.filter((block) => block.text.length <= limit);
  const total = sum(readable, (block) => block.text.length);
  if (total <= limit) return { parts: readable.length > 0 ? [readable] : [], tooLong };

  // Parts of even size rather than full ones and a remnant, so each question has a similar amount to read.
  const target = Math.ceil(total / Math.ceil(total / limit));
  const parts: ExtractedBlock[][] = [];
  let current: ExtractedBlock[] = [];
  let size = 0;
  let hasBody = false;
  for (const block of readable) {
    if (current.length > 0 && size + block.text.length > (hasBody ? target : limit)) {
      // A heading at the very end of a part belongs with what follows it.
      const carried: ExtractedBlock[] = [];
      for (let last = current.at(-1); hasBody && last?.kind === 'heading'; last = current.at(-1)) {
        carried.unshift(last);
        current.pop();
      }
      parts.push(current);
      current = carried;
      size = sum(carried, (held) => held.text.length);
      hasBody = false;
    }
    current.push(block);
    size += block.text.length;
    if (block.kind !== 'heading') hasBody = true;
  }
  if (current.length > 0) parts.push(current);
  return { parts, tooLong };
}

function where(blocks: ExtractedBlock[]): string {
  const pages = unique(blocks.map((block) => (block.page === null ? '' : String(block.page))).filter(Boolean));
  return pages.length > 0 ? ` (${plural(pages.length, 'page', 'pages')} ${pages.slice(0, 12).join(', ')})` : '';
}

export interface AnalysisOptions {
  /**
   * How much document text one question to the assistant carries. Lowered in
   * tests to reach the split without a very long document.
   */
  maxCharacters?: number;
}

export function createAnalyzeRfp(options: AnalysisOptions = {}): AnalyzeRfp {
  const limit = Math.max(1, Math.floor(options.maxCharacters ?? MAX_DOCUMENT_CHARACTERS));

  return async (input) => {
    const { document, complete, signal, progress } = input;
    stopIfCancelled(signal);
    if (document.blocks.length === 0) throw new FundingError('INVALID_INPUT', NOTHING_TO_READ);

    progress('Looking for dates, amounts and requirements in the text', 5);
    const shell: Shell = {
      schemaVersion: 1,
      rfpId: document.id,
      organizationId: input.organizationId,
      createdAt: input.now,
      literalFindings: findLiterals(document),
    };
    if (!complete) return textMatchesOnly(shell, [TEXT_MATCHES_ONLY]);

    const { parts, tooLong } = divide(document.blocks, limit);
    if (parts.length === 0) return textMatchesOnly(shell, [TOO_LONG_FOR_ASSISTANT]);

    const readings: Reading[] = [];
    for (const [index, blocks] of parts.entries()) {
      await breathe();
      stopIfCancelled(signal);
      progress(
        parts.length === 1
          ? 'The assistant is reading the funding document'
          : `The assistant is reading part ${index + 1} of ${parts.length} of the funding document`,
        10 + (80 * index) / parts.length,
      );
      const rendered = renderDocuments([{ ...document, blocks }], PREFIX);
      const answer = await complete({
        system: ANALYSIS_SYSTEM,
        // The only place the document's text goes.
        documents: rendered.text,
        task: analysisTask(index + 1, parts.length),
        schema: RFP_ANALYSIS_SCHEMA,
        maxTokens: ANSWER_TOKENS,
        signal,
      });
      stopIfCancelled(signal);
      progress('Checking each quotation against the document', 10 + (80 * (index + 0.9)) / parts.length);
      readings.push(readAnswer(answer, rendered));
    }
    await breathe();
    stopIfCancelled(signal);

    const built = RFP_SECTIONS.map((id) =>
      buildSection(
        id,
        readings.map((reading) => reading.sections[id]),
      ),
    );
    const { glossary, cut: glossaryCut } = buildGlossary(readings);
    const uncertainties = buildNotes(
      'uncertainty',
      readings.flatMap((reading) => reading.uncertainties),
    );
    const questions = buildNotes(
      'question',
      readings.flatMap((reading) => reading.questions),
    );

    // The overview has no citation of its own, so a figure in it has to be one the document contains.
    let overview = readings.map((reading) => reading.overview).find(Boolean) ?? '';
    const invented =
      numbersIn(overview).length > 0 &&
      unsupportedNumbers(
        overview,
        document.blocks.map((block) => block.text),
      ).length > 0;
    if (invented) overview = '';

    const droppedPoints = sum(built, (section) => section.dropped);
    const droppedQuotes = sum(readings, (reading) => reading.droppedQuotes);
    const flagged = sum(built, (section) => section.flagged);
    const cut = built.some((section) => section.cut) || glossaryCut || uncertainties.cut || questions.cut;

    const limitations: string[] = [];
    if (parts.length > 1) {
      limitations.push(
        `This document was too long to read in one pass, so the assistant read it in ${parts.length} parts. A point that depends on passages far apart may have been missed.`,
      );
    }
    if (tooLong.length > 0) {
      limitations.push(
        plural(
          tooLong.length,
          'One passage was too long to send to the assistant and was not summarized',
          '# passages were too long to send to the assistant and were not summarized',
        ) + `${where(tooLong)}. Dates and amounts in ${plural(tooLong.length, 'it', 'them')} are still listed under the text matches.`,
      );
    }
    if (droppedPoints > 0) {
      limitations.push(
        plural(
          droppedPoints,
          'One point from the assistant was left out because it came with no evidence that could be found in the document.',
          '# points from the assistant were left out because they came with no evidence that could be found in the document.',
        ),
      );
    }
    if (droppedQuotes > 0) {
      limitations.push(
        plural(
          droppedQuotes,
          'One quotation the assistant gave could not be found in the document and is not shown.',
          '# quotations the assistant gave could not be found in the document and are not shown.',
        ),
      );
    }
    if (flagged > 0) {
      limitations.push(
        plural(
          flagged,
          'One point states a figure or a date that is not in the passage cited for it. It is marked for review.',
          '# points state a figure or a date that is not in the passages cited for them. They are marked for review.',
        ),
      );
    }
    if (invented) {
      limitations.push("The assistant's overview stated a figure that is not in the document, so the overview is not shown.");
    } else if (!overview) {
      limitations.push('The assistant did not write an overview for this document.');
    }
    if (cut) limitations.push('The assistant returned more entries than can be shown, so the longest lists were cut short.');
    limitations.push(...matchLimitNote(shell.literalFindings));

    return {
      ...shell,
      method: 'assistant',
      overview,
      sections: built.map((section) => section.section),
      glossary,
      aiUse: buildAiUse(
        readings.map((reading) => reading.aiUse),
        shell.literalFindings.filter((finding) => finding.kind === 'ai_tools'),
      ),
      uncertainties: uncertainties.notes,
      questions: questions.notes,
      limitations,
    };
  };
}

/** Analyzes a funding document, with the assistant when one is connected and by text matches alone when not. */
export const analyzeRfp: AnalyzeRfp = createAnalyzeRfp();
