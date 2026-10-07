// The shape an assistant answers in when it tailors the outline of a guide.
//
// The reply has one property for each part of the standard outline, all of
// them required, so the structure of a guide cannot be changed, reordered or
// cut short by an answer. Inside a part there is room for a heading, one
// sentence of purpose, pointers to the funder's criteria, documented strengths
// with their quotations, questions and short notes. There is no property that
// could hold a paragraph, and the lengths below are what keep it that way: an
// answer that exceeds one is sent back once and then refused.

import { z } from 'zod';
import type { OutputSchema } from '../funding/pipeline.js';
import type { RawEvidence } from '../funding/prompting.js';
import { EVIDENCE_JSON, STATEMENT_JSON, evidenceList, statementOf, type RawStatement } from './material.js';
import { OUTLINE_LIMITS, STANDARD_SECTION_IDS, type StandardSectionId } from './standard-outline.js';

/** A strength is one fact in one sentence, not a description of the organization. */
export const STRENGTH_MAX_CHARACTERS = 300;

export interface SectionReply {
  heading: string;
  purpose: string;
  /** Requirements from the list the assistant was shown, each with the funder's wording for it. */
  criteria: { requirement_id: string; evidence: RawEvidence[] }[];
  strengths: RawStatement[];
  questions: { text: string; why: string }[];
  evidence_to_gather: string[];
}

export type OutlineReply = Record<StandardSectionId, SectionReply>;

const sectionReply: z.ZodType<SectionReply> = z.object({
  heading: z.string().min(1).max(OUTLINE_LIMITS.heading),
  purpose: z.string().min(1).max(OUTLINE_LIMITS.purpose),
  criteria: z.array(z.object({ requirement_id: z.string(), evidence: evidenceList })),
  strengths: z.array(statementOf(STRENGTH_MAX_CHARACTERS)),
  questions: z.array(
    z.object({
      text: z
        .string()
        .min(1)
        .max(OUTLINE_LIMITS.question)
        .regex(/\?\s*$/u, 'A question must end with a question mark.'),
      why: z.string().min(1).max(OUTLINE_LIMITS.why),
    }),
  ),
  evidence_to_gather: z.array(z.string().min(1).max(OUTLINE_LIMITS.evidenceNote)),
});

const SECTION_JSON: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['heading', 'purpose', 'criteria', 'strengths', 'questions', 'evidence_to_gather'],
  properties: {
    heading: { type: 'string' },
    purpose: { type: 'string' },
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['requirement_id', 'evidence'],
        properties: { requirement_id: { type: 'string' }, evidence: EVIDENCE_JSON },
      },
    },
    strengths: { type: 'array', items: STATEMENT_JSON },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'why'],
        properties: { text: { type: 'string' }, why: { type: 'string' } },
      },
    },
    evidence_to_gather: { type: 'array', items: { type: 'string' } },
  },
};

const forEachPart = <V>(value: V): Record<StandardSectionId, V> =>
  Object.fromEntries(STANDARD_SECTION_IDS.map((id) => [id, value])) as Record<StandardSectionId, V>;

export const outlineSchema: OutputSchema<OutlineReply> = {
  name: 'proposal_guide_outline',
  json: {
    type: 'object',
    additionalProperties: false,
    required: [...STANDARD_SECTION_IDS],
    properties: forEachPart(SECTION_JSON),
  },
  zod: z.object(forEachPart(sectionReply)),
};
