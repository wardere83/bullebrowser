// One statement of an organization's profile, with what a reader needs to
// judge it: where it stands, where it came from, the passages it rests on and
// when it last changed. The Profile tab and the Our Priorities tab both list
// statements with this, so a statement reads the same wherever it appears.

import { useId } from 'react';
import type { ClaimOrigin, ProfileClaim } from '../../../shared/funding.js';
import { formatDay, pluralize } from '../../lib/funding-client.js';
import {
  Badge,
  Button,
  Checkbox,
  CitationList,
  Icon,
  InlineAlert,
  StatusBadge,
  cx,
  layout,
  text,
  type IconName,
} from '../ui/index.js';
import {
  EDITED_LABEL,
  NO_SOURCE_DOCUMENT,
  ORIGIN_LABELS,
  actionsFor,
  approveLabel,
  excerpt,
  replacementOf,
  replacesLine,
  reviewText,
} from './profile.js';
import type { ClaimActions } from './useClaimActions.js';

// A shape for each origin, so the three are told apart without reading colour.
const ORIGIN_ICONS: Record<ClaimOrigin, IconName> = {
  extracted: 'library',
  verbatim: 'document',
  user: 'building',
};

/** A statement's own words. Line breaks a person typed are kept. */
export const STATEMENT_TEXT = 'whitespace-pre-line break-words text-sm leading-6 text-ink-inverse';

/** Where a statement stands and where it came from, in words. Shown on every statement. */
export function StatementLabels({
  claim,
}: {
  claim: Pick<ProfileClaim, 'status' | 'origin' | 'edited'>;
}) {
  return (
    <div className={layout.row}>
      <StatusBadge kind="claim" status={claim.status} />
      <Badge icon={ORIGIN_ICONS[claim.origin]}>{ORIGIN_LABELS[claim.origin]}</Badge>
      {claim.edited && <Badge icon="pencil">{EDITED_LABEL}</Badge>}
    </div>
  );
}

/** The passages a statement rests on, or the plain fact that it points at no document. */
export function StatementSources({
  claim,
  label,
}: {
  claim: Pick<ProfileClaim, 'citations'>;
  label?: string;
}) {
  if (claim.citations.length > 0) return <CitationList citations={claim.citations} label={label} />;
  return (
    <p className="flex items-center gap-1.5 text-xs leading-4 text-ink-inverse/70">
      <Icon name="info" size={14} />
      {NO_SOURCE_DOCUMENT}
    </p>
  );
}

export interface ClaimListProps {
  /** Says where these statements stand, in words: "In your profile", "Proposed, not part of your profile yet". */
  label: string;
  claims: readonly ProfileClaim[];
  actions: ClaimActions;
  /** Lets each statement be ticked for "Approve selected". Given for proposals only. */
  selection?: { ticked: ReadonlySet<string>; onTick(claimId: string, ticked: boolean): void };
  sourcesLabel?: string;
}

/**
 * Statements that stand in the same place, under a label that says which. A
 * proposal is never listed with approved statements: each status has a list of
 * its own. Renders nothing when there are none.
 */
export function ClaimList({ label, claims, actions, selection, sourcesLabel }: ClaimListProps) {
  const labelId = useId();
  if (claims.length === 0) return null;
  return (
    <div className={layout.stack}>
      <p id={labelId} className={text.overline}>
        {label}
      </p>
      <ul aria-labelledby={labelId} className={layout.list}>
        {claims.map((claim) => (
          <ClaimItem
            key={claim.id}
            claim={claim}
            actions={actions}
            sourcesLabel={sourcesLabel}
            selection={
              selection && {
                selected: selection.ticked.has(claim.id),
                onChange: (ticked) => selection.onTick(claim.id, ticked),
              }
            }
          />
        ))}
      </ul>
    </div>
  );
}

/**
 * Rejected statements, folded away. They are kept so the same suggestion is
 * not made twice, and stay within reach in case one was rejected by mistake.
 */
export function RejectedClaims({
  claims,
  actions,
}: {
  claims: readonly ProfileClaim[];
  actions: ClaimActions;
}) {
  if (claims.length === 0) return null;
  return (
    <details>
      <summary className={cx(text.small, 'cursor-pointer rounded')}>
        {pluralize(claims.length, 'rejected statement')}
      </summary>
      <div className={cx(layout.stack, 'mt-3')}>
        <p className={text.caption}>
          Rejected statements are kept so the same suggestion is not proposed again. They are not
          part of your profile.
        </p>
        <ul className={layout.list}>
          {claims.map((claim) => (
            <ClaimItem key={claim.id} claim={claim} actions={actions} />
          ))}
        </ul>
      </div>
    </details>
  );
}

export interface ClaimItemProps {
  claim: ProfileClaim;
  actions: ClaimActions;
  /** Lets the statement be ticked for "Approve selected". Given for proposals only. */
  selection?: { selected: boolean; onChange(selected: boolean): void };
  /** What the list of citations is called: "Sources", or "Source documents" among the priorities. */
  sourcesLabel?: string;
}

export function ClaimItem({ claim, actions, selection, sourcesLabel }: ClaimItemProps) {
  const excerptId = useId();
  const available = actionsFor(claim.status, {
    approve: actions.canApprove,
    manage: actions.canManage,
  });
  const pending = actions.pending.get(claim.id);
  const note = actions.note?.claimId === claim.id ? actions.note : null;
  const replaces = replacesLine(replacementOf(claim, actions.index));
  const start = excerpt(claim.text);

  return (
    // Focusable from script only: focus lands here when the statement has
    // just moved to another list and the button that moved it is gone.
    <li
      data-claim-id={claim.id}
      tabIndex={-1}
      className="flex flex-col gap-2.5 rounded-md py-4 first:pt-0 last:pb-0"
    >
      <StatementLabels claim={claim} />
      <p className={STATEMENT_TEXT}>{claim.text}</p>
      {replaces && <p className="break-words text-[13px] leading-5 text-ink-inverse/85">{replaces}</p>}
      {claim.status === 'needs_review' && (
        <p className="flex items-start gap-2 text-[13px] leading-5 text-ink-inverse/85">
          <Icon name="alert" className="mt-0.5 text-accent" />
          <span>
            <span className="font-semibold text-ink-inverse">Why it needs review: </span>
            {reviewText(claim)}
          </span>
        </p>
      )}
      <StatementSources claim={claim} label={sourcesLabel} />
      <p className={text.caption}>Last updated {formatDay(claim.updatedAt)}</p>

      {(selection || available.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* The buttons are named for what they do and described by the
              statement they act on: a statement's words never go into a
              button's name. Hidden, so it is read with a button and not a
              second time on its own. */}
          <span id={excerptId} hidden>
            {start}
          </span>
          {selection && (
            <Checkbox
              label={
                <>
                  Select to approve<span className="sr-only">: {start}</span>
                </>
              }
              checked={selection.selected}
              onChange={selection.onChange}
            />
          )}
          {available.includes('approve') && (
            <Button
              size="sm"
              icon="check"
              busy={pending === 'approve'}
              busyLabel="Approving the statement"
              aria-describedby={excerptId}
              onClick={() => void actions.approve([claim])}
            >
              {approveLabel(claim.status)}
            </Button>
          )}
          {available.includes('reject') && (
            <Button
              size="sm"
              variant="quiet"
              busy={pending === 'reject'}
              busyLabel="Rejecting the statement"
              aria-describedby={excerptId}
              onClick={() => void actions.reject(claim)}
            >
              Reject
            </Button>
          )}
          {available.includes('edit') && (
            <Button
              size="sm"
              variant="quiet"
              icon="pencil"
              aria-describedby={excerptId}
              onClick={() => actions.edit(claim)}
            >
              Edit
            </Button>
          )}
          {available.includes('remove') && (
            <Button
              size="sm"
              variant="quiet"
              icon="trash"
              aria-describedby={excerptId}
              onClick={() => actions.remove(claim)}
            >
              Remove
            </Button>
          )}
        </div>
      )}
      {note && <InlineAlert tone={note.tone}>{note.message}</InlineAlert>}
    </li>
  );
}
