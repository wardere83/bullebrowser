// The shape of the assistant's answer when it analyzes a funding document.
//
// The shape is written twice. The JSON Schema is sent with the question and is
// enforced while the answer is being written; the zod schema checks the answer
// again on the device and holds the limits the first cannot express. Neither
// holds anything about a document or an organization.
//
// Nothing here decides whether an answer is true. That happens afterwards, in
// analysis.ts, where every quotation is looked up in the text the app read.

import { z } from 'zod';
import {
  RFP_SECTIONS,
  RFP_SECTION_LABELS,
  type AiUseStance,
  type RfpSection,
  type RfpSectionId,
  type StatementBasis,
} from '../../shared/funding.js';
import type { OutputSchema } from '../funding/pipeline.js';
import type { RawEvidence } from '../funding/prompting.js';

export type Coverage = RfpSection['coverage'];

export interface RawItem {
  text: string;
  basis: StatementBasis;
  evidence: RawEvidence[];
}

export interface RawSection {
  coverage: Coverage;
  note: string;
  items: RawItem[];
}

export interface RawGlossaryTerm {
  term: string;
  plain_language: string;
  evidence: RawEvidence[];
}

export interface RawNote {
  text: string;
  evidence: RawEvidence[];
}

export interface RawAiUse {
  stance: AiUseStance;
  summary: string;
  evidence: RawEvidence[];
}

/** One answer: the whole document, or one part of a document read in parts. */
export interface RawRfpAnalysis {
  overview: string;
  /** Every section, keyed by its id, so that none can be left out. */
  sections: Record<RfpSectionId, RawSection>;
  glossary: RawGlossaryTerm[];
  ai_use: RawAiUse;
  uncertainties: RawNote[];
  questions: RawNote[];
}

const COVERAGE = ['stated', 'unclear', 'missing'] as const satisfies readonly Coverage[];
const BASIS = ['explicit', 'interpretation'] as const satisfies readonly StatementBasis[];
const STANCES = [
  'not_stated',
  'permitted',
  'permitted_with_disclosure',
  'restricted',
  'prohibited',
] as const satisfies readonly AiUseStance[];

// Far more room than a careful answer needs. A text beyond these is not an
// answer to the question that was asked, and the assistant is asked again.
const MAX_SENTENCES = 2_000;
const MAX_OVERVIEW = 3_000;
const MAX_TERM = 200;
const MAX_QUOTE = 6_000;
const MAX_PASSAGE_ID = 80;

// ───────────────────────────── as sent to the assistant ─────────────────────────────

type Json = Record<string, unknown>;

const text = (description: string): Json => ({ type: 'string', description });
const choice = (values: readonly string[], description: string): Json => ({ type: 'string', enum: [...values], description });
const listOf = (items: Json, description: string): Json => ({ type: 'array', description, items });
/** A closed object: every property is required and nothing else is allowed. */
const closed = (properties: Record<string, Json>, description?: string): Json => ({
  type: 'object',
  ...(description ? { description } : {}),
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

const evidenceJson = listOf(
  closed({
    block_id: text('The id of one passage, copied exactly as shown, for example F1:b0007.'),
    quote: text('Words copied exactly from that passage, without its id or its page note.'),
  }),
  'The passages that support this, each with a quotation.',
);

const sectionJson = (label: string): Json =>
  closed(
    {
      coverage: choice(COVERAGE, 'Whether the document covers this topic.'),
      note: text('What is unclear or missing, in one or two sentences. Empty when coverage is "stated".'),
      items: listOf(
        closed({
          text: text('One point, in one or two plain sentences.'),
          basis: choice(BASIS, '"explicit" when the document states it; "interpretation" when it is your reading.'),
          evidence: evidenceJson,
        }),
        'The separate points the document makes on this topic, in its own order.',
      ),
    },
    label,
  );

const noteJson = (description: string): Json =>
  listOf(closed({ text: text('One point, in one or two plain sentences.'), evidence: evidenceJson }), description);

const json = closed({
  overview: text('Two or three plain sentences on what the funder is investing in, or an empty string.'),
  sections: closed(Object.fromEntries(RFP_SECTIONS.map((id) => [id, sectionJson(RFP_SECTION_LABELS[id])]))),
  glossary: listOf(
    closed({
      term: text('The funding term.'),
      plain_language: text('What the term means, in one or two plain sentences.'),
      evidence: evidenceJson,
    }),
    'Each funding term that was explained.',
  ),
  ai_use: closed(
    {
      stance: choice(STANCES, 'The position the document takes.'),
      summary: text('One or two plain sentences on what the document says.'),
      evidence: evidenceJson,
    },
    'What the document says about using AI tools to prepare an application.',
  ),
  uncertainties: noteJson('Things the document leaves open that an applicant should settle.'),
  questions: noteJson('Questions to ask the funder, or to answer internally, before applying.'),
});

// ───────────────────────────── as checked on the device ─────────────────────────────

const sentences = z.string().max(MAX_SENTENCES);
const evidenceZod = z.array(z.object({ block_id: z.string().max(MAX_PASSAGE_ID), quote: z.string().max(MAX_QUOTE) }));
const sectionZod = z.object({
  coverage: z.enum(COVERAGE),
  note: sentences,
  items: z.array(z.object({ text: sentences, basis: z.enum(BASIS), evidence: evidenceZod })),
});
const noteZod = z.array(z.object({ text: sentences, evidence: evidenceZod }));

const zod: z.ZodType<RawRfpAnalysis> = z.object({
  overview: z.string().max(MAX_OVERVIEW),
  sections: z.object(Object.fromEntries(RFP_SECTIONS.map((id) => [id, sectionZod])) as Record<RfpSectionId, typeof sectionZod>),
  glossary: z.array(z.object({ term: z.string().max(MAX_TERM), plain_language: sentences, evidence: evidenceZod })),
  ai_use: z.object({ stance: z.enum(STANCES), summary: sentences, evidence: evidenceZod }),
  uncertainties: noteZod,
  questions: noteZod,
});

/**
 * The answer to "analyze this funding document". Sections are properties of
 * one object rather than a list, so the wire format itself guarantees that all
 * thirteen are present and none appears twice.
 */
export const RFP_ANALYSIS_SCHEMA: OutputSchema<RawRfpAnalysis> = { name: 'rfp_analysis', json, zod };
