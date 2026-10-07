// The counts shown at the top of the Organization Knowledge Hub, each as a
// short label with a tone and an icon so that none is told apart by colour
// alone. Only the counts that matter are listed: a zero that calls for nothing
// is left out. Kept apart from the component so it can be tested.

import type { SetupStatus } from '../../../shared/funding.js';
import { pluralize } from '../../lib/funding-client.js';
import type { BadgeTone, IconName } from '../ui/index.js';

export interface SetupFact {
  id: 'documents' | 'ready' | 'failed' | 'approved' | 'proposed' | 'review' | 'conflicts';
  label: string;
  tone: BadgeTone;
  icon: IconName;
}

/** The invitation shown until something in the profile has been approved. It never blocks anything. */
export const APPROVE_BEFORE_TAILORED_GUIDANCE =
  'Complete and approve your profile before asking for tailored guidance. Tailored guidance draws only on statements someone has approved.';

// Whatever arrives is shown as a whole number that is not below zero.
const whole = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0);

export function setupFacts(counts: SetupStatus['counts']): SetupFact[] {
  const documents = whole(counts.documents);
  const ready = Math.min(documents, whole(counts.documentsReady));
  const failed = whole(counts.documentsFailed);
  const approved = whole(counts.claimsApproved);
  const proposed = whole(counts.claimsProposed);
  const review = whole(counts.claimsNeedingReview);
  const conflicts = whole(counts.openConflicts);

  const facts: SetupFact[] = [];
  if (documents === 0) {
    facts.push({ id: 'documents', label: 'No documents yet', tone: 'neutral', icon: 'document' });
  } else {
    facts.push({
      id: 'documents',
      label: pluralize(documents, 'document'),
      tone: 'neutral',
      icon: 'document',
    });
    facts.push({
      id: 'ready',
      label: `${ready} of ${documents} ready`,
      tone: ready === documents ? 'success' : 'info',
      icon: ready === documents ? 'check-circle' : 'progress',
    });
  }
  if (failed > 0) {
    facts.push({ id: 'failed', label: `${failed} failed`, tone: 'danger', icon: 'alert' });
  }
  facts.push(
    approved > 0
      ? {
          id: 'approved',
          label: `${pluralize(approved, 'statement')} approved`,
          tone: 'success',
          icon: 'check-circle',
        }
      : { id: 'approved', label: 'No statements approved yet', tone: 'neutral', icon: 'circle' },
  );
  if (proposed > 0) {
    facts.push({
      id: 'proposed',
      label: `${proposed} proposed`,
      tone: 'info',
      icon: 'circle-dashed',
    });
  }
  if (review > 0) {
    facts.push({
      id: 'review',
      label: review === 1 ? '1 needs review' : `${review} need review`,
      tone: 'caution',
      icon: 'alert',
    });
  }
  if (conflicts > 0) {
    facts.push({
      id: 'conflicts',
      label: `${pluralize(conflicts, 'conflict')} between documents`,
      tone: 'caution',
      icon: 'scale',
    });
  }
  return facts;
}
