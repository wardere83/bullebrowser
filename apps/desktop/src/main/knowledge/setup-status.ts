// How far an organization has got with setting up its Knowledge Hub, and the
// one thing to do next.
//
// Five steps, always in the same order. They are worked out from the documents
// and the profile as they are now, so the answer never has to be stored and can
// never disagree with them. The next action is the action of the first step
// that is not done, which is why setup is complete exactly when all five are.

import {
  ORGANIZATION_KIND_LABELS,
  type KnowledgeDocument,
  type Organization,
  type OrganizationProfile,
  type SetupStatus,
  type SetupStep,
} from '../../shared/funding.js';

const count = (amount: number, one: string, many: string): string => `${amount} ${amount === 1 ? one : many}`;

const statements = (amount: number): string => count(amount, 'statement', 'statements');

const documentsOf = (amount: number): string => count(amount, 'document', 'documents');

/** "A, B and C." as one sentence starting with a capital. */
function sentence(parts: string[]): string {
  const last = parts[parts.length - 1] ?? '';
  const joined = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${last}` : last;
  return `${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`;
}

export function setupStatusOf(
  organization: Organization,
  documents: KnowledgeDocument[],
  profile: OrganizationProfile,
): SetupStatus {
  const total = documents.length;
  const ready = documents.filter((document) => document.status === 'ready').length;
  const failed = documents.filter((document) => document.status === 'failed').length;
  const waiting = total - ready - failed;

  const proposed = profile.claims.filter((claim) => claim.status === 'proposed').length;
  const approved = profile.claims.filter((claim) => claim.status === 'approved').length;
  const needingReview = profile.claims.filter((claim) => claim.status === 'needs_review').length;
  const openConflicts = profile.conflicts.filter((conflict) => conflict.resolvedAt === null).length;
  // Rejected statements are kept only so they are not offered again.
  const drafted = proposed + approved + needingReview;
  const drafting = profile.extraction.status === 'running';

  const uploaded = total > 0;
  // A document that could not be read is not one that has been read.
  const read = ready > 0 && waiting === 0;
  const hasDraft = drafted > 0;
  // Approved means reviewed: nothing proposed, flagged or in dispute is left.
  const settled = approved > 0 && proposed === 0 && needingReview === 0 && openConflicts === 0;

  const couldNotBeRead = failed > 0 ? ` ${failed} could not be read.` : '';
  let readDetail: string;
  if (!uploaded) readDetail = 'Nothing to read yet.';
  else if (waiting > 0) readDetail = `${ready} of ${total} read so far.${couldNotBeRead}`;
  else if (failed > 0) readDetail = `${ready} of ${total} read.${couldNotBeRead}`;
  else readDetail = total === 1 ? 'Your document has been read.' : `All ${total} documents have been read.`;

  let draftDetail: string;
  if (drafting) draftDetail = 'Your documents are being read to draft the profile.';
  else if (hasDraft) draftDetail = `${statements(drafted)} drafted.`;
  else if (profile.extraction.status === 'failed') draftDetail = 'The last attempt to draft the profile did not finish.';
  else if (profile.extraction.lastRunAt !== null) draftDetail = 'The last reading found nothing to propose.';
  else draftDetail = 'Not drafted yet.';

  const undecided = proposed + needingReview;
  let approvedDetail: string;
  if (approved === 0) approvedDetail = 'Nothing is approved yet.';
  else if (undecided > 0) approvedDetail = `${approved} approved, ${undecided} still to review.`;
  else if (openConflicts > 0) {
    approvedDetail = `${approved} approved, ${count(openConflicts, 'conflict', 'conflicts')} to resolve.`;
  } else approvedDetail = `${statements(approved)} approved.`;

  const steps: SetupStep[] = [
    {
      id: 'organization',
      label: 'Add your organization',
      done: true,
      detail: `${organization.name} (${ORGANIZATION_KIND_LABELS[organization.kind] ?? 'Organization'})`,
    },
    {
      id: 'documents',
      label: "Upload your organization's documents",
      done: uploaded,
      detail: uploaded ? `${documentsOf(total)} uploaded.` : 'No documents yet.',
    },
    { id: 'processing', label: 'Documents read', done: read, detail: readDetail },
    { id: 'profile_draft', label: 'Profile drafted for review', done: hasDraft, detail: draftDetail },
    { id: 'profile_approved', label: 'Profile approved', done: settled, detail: approvedDetail },
  ];

  let nextAction: string;
  if (!uploaded) {
    nextAction = "Upload your organization's documents, such as a strategic plan, a budget or a previous proposal.";
  } else if (waiting > 0) {
    nextAction = `Wait while ${count(waiting, 'document is', 'documents are')} read.`;
  } else if (!read) {
    nextAction =
      failed === 1
        ? 'Your document could not be read. Replace it or upload another.'
        : 'None of your documents could be read. Replace them or upload others.';
  } else if (!hasDraft) {
    nextAction = drafting
      ? 'Wait while your profile is drafted from your documents.'
      : 'Draft your profile from the documents you uploaded.';
  } else if (!settled) {
    const todo: string[] = [];
    if (proposed > 0) todo.push(`review ${proposed} proposed ${proposed === 1 ? 'statement' : 'statements'}`);
    if (openConflicts > 0) todo.push(`resolve ${count(openConflicts, 'conflict', 'conflicts')}`);
    if (needingReview > 0) {
      todo.push(
        `review ${needingReview === 1 ? '1 statement whose source' : `${needingReview} statements whose sources`} changed`,
      );
    }
    // A draft that is not settled always leaves one of the three to do; the
    // fallback only keeps the sentence whole should that ever stop being so.
    nextAction = todo.length > 0 ? sentence(todo) : 'Review your profile.';
  } else {
    nextAction = 'Your profile setup is complete.';
  }

  return {
    steps,
    completed: steps.filter((step) => step.done).length,
    total: steps.length,
    readyForTailoredGuidance: approved > 0,
    nextAction,
    counts: {
      documents: total,
      documentsReady: ready,
      documentsFailed: failed,
      claimsProposed: proposed,
      claimsApproved: approved,
      claimsNeedingReview: needingReview,
      openConflicts,
    },
  };
}
