// How each state in the funding contract is shown: the words, the tone and the
// icon. A state is never told apart by colour alone, so every entry has a label
// that says it and an icon whose shape goes with it.
//
// The label of a listing's status comes from the shared contract. The contract
// has no display labels for the other states, so they are written here, once.

import {
  OPPORTUNITY_STATUS_LABELS,
  type AnalysisStatus,
  type ClaimStatus,
  type JobProgress,
  type OpportunityStatus,
  type ProcessingStatus,
} from '../../../shared/funding.js';
import type { BadgeTone } from './Badge.js';
import type { IconName } from './icons.js';

export interface StatusPresentation {
  label: string;
  tone: BadgeTone;
  icon: IconName;
}

/** A funding listing: active, expired or unverified. */
export const OPPORTUNITY_STATUS: Record<OpportunityStatus, StatusPresentation> = {
  active: { label: OPPORTUNITY_STATUS_LABELS.active, tone: 'success', icon: 'check-circle' },
  expired: { label: OPPORTUNITY_STATUS_LABELS.expired, tone: 'neutral', icon: 'clock' },
  unverified: { label: OPPORTUNITY_STATUS_LABELS.unverified, tone: 'caution', icon: 'question' },
};

/** An uploaded document, from waiting to be read to ready or failed. */
export const DOCUMENT_STATUS: Record<ProcessingStatus, StatusPresentation> = {
  queued: { label: 'Waiting', tone: 'neutral', icon: 'clock' },
  extracting: { label: 'Reading', tone: 'info', icon: 'progress' },
  indexing: { label: 'Indexing', tone: 'info', icon: 'list' },
  ready: { label: 'Ready', tone: 'success', icon: 'check-circle' },
  failed: { label: 'Failed', tone: 'danger', icon: 'alert' },
};

/** A statement in the organization's profile. */
export const CLAIM_STATUS: Record<ClaimStatus, StatusPresentation> = {
  proposed: { label: 'Proposed', tone: 'info', icon: 'circle-dashed' },
  approved: { label: 'Approved', tone: 'success', icon: 'check-circle' },
  needs_review: { label: 'Needs review', tone: 'caution', icon: 'alert' },
  rejected: { label: 'Rejected', tone: 'neutral', icon: 'x-circle' },
};

/** An analysis or alignment assessment of a funding document. */
export const ANALYSIS_STATUS: Record<AnalysisStatus['state'], StatusPresentation> = {
  none: { label: 'Not started', tone: 'neutral', icon: 'circle' },
  running: { label: 'In progress', tone: 'info', icon: 'progress' },
  ready: { label: 'Ready', tone: 'success', icon: 'check-circle' },
  failed: { label: 'Failed', tone: 'danger', icon: 'alert' },
};

/** A long-running job. */
export const JOB_STATUS: Record<JobProgress['state'], StatusPresentation> = {
  running: { label: 'In progress', tone: 'info', icon: 'progress' },
  completed: { label: 'Done', tone: 'success', icon: 'check-circle' },
  failed: { label: 'Failed', tone: 'danger', icon: 'alert' },
  cancelled: { label: 'Stopped', tone: 'neutral', icon: 'x-circle' },
};

export const STATUS_TABLES = {
  opportunity: OPPORTUNITY_STATUS,
  document: DOCUMENT_STATUS,
  claim: CLAIM_STATUS,
  analysis: ANALYSIS_STATUS,
  job: JOB_STATUS,
} as const;

export type StatusKind = keyof typeof STATUS_TABLES;
