// The shape of the assistant's answer when it reads an organization's profile
// out of its documents.
//
// Three layers, as pipeline.ts asks for. The JSON schema is what the wire can
// enforce: closed objects, every property required, no nullable or union
// types. The zod schema adds what the wire cannot carry: lengths and ranges.
// The check holds the rules that need the request to judge, such as whether an
// id names an approved statement that was actually shown; a failure there asks
// the assistant to correct itself once.
//
// Evidence is deliberately not checked here. Whether a quotation is in the
// documents is decided afterwards, in profile-extraction.ts, and evidence that
// is not found is dropped rather than sent back to be reworded.

import { z } from 'zod';
import { PROFILE_FIELDS } from '../../shared/funding.js';
import type { OutputSchema } from '../funding/pipeline.js';

/**
 * How a statement stands to what a person has already approved.
 *
 * new             no approved statement says this.
 * same_as         an approved statement already says it.
 * updates         it would replace an approved statement of the same field.
 * conflicts_with  it disagrees with an approved statement.
 */
export const PROFILE_RELATIONS = ['new', 'same_as', 'updates', 'conflicts_with'] as const;

export type ProfileRelation = (typeof PROFILE_RELATIONS)[number];

/**
 * The most an answer may hold. The instructions ask for far less (a statement
 * is one fact in about 60 words); these only stop an answer that has run away.
 */
export const PROFILE_ANSWER_LIMITS = {
  statements: 400,
  statementCharacters: 600,
  evidencePerStatement: 12,
  quoteCharacters: 2_000,
  idCharacters: 40,
  conflicts: 100,
  statementsPerConflict: 20,
  gaps: PROFILE_FIELDS.length * 3,
  sentenceCharacters: 400,
} as const;

const field = z.enum(PROFILE_FIELDS);

const evidence = z
  .object({
    block_id: z.string().trim().min(1).max(PROFILE_ANSWER_LIMITS.idCharacters),
    quote: z.string().trim().min(1).max(PROFILE_ANSWER_LIMITS.quoteCharacters),
  })
  .strict();

const statement = z
  .object({
    position: z.number().int().min(0).max(PROFILE_ANSWER_LIMITS.statements),
    field,
    text: z.string().trim().min(1).max(PROFILE_ANSWER_LIMITS.statementCharacters),
    evidence: z.array(evidence).min(1).max(PROFILE_ANSWER_LIMITS.evidencePerStatement),
    relation: z.enum(PROFILE_RELATIONS),
    related_id: z.string().trim().max(PROFILE_ANSWER_LIMITS.idCharacters),
  })
  .strict();

const conflict = z
  .object({
    field,
    summary: z.string().trim().min(1).max(PROFILE_ANSWER_LIMITS.sentenceCharacters),
    statements: z
      .array(z.number().int().min(0).max(PROFILE_ANSWER_LIMITS.statements))
      .min(1)
      .max(PROFILE_ANSWER_LIMITS.statementsPerConflict),
  })
  .strict();

const gap = z
  .object({
    field,
    note: z.string().trim().min(1).max(PROFILE_ANSWER_LIMITS.sentenceCharacters),
  })
  .strict();

const answer = z
  .object({
    statements: z.array(statement).max(PROFILE_ANSWER_LIMITS.statements),
    conflicts: z.array(conflict).max(PROFILE_ANSWER_LIMITS.conflicts),
    gaps: z.array(gap).max(PROFILE_ANSWER_LIMITS.gaps),
  })
  .strict();

export type ProfileAnswer = z.infer<typeof answer>;
export type ProfileStatement = ProfileAnswer['statements'][number];

/** An object as the wire requires it: closed, with every property it has required. */
function closed(properties: Record<string, unknown>): Record<string, unknown> {
  return { type: 'object', additionalProperties: false, required: Object.keys(properties), properties };
}

const FIELD_ON_THE_WIRE = { type: 'string', enum: [...PROFILE_FIELDS] };

// Fixed for every organization: the provider keeps a copy of the schema, so
// nothing about one organization may be written into it.
const PROFILE_ANSWER_JSON = closed({
  statements: {
    type: 'array',
    items: closed({
      position: { type: 'integer' },
      field: FIELD_ON_THE_WIRE,
      text: { type: 'string' },
      evidence: {
        type: 'array',
        items: closed({ block_id: { type: 'string' }, quote: { type: 'string' } }),
      },
      relation: { type: 'string', enum: [...PROFILE_RELATIONS] },
      related_id: { type: 'string' },
    }),
  },
  conflicts: {
    type: 'array',
    items: closed({
      field: FIELD_ON_THE_WIRE,
      summary: { type: 'string' },
      statements: { type: 'array', items: { type: 'integer' } },
    }),
  },
  gaps: {
    type: 'array',
    items: closed({ field: FIELD_ON_THE_WIRE, note: { type: 'string' } }),
  },
});

/**
 * The problems in an answer that only the request can see, one line each with
 * the path first. An empty list means the answer can be used.
 *
 * - Every statement has a position of its own, so a conflict can name it.
 * - A relation other than "new" names an approved statement that was shown;
 *   "new" names none.
 * - A conflict names positions that statements actually have.
 */
export function checkProfileAnswer(value: ProfileAnswer, isApproved: (id: string) => boolean): string[] {
  const problems: string[] = [];
  const positions = new Set<number>();

  value.statements.forEach((entry, index) => {
    if (positions.has(entry.position)) {
      problems.push(`statements.${index}.position: ${entry.position} is already the position of another statement.`);
    }
    positions.add(entry.position);

    const at = `statements.${index}.related_id`;
    if (entry.relation === 'new') {
      if (entry.related_id) problems.push(`${at}: leave this empty when the relation is "new".`);
    } else if (!entry.related_id) {
      problems.push(`${at}: the relation "${entry.relation}" needs the id of an approved statement.`);
    } else if (!isApproved(entry.related_id)) {
      problems.push(`${at}: this is not the id of an approved statement.`);
    }
  });

  value.conflicts.forEach((entry, index) => {
    entry.statements.forEach((position, place) => {
      if (!positions.has(position)) {
        problems.push(`conflicts.${index}.statements.${place}: no statement has position ${position}.`);
      }
    });
  });

  return problems;
}

/**
 * The schema for one request. `isApproved` says whether an id names one of the
 * approved statements shown with that request.
 */
export function profileAnswerSchema(isApproved: (id: string) => boolean): OutputSchema<ProfileAnswer> {
  return {
    name: 'organization_profile',
    json: PROFILE_ANSWER_JSON,
    zod: answer,
    check: (value) => checkProfileAnswer(value, isApproved),
  };
}
