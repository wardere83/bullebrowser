// How an organization's profile is arranged on screen: statements grouped by
// field and by where they stand, what a proposal would replace, which
// documents disagree, and the words that say where a statement came from.
// Kept apart from the components so the rules can be tested.
//
// One rule runs through it: only an approved statement is part of the profile.
// A proposal, a statement whose source changed and a rejected statement are
// always kept in groups of their own and named for what they are.

import {
  PROFILE_FIELDS,
  PROFILE_FIELD_LABELS,
  type AssistantAvailability,
  type ClaimOrigin,
  type ClaimStatus,
  type JobProgress,
  type OrganizationProfile,
  type ProfileClaim,
  type ProfileConflict,
  type ProfileExtractionState,
  type ProfileFieldId,
  type ProfileGap,
  type ReviewReason,
} from '../../../shared/funding.js';
import { pluralize } from '../../lib/funding-client.js';

// ─────────────────────────────── where it came from ────────────────────────────

/** Where a statement came from, in the product's words. Shown on every statement. */
export const ORIGIN_LABELS: Record<ClaimOrigin, string> = {
  extracted: 'Drafted from your documents',
  verbatim: 'Word for word from a document',
  user: 'Written by your team',
};

/** Added when a person has changed the wording of a drafted statement. */
export const EDITED_LABEL = 'Edited';

/** Said in place of citations for a statement that points at no document. */
export const NO_SOURCE_DOCUMENT = 'No source document';

// The contract's reasons, for the rare statement that arrives without a sentence of its own.
const REVIEW_REASONS: Record<ReviewReason, string> = {
  source_deleted: 'The document this statement cites was deleted.',
  source_replaced: 'The document this statement cites was replaced.',
  evidence_missing: 'The passage this statement cites is no longer in your documents.',
  conflict: 'Your documents disagree about this.',
};

/** Why a statement needs review: main's own sentence, or the reason in words. */
export function reviewText(claim: Pick<ProfileClaim, 'reviewNote' | 'reviewReason'>): string {
  const note = claim.reviewNote.trim();
  if (note) return note;
  return claim.reviewReason
    ? REVIEW_REASONS[claim.reviewReason]
    : 'Its source changed after it was approved.';
}

// ─────────────────────────────────── grouping ──────────────────────────────────

export interface FieldGroup {
  field: ProfileFieldId;
  label: string;
  /** The only statements that are part of the profile. */
  approved: ProfileClaim[];
  proposed: ProfileClaim[];
  needsReview: ProfileClaim[];
  rejected: ProfileClaim[];
  /** Set when the documents do not cover the field. */
  gap: ProfileGap | null;
}

// Oldest first, so a statement keeps its place when it is edited or approved.
const byAge = (a: ProfileClaim, b: ProfileClaim) =>
  a.createdAt - b.createdAt || a.id.localeCompare(b.id);

/** The nine fields in the contract's order, each with its statements by status. */
export function groupByField(profile: Pick<OrganizationProfile, 'claims' | 'gaps'>): FieldGroup[] {
  return PROFILE_FIELDS.map((field) => {
    const claims = profile.claims.filter((claim) => claim.field === field).sort(byAge);
    const withStatus = (status: ClaimStatus) => claims.filter((claim) => claim.status === status);
    return {
      field,
      label: PROFILE_FIELD_LABELS[field],
      approved: withStatus('approved'),
      proposed: withStatus('proposed'),
      needsReview: withStatus('needs_review'),
      rejected: withStatus('rejected'),
      gap: profile.gaps.find((gap) => gap.field === field) ?? null,
    };
  });
}

/** "1 approved, 2 proposed, 1 needs review", or that there is nothing yet. */
export function describeGroup(
  group: Pick<FieldGroup, 'approved' | 'proposed' | 'needsReview'>,
): string {
  const parts: string[] = [];
  if (group.approved.length > 0) parts.push(`${group.approved.length} approved`);
  if (group.proposed.length > 0) parts.push(`${group.proposed.length} proposed`);
  if (group.needsReview.length > 0) {
    parts.push(
      group.needsReview.length === 1
        ? '1 needs review'
        : `${group.needsReview.length} need review`,
    );
  }
  return parts.length > 0 ? parts.join(', ') : 'No statements yet';
}

export function claimIndex(
  profile: Pick<OrganizationProfile, 'claims'>,
): ReadonlyMap<string, ProfileClaim> {
  return new Map(profile.claims.map((claim) => [claim.id, claim]));
}

export interface ProfileCounts {
  approved: number;
  proposed: number;
  needsReview: number;
  rejected: number;
  openConflicts: number;
  gaps: number;
}

export function countProfile(
  profile: Pick<OrganizationProfile, 'claims' | 'conflicts' | 'gaps'>,
): ProfileCounts {
  const count = (status: ClaimStatus) =>
    profile.claims.filter((claim) => claim.status === status).length;
  return {
    approved: count('approved'),
    proposed: count('proposed'),
    needsReview: count('needs_review'),
    rejected: count('rejected'),
    openConflicts: profile.conflicts.filter((conflict) => conflict.resolvedAt === null).length,
    gaps: profile.gaps.length,
  };
}

// ──────────────────────────────── what it replaces ─────────────────────────────

/**
 * What a proposal would take the place of once approved: nothing, a statement
 * (shown as "Replaces: …"), or a statement that has since gone.
 */
export type Replacement = { kind: 'statement'; text: string } | { kind: 'missing' } | null;

export function replacementOf(
  claim: Pick<ProfileClaim, 'supersedesClaimId'>,
  index: ReadonlyMap<string, ProfileClaim>,
): Replacement {
  if (!claim.supersedesClaimId) return null;
  const replaced = index.get(claim.supersedesClaimId);
  return replaced ? { kind: 'statement', text: replaced.text } : { kind: 'missing' };
}

/** The line shown under a proposal that would replace something, or an empty string. */
export function replacesLine(replacement: Replacement): string {
  if (!replacement) return '';
  return replacement.kind === 'statement'
    ? `Replaces: ${replacement.text}`
    : 'Replaces: a statement that is no longer in the profile.';
}

// ─────────────────────────────────── conflicts ─────────────────────────────────

export interface OpenConflict {
  conflict: ProfileConflict;
  fieldLabel: string;
  /** The statements that disagree, in the order the conflict lists them. */
  sides: ProfileClaim[];
  /** How many statements the conflict names that are no longer in the profile. */
  missing: number;
}

/** The conflicts nobody has settled yet, in the order of the fields they are about. */
export function openConflicts(
  profile: Pick<OrganizationProfile, 'claims' | 'conflicts'>,
): OpenConflict[] {
  const index = claimIndex(profile);
  return profile.conflicts
    .filter((conflict) => conflict.resolvedAt === null)
    .map((conflict) => {
      const ids = [...new Set(conflict.claimIds)];
      const sides = ids.flatMap((id) => index.get(id) ?? []);
      return {
        conflict,
        fieldLabel: PROFILE_FIELD_LABELS[conflict.field],
        sides,
        missing: ids.length - sides.length,
      };
    })
    .sort(
      (a, b) =>
        PROFILE_FIELDS.indexOf(a.conflict.field) - PROFILE_FIELDS.indexOf(b.conflict.field),
    );
}

// ────────────────────────────────── our priorities ─────────────────────────────

/** The profile field the "Our Priorities" tab is a view of. */
export const PRIORITIES_FIELD: ProfileFieldId = 'strategic_priorities';

export interface Priorities {
  /** Approved. These are the organization's priorities. */
  confirmed: ProfileClaim[];
  /** Proposed from documents or by a person; not priorities until approved. */
  proposed: ProfileClaim[];
  /** Were confirmed, but their source changed. */
  needsReview: ProfileClaim[];
  rejected: ProfileClaim[];
  /** Nothing confirmed and nothing waiting. */
  empty: boolean;
}

export function prioritiesOf(profile: Pick<OrganizationProfile, 'claims' | 'gaps'>): Priorities {
  const group = groupByField(profile).find((entry) => entry.field === PRIORITIES_FIELD);
  const confirmed = group?.approved ?? [];
  const proposed = group?.proposed ?? [];
  const needsReview = group?.needsReview ?? [];
  return {
    confirmed,
    proposed,
    needsReview,
    rejected: group?.rejected ?? [],
    empty: confirmed.length + proposed.length + needsReview.length === 0,
  };
}

// ─────────────────────────────── what may be done ──────────────────────────────

export type ClaimAction = 'approve' | 'reject' | 'edit' | 'remove';

/**
 * What can be done with a statement, by where it stands and what the person
 * may do. Approving and rejecting need `profile.approve`; editing and removing
 * need `knowledge.manage`. Main checks again whatever is shown here.
 */
export function actionsFor(
  status: ClaimStatus,
  may: { approve: boolean; manage: boolean },
): ClaimAction[] {
  const actions: ClaimAction[] = [];
  if (may.approve && status !== 'approved') actions.push('approve');
  if (may.approve && status === 'proposed') actions.push('reject');
  if (may.manage && status !== 'rejected') actions.push('edit');
  if (may.manage && status !== 'proposed') actions.push('remove');
  return actions;
}

/** A statement that was approved before is approved "again". */
export function approveLabel(status: ClaimStatus): string {
  return status === 'needs_review' ? 'Approve again' : 'Approve';
}

export function approvedMessage(count: number): string {
  return count === 1 ? 'Statement approved.' : `${pluralize(count, 'statement')} approved.`;
}

export function rejectedMessage(count: number): string {
  return count === 1 ? 'Statement rejected.' : `${pluralize(count, 'statement')} rejected.`;
}

// ─────────────────────────────────── selection ─────────────────────────────────

/**
 * The ticked statements that can still be approved together. A statement that
 * was approved, rejected or removed in the meantime drops out. Returns the same
 * set when nothing dropped out, so it is safe to call on every render.
 */
export function liveSelection(
  selected: ReadonlySet<string>,
  profile: Pick<OrganizationProfile, 'claims'>,
): ReadonlySet<string> {
  if (selected.size === 0) return selected;
  const proposed = new Set(
    profile.claims.filter((claim) => claim.status === 'proposed').map((claim) => claim.id),
  );
  const live = [...selected].filter((id) => proposed.has(id));
  return live.length === selected.size ? selected : new Set(live);
}

export function withSelection(
  selected: ReadonlySet<string>,
  claimId: string,
  on: boolean,
): ReadonlySet<string> {
  if (selected.has(claimId) === on) return selected;
  const next = new Set(selected);
  if (on) next.add(claimId);
  else next.delete(claimId);
  return next;
}

// ─────────────────────────────────── drafting ──────────────────────────────────

/** How a draft would be made right now. "unknown" until the app knows whether an assistant is connected. */
export type DraftMode = 'assistant' | 'verbatim' | 'unknown';

export function draftMode(assistant: Pick<AssistantAvailability, 'connected'> | null): DraftMode {
  if (!assistant) return 'unknown';
  return assistant.connected ? 'assistant' : 'verbatim';
}

/** The two ways a draft is made. Both are always shown; `draftMode` says which applies. */
export const DRAFT_WAYS: Record<Exclude<DraftMode, 'unknown'>, { title: string; body: string }> = {
  assistant: {
    title: 'With a connected assistant',
    body: 'BulleBrowser proposes statements with citations and points out where your documents disagree.',
  },
  verbatim: {
    title: 'Without an assistant',
    body: 'BulleBrowser offers passages word for word and cannot compare documents.',
  },
};

/** What is read out when a draft ends while the person is doing something else. */
export function draftEndedMessage(state: JobProgress['state']): string {
  switch (state) {
    case 'completed':
      return 'The profile draft is ready to review.';
    case 'failed':
      return 'The profile draft did not finish.';
    case 'cancelled':
      return 'The profile draft was stopped.';
    case 'running':
      return '';
  }
}

/** When and how the last draft was made. `formatWhen` writes the moment. */
export function lastDraftText(
  extraction: Pick<ProfileExtractionState, 'lastRunAt' | 'method'>,
  formatWhen: (ms: number) => string,
): string {
  if (extraction.lastRunAt === null) return 'No draft has been made yet.';
  const when = formatWhen(extraction.lastRunAt);
  if (extraction.method === 'assistant') return `Last drafted ${when}, with a connected assistant.`;
  if (extraction.method === 'verbatim') {
    return `Last drafted ${when}, word for word and without an assistant.`;
  }
  return `Last drafted ${when}.`;
}

// ─────────────────────────────── after a change ────────────────────────────────

/** A profile main returned from a change, and the loaded profile it was shown over. */
export interface AppliedProfile {
  profile: OrganizationProfile;
  over: OrganizationProfile | undefined;
}

/**
 * The profile to show. A change's own answer is shown at once, in place of the
 * loaded profile it was made on, and gives way as soon as a newer read arrives.
 */
export function effectiveProfile(
  loaded: OrganizationProfile | undefined,
  applied: AppliedProfile | null,
): OrganizationProfile | undefined {
  return applied && applied.over === loaded ? applied.profile : loaded;
}

/** The statements in `after` that `before` did not have. */
export function addedClaims(
  before: Pick<OrganizationProfile, 'claims'> | undefined,
  after: Pick<OrganizationProfile, 'claims'>,
): ProfileClaim[] {
  const known = new Set((before?.claims ?? []).map((claim) => claim.id));
  return after.claims.filter((claim) => !known.has(claim.id));
}

/** A statement that was just changed, and the field it is (or was) listed under. */
export interface ClaimChange {
  claimId: string | null;
  field: ProfileFieldId;
}

/** Where focus belongs after a change: a statement when `claimId` is set, or else its field's heading. */
export interface FocusTarget {
  claimId: string | null;
  field: ProfileFieldId;
}

/**
 * Where keyboard focus belongs when the control that made a change has gone
 * with the change (an approved statement moves to another list, a removed one
 * disappears). The statement itself when it is still listed; otherwise its
 * field's heading. Rejected statements sit in a closed list, so they count as
 * not listed.
 */
export function focusAfterChange(
  profile: Pick<OrganizationProfile, 'claims'>,
  change: ClaimChange,
): FocusTarget {
  const claim = change.claimId
    ? profile.claims.find((entry) => entry.id === change.claimId)
    : undefined;
  if (claim && claim.status !== 'rejected') return { claimId: claim.id, field: claim.field };
  return { claimId: null, field: claim?.field ?? change.field };
}

// ──────────────────────────────────── wording ──────────────────────────────────

/** The start of a statement, for telling one control from the next: whole words, then an ellipsis. */
export function excerpt(text: string, limit = 80): string {
  const tidy = text.replace(/\s+/g, ' ').trim();
  if (tidy.length <= limit) return tidy;
  const cut = tidy.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
