// How an entry in an organization's activity record reads on screen. The shared
// contract names the actions but has no display labels for them, so they are
// written here, once.

import type { AnalysisStatus, OrgActivity } from '../../shared/funding.js';

export const ACTIVITY_LABELS: Record<OrgActivity['action'], string> = {
  organization_created: 'Organization created',
  organization_updated: 'Organization details changed',
  document_added: 'Document added',
  document_replaced: 'Document replaced',
  document_deleted: 'Document deleted',
  profile_extracted: 'Profile proposed from documents',
  claims_approved: 'Profile statements approved',
  claims_rejected: 'Profile statements rejected',
  claim_edited: 'Profile statement edited',
  claim_added: 'Profile statement added',
  claim_deleted: 'Profile statement deleted',
  conflict_resolved: 'Conflict between documents resolved',
  rfp_added: 'Funding document added',
  rfp_deleted: 'Funding document deleted',
  rfp_analyzed: 'Funding document analyzed',
  alignment_assessed: 'Alignment assessed',
  guide_started: 'Proposal guide started',
  opportunity_saved: 'Opportunity saved',
  opportunity_removed: 'Saved opportunity removed',
  consent_recorded: 'Consent recorded',
};

/** An activity entry as one line: what happened, then what it happened to. */
export function describeActivity(entry: Pick<OrgActivity, 'action' | 'detail'>): string {
  const label = ACTIVITY_LABELS[entry.action] ?? 'Activity recorded';
  const detail = entry.detail.trim();
  return detail ? `${label}: ${detail}` : label;
}

type AnalysisState = AnalysisStatus['state'];

/** Where the analysis of a funding document has got to, in words. */
export const ANALYSIS_STATE_LABELS: Record<AnalysisState, string> = {
  none: 'Not analyzed yet',
  running: 'Analysis in progress',
  ready: 'Analysis ready',
  failed: 'Analysis failed',
};

/** Where the alignment assessment of a funding document has got to, in words. */
export const ALIGNMENT_STATE_LABELS: Record<AnalysisState, string> = {
  none: 'Alignment not assessed yet',
  running: 'Alignment in progress',
  ready: 'Alignment ready',
  failed: 'Alignment failed',
};
