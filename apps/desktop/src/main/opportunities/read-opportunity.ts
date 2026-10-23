// A listing as it arrives from the interface, checked before it is kept.
//
// The interface only ever holds listings the app gave it, but what crosses
// back is still input. Saving a listing re-reads it from its source, and this
// check bounds what is stored when the source cannot be reached: plain text of
// a sensible length, a web address for the official link, and values the
// contract defines for everything that is a choice.

import { z } from 'zod';
import {
  APPLICANT_TYPE_LABELS,
  FUNDING_CATEGORY_LABELS,
  GEO_LEVEL_LABELS,
  OPPORTUNITY_KIND_LABELS,
  OPPORTUNITY_STATUS_LABELS,
  PROFILE_FIELDS,
  type ApplicantType,
  type FundingCategory,
  type GeoLevel,
  type Opportunity,
  type OpportunityKind,
  type OpportunityStatus,
} from '../../shared/funding.js';
import { FundingError } from '../funding/errors.js';
import { assertOpportunityId } from './saved-store.js';

const keysOf = <T extends string>(labels: Record<T, string>) => Object.keys(labels) as [T, ...T[]];

const line = (max: number) => z.string().max(max);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();
const amount = z.number().finite().nonnegative().nullable();
const webAddress = z
  .string()
  .max(2_000)
  .refine((value) => {
    try {
      return ['http:', 'https:'].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  });

const opportunitySchema = z
  .object({
    id: z.string(),
    sourceId: line(40),
    sourceName: line(200),
    funder: line(500),
    kind: z.enum(keysOf<OpportunityKind>(OPPORTUNITY_KIND_LABELS)),
    level: z.enum(keysOf<GeoLevel>(GEO_LEVEL_LABELS)),
    country: line(2),
    region: line(80),
    jurisdiction: line(200),
    geographyNote: line(2_000),
    title: line(1_000),
    summary: line(20_000),
    number: line(200),
    applicantTypes: z.array(z.enum(keysOf<ApplicantType>(APPLICANT_TYPE_LABELS))).max(20),
    applicantNote: line(5_000),
    categories: z.array(z.enum(keysOf<FundingCategory>(FUNDING_CATEGORY_LABELS))).max(20),
    awardFloor: amount,
    awardCeiling: amount,
    totalFunding: amount,
    currency: line(3),
    openDate: isoDate,
    closeDate: isoDate,
    closeDateText: line(500),
    status: z.enum(keysOf<OpportunityStatus>(OPPORTUNITY_STATUS_LABELS)),
    statusReason: line(500),
    unverifiedReason: z
      .enum([
        'forecast',
        'no_deadline',
        'implausible_deadline',
        'detail_unavailable',
        'source_contradiction',
        'stale',
        'no_official_link',
      ])
      .nullable(),
    sourceStatus: line(200),
    officialUrl: webAddress,
    fetchedAt: z.number().finite().nonnegative(),
    match: z
      .object({
        score: z.number().min(0).max(100),
        sharedTerms: z.array(line(80)).max(200),
        fields: z.array(z.enum(PROFILE_FIELDS)).max(PROFILE_FIELDS.length),
      })
      .strict()
      .nullable(),
  })
  .strict();

/** The listing, or INVALID_INPUT when it is not one the app could have produced. */
export function readOpportunity(input: unknown): Opportunity {
  const parsed = opportunitySchema.safeParse(input);
  if (!parsed.success) throw new FundingError('INVALID_INPUT', 'That listing is not valid.');
  const opportunity: Opportunity = parsed.data;
  assertOpportunityId(opportunity.id);
  if (!opportunity.id.startsWith(`${opportunity.sourceId}:`)) {
    throw new FundingError('INVALID_INPUT', 'That listing is not valid.');
  }
  return opportunity;
}
