// The shape an assistant answers in when it looks at a draft the user wrote.
//
// An answer is a list of observations and nothing else. Each one names what
// kind of observation it is, says what was noticed and why it matters, points
// at the words in the draft it is about, and may quote the funding document or
// the organization's material. There is no property for a revised draft, a
// replacement sentence or a suggestion in the writer's voice, and the length
// of an observation leaves no room to hide one.

import { z } from 'zod';
import type { FeedbackKind } from '../../shared/funding.js';
import type { OutputSchema } from '../funding/pipeline.js';
import type { RawEvidence } from '../funding/prompting.js';
import { EVIDENCE_JSON, evidenceList } from './material.js';

export const FEEDBACK_KINDS = [
  'strength',
  'clarity',
  'evidence_gap',
  'unsupported_claim',
  'alignment',
  'requirement',
] as const satisfies readonly FeedbackKind[];

/** What is observed and why it matters. Long enough for that, too short for a rewrite. */
export const OBSERVATION_MAX_CHARACTERS = 400;

export interface ObservationReply {
  kind: FeedbackKind;
  text: string;
  /** Words copied from the draft, or empty when the observation is about something the draft leaves out. */
  draft_excerpt: string;
  evidence: RawEvidence[];
}

export interface FeedbackReply {
  observations: ObservationReply[];
}

const feedbackReply: z.ZodType<FeedbackReply> = z.object({
  observations: z.array(
    z.object({
      kind: z.enum(FEEDBACK_KINDS),
      text: z.string().min(1).max(OBSERVATION_MAX_CHARACTERS),
      draft_excerpt: z.string(),
      evidence: evidenceList,
    }),
  ),
});

export const feedbackSchema: OutputSchema<FeedbackReply> = {
  name: 'draft_observations',
  json: {
    type: 'object',
    additionalProperties: false,
    required: ['observations'],
    properties: {
      observations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'text', 'draft_excerpt', 'evidence'],
          properties: {
            kind: { type: 'string', enum: [...FEEDBACK_KINDS] },
            text: { type: 'string' },
            draft_excerpt: { type: 'string' },
            evidence: EVIDENCE_JSON,
          },
        },
      },
    },
  },
  zod: feedbackReply,
};
