// The shapes an assistant answers in when what a funder asks for is compared
// with what an organization has written down.
//
// The comparison is asked in two steps. First the requirements are taken one
// at a time, a few to a request, and each answer is a finding with the
// funder's wording and the organization's evidence. Then, once every quotation
// has been checked, a short overview is asked for against the findings that
// stood. The overview is the one place a reader could mistake an opinion for a
// result, so its summary is refused when it states eligibility as settled,
// predicts an award, or names a figure the checked evidence does not contain.

import { z } from 'zod';
import { RFP_SECTIONS, type RfpSectionId } from '../../shared/funding.js';
import type { OutputSchema } from '../funding/pipeline.js';
import type { RawEvidence } from '../funding/prompting.js';
import {
  EVIDENCE_JSON,
  STATEMENT_JSON,
  evidenceList,
  statementOf,
  type RawStatement,
} from '../guide/material.js';
import { unsupportedNumbers } from '../knowledge/quote-verifier.js';

/** The findings an assistant may give. "unassessed" is never one of them: it means no assistant was asked. */
export const ASSESSED_FINDINGS = ['documented', 'partial', 'gap', 'not_documented'] as const;
export type AssessedFinding = (typeof ASSESSED_FINDINGS)[number];

/** The most each piece of an answer may hold. A fact is one sentence; nothing here has room for a paragraph. */
export const ALIGNMENT_LIMITS = {
  topic: 120,
  fact: 300,
  recommendation: 500,
  summary: 700,
  note: 400,
} as const;

export interface AssessedItem {
  /** The id of the requirement, as the list the assistant was shown gives it. */
  requirement_id: string;
  topic: string;
  section: RfpSectionId;
  finding: AssessedFinding;
  /** Where the funding document states the requirement. */
  requirement_evidence: RawEvidence[];
  /** What the organization's own material says about it. */
  facts: RawStatement[];
  recommendation: string;
}

export interface AssessmentReply {
  items: AssessedItem[];
}

export interface OverviewReply {
  summary: string;
  gaps: RawStatement[];
  uncertainties: RawStatement[];
  questions: RawStatement[];
}

const assessmentReply: z.ZodType<AssessmentReply> = z.object({
  items: z.array(
    z.object({
      requirement_id: z.string(),
      topic: z.string().min(1).max(ALIGNMENT_LIMITS.topic),
      section: z.enum(RFP_SECTIONS),
      finding: z.enum(ASSESSED_FINDINGS),
      requirement_evidence: evidenceList,
      facts: z.array(statementOf(ALIGNMENT_LIMITS.fact)),
      recommendation: z.string().max(ALIGNMENT_LIMITS.recommendation),
    }),
  ),
});

export const assessmentSchema: OutputSchema<AssessmentReply> = {
  name: 'alignment_findings',
  json: {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'requirement_id',
            'topic',
            'section',
            'finding',
            'requirement_evidence',
            'facts',
            'recommendation',
          ],
          properties: {
            requirement_id: { type: 'string' },
            topic: { type: 'string' },
            section: { type: 'string', enum: [...RFP_SECTIONS] },
            finding: { type: 'string', enum: [...ASSESSED_FINDINGS] },
            requirement_evidence: EVIDENCE_JSON,
            facts: { type: 'array', items: STATEMENT_JSON },
            recommendation: { type: 'string' },
          },
        },
      },
    },
  },
  zod: assessmentReply,
};

// Whether an applicant is eligible, and whether it will be funded, are the
// funder's decisions. These are the wordings that state either as settled.
const SETTLED_PHRASES = [
  'is eligible',
  'are eligible',
  'is not eligible',
  'are not eligible',
  'is ineligible',
  'are ineligible',
  "isn't eligible",
  "aren't eligible",
  'will be funded',
  'will not be funded',
  "won't be funded",
  'guaranteed',
];

const PERCENT = '\\d+(?:\\.\\d+)?\\s?(?:%|percent\\b|per\\s?cent\\b)';
const CHANCE = '(?:chances?|likelihood|probability|odds)';
// "a 70% chance", "70 percent likely", "the odds of an award are about 60 percent".
const PERCENT_CHANCE_RE = new RegExp(
  `${PERCENT}\\s+likely\\b|${PERCENT}(?:\\W+\\w+){0,3}?\\W+${CHANCE}\\b|\\b${CHANCE}\\b(?:\\W+\\w+){0,6}?\\W+${PERCENT}`,
  'u',
);

/**
 * What is wrong with a summary, one line for each problem, or nothing when it
 * may be shown. `verified` is the wording the summary may take figures from:
 * the quotations that were checked and the counts the request gave.
 */
export function summaryProblems(summary: string, verified: string[]): string[] {
  const plain = summary
    .normalize('NFKC')
    .replace(/[‘’]/gu, "'")
    .replace(/\s+/gu, ' ')
    .toLowerCase();
  const problems: string[] = [];

  const settled = SETTLED_PHRASES.filter((phrase) =>
    new RegExp(`\\b${phrase.replace(/ /gu, '\\s+')}\\b`, 'u').test(plain),
  );
  if (settled.length > 0) {
    problems.push(
      `summary: says ${settled.map((phrase) => `"${phrase}"`).join(', ')}. Do not present eligibility or an award as decided. The funder decides both. Say what the material shows and what remains to be checked.`,
    );
  }
  if (PERCENT_CHANCE_RE.test(plain)) {
    problems.push('summary: gives a percentage chance. Do not estimate the chance of an award.');
  }
  const figures = unsupportedNumbers(summary, verified);
  if (figures.length > 0) {
    problems.push(
      `summary: states ${figures.join(', ')}, which is in none of the verified findings. Leave out any figure that is not in them.`,
    );
  }
  return problems;
}

const overviewReply: z.ZodType<OverviewReply> = z.object({
  summary: z.string().min(1).max(ALIGNMENT_LIMITS.summary),
  gaps: z.array(statementOf(ALIGNMENT_LIMITS.note)),
  uncertainties: z.array(statementOf(ALIGNMENT_LIMITS.note)),
  questions: z.array(statementOf(ALIGNMENT_LIMITS.note)),
});

/** The overview, checked against the wording that was verified for this comparison. */
export function overviewSchema(verified: string[]): OutputSchema<OverviewReply> {
  return {
    name: 'alignment_overview',
    json: {
      type: 'object',
      additionalProperties: false,
      required: ['summary', 'gaps', 'uncertainties', 'questions'],
      properties: {
        summary: { type: 'string' },
        gaps: { type: 'array', items: STATEMENT_JSON },
        uncertainties: { type: 'array', items: STATEMENT_JSON },
        questions: { type: 'array', items: STATEMENT_JSON },
      },
    },
    zod: overviewReply,
    check: (value) => summaryProblems(value.summary, verified),
  };
}
