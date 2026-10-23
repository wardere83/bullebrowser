import type {
  AnalysisStatus,
  ClaimStatus,
  JobProgress,
  OpportunityStatus,
  ProcessingStatus,
} from '../../../shared/funding.js';
import { Badge } from './Badge.js';
import {
  ANALYSIS_STATUS,
  CLAIM_STATUS,
  DOCUMENT_STATUS,
  JOB_STATUS,
  OPPORTUNITY_STATUS,
  type StatusPresentation,
} from './status.js';
import { cx, text } from './styles.js';

export type StatusBadgeProps = (
  | { kind: 'opportunity'; status: OpportunityStatus }
  | { kind: 'document'; status: ProcessingStatus }
  | { kind: 'claim'; status: ClaimStatus }
  | { kind: 'analysis'; status: AnalysisStatus['state'] }
  | { kind: 'job'; status: JobProgress['state'] }
) & {
  /** Replaces the standard words, for example "Analysis ready". The icon and tone stay. */
  label?: string;
  /** A sentence explaining the status, shown beside the badge. Pass a listing's `statusReason` here. */
  reason?: string;
  className?: string;
};

function presentationOf(props: StatusBadgeProps): StatusPresentation {
  switch (props.kind) {
    case 'opportunity':
      return OPPORTUNITY_STATUS[props.status];
    case 'document':
      return DOCUMENT_STATUS[props.status];
    case 'claim':
      return CLAIM_STATUS[props.status];
    case 'analysis':
      return ANALYSIS_STATUS[props.status];
    case 'job':
      return JOB_STATUS[props.status];
  }
}

/**
 * The badge for a state the funding contract defines: a listing's status
 * (Active, Expired, Unverified), a document's processing state, a profile
 * claim's state, an analysis and a job. It always shows words and an icon, so
 * it reads the same without colour. Give a listing's `statusReason` as
 * `reason`: a listing must never be shown as active, expired or unverified
 * without saying why.
 */
export function StatusBadge(props: StatusBadgeProps) {
  const presentation = presentationOf(props);
  const badge = (
    <Badge tone={presentation.tone} icon={presentation.icon} className={props.className}>
      {props.label ?? presentation.label}
    </Badge>
  );
  if (!props.reason) return badge;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-1">
      {badge}
      <span className={cx(text.caption)}>{props.reason}</span>
    </span>
  );
}
