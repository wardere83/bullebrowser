// Where the organization's documents disagree. Shown above the profile's
// fields: each conflict with what every side says and the passages it rests
// on, and a choice of which statements to keep. BulleBrowser never makes that
// choice; a person who may approve the profile does.

import { useId, useState } from 'react';
import type { OrganizationProfile, ProfileFieldId } from '../../../shared/funding.js';
import { fundingBridge, pluralize, toCallError, unwrap } from '../../lib/funding-client.js';
import { useWorkspaceLayout } from '../layout.js';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  InlineAlert,
  SectionHeading,
  announce,
  cx,
  layout,
  text,
} from '../ui/index.js';
import { CANNOT_SETTLE } from './access.js';
import { STATEMENT_TEXT, StatementLabels, StatementSources } from './ClaimItem.js';
import { excerpt, withSelection, type OpenConflict } from './profile.js';

const NONE_KEPT: ReadonlySet<string> = new Set();

export interface ConflictListProps {
  conflicts: readonly OpenConflict[];
  /** May settle a conflict. Others see the conflict and why they cannot settle it. */
  canApprove: boolean;
  /** Called with main's answer and the field the settled conflict was about. */
  onSettled(profile: OrganizationProfile, field: ProfileFieldId): void;
}

export function ConflictList({ conflicts, canApprove, onSettled }: ConflictListProps) {
  const headingId = useId();
  const { columns } = useWorkspaceLayout();
  if (conflicts.length === 0) return null;

  return (
    <Card
      as="section"
      padding="lg"
      aria-labelledby={headingId}
      // Lets the tab find this heading when a settled conflict takes its buttons with it.
      data-conflicts=""
      className={layout.section}
    >
      <SectionHeading
        level={3}
        id={headingId}
        title="Your documents disagree"
        addon={
          <Badge tone="caution" icon="scale">
            {pluralize(conflicts.length, 'open conflict')}
          </Badge>
        }
      />
      <InlineAlert tone="caution" title="BulleBrowser does not choose between documents.">
        Read what each statement says and the passage it comes from, then decide which statements
        to keep.
      </InlineAlert>
      {!canApprove && <p className={text.small}>{CANNOT_SETTLE}</p>}
      <ul className={layout.list}>
        {conflicts.map((entry) => (
          <ConflictItem
            key={entry.conflict.id}
            entry={entry}
            canApprove={canApprove}
            sideBySide={columns >= 2}
            onSettled={onSettled}
          />
        ))}
      </ul>
    </Card>
  );
}

function ConflictItem({
  entry,
  canApprove,
  sideBySide,
  onSettled,
}: {
  entry: OpenConflict;
  canApprove: boolean;
  sideBySide: boolean;
  onSettled(profile: OrganizationProfile, field: ProfileFieldId): void;
}) {
  const aboutId = useId();
  const [kept, setKept] = useState(NONE_KEPT);
  const [busy, setBusy] = useState<'kept' | 'none' | null>(null);
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const summary = entry.conflict.summary.trim();

  const settle = async (which: 'kept' | 'none') => {
    if (busy) return;
    const keep =
      which === 'kept'
        ? entry.sides.filter((side) => kept.has(side.id)).map((side) => side.id)
        : [];
    if (which === 'kept' && keep.length === 0) {
      setMessage({
        tone: 'info',
        text: 'Tick the statements to keep first, or choose “Keep none of these”.',
      });
      return;
    }
    setBusy(which);
    setMessage(null);
    try {
      const profile = await unwrap(
        fundingBridge().knowledge.resolveConflict(entry.conflict.id, keep),
      );
      announce('Conflict settled.');
      onSettled(profile, entry.conflict.field);
    } catch (failure) {
      setMessage({ tone: 'error', text: toCallError(failure).message });
      setBusy(null);
    }
  };

  return (
    <li className="flex flex-col gap-4 py-5 first:pt-0 last:pb-0">
      <div className={layout.stack}>
        <p id={aboutId} className={text.overline}>
          {entry.fieldLabel}
        </p>
        {summary && (
          <div>
            <p className={cx(text.body, 'break-words')}>{summary}</p>
            {/* The summary is drafted wording; only the quotations are the documents' own. */}
            <p className={cx(text.caption, 'mt-1')}>
              A summary of the disagreement, drafted by BulleBrowser. The quotations below are what
              your documents say.
            </p>
          </div>
        )}
      </div>

      <ul className={sideBySide ? 'grid grid-cols-2 gap-x-8 gap-y-5' : 'flex flex-col gap-5'}>
        {entry.sides.map((side, index) => (
          <li key={side.id} className="flex min-w-0 flex-col gap-2.5">
            <p className={text.caption}>Statement {index + 1}</p>
            <StatementLabels claim={side} />
            <p className={STATEMENT_TEXT}>{side.text}</p>
            <StatementSources claim={side} />
            {canApprove && (
              <Checkbox
                label={
                  <>
                    Keep this statement<span className="sr-only">: {excerpt(side.text)}</span>
                  </>
                }
                checked={kept.has(side.id)}
                onChange={(on) => setKept(withSelection(kept, side.id, on))}
              />
            )}
          </li>
        ))}
      </ul>

      {entry.missing > 0 && (
        <p className={text.small}>
          {entry.missing === 1
            ? 'One statement in this conflict is no longer in the profile.'
            : `${entry.missing} statements in this conflict are no longer in the profile.`}
        </p>
      )}

      {canApprove && (
        <div className={layout.stack}>
          <div className={layout.row}>
            <Button
              size="sm"
              busy={busy === 'kept'}
              busyLabel="Settling the conflict"
              aria-describedby={aboutId}
              onClick={() => void settle('kept')}
            >
              Keep selected statements
            </Button>
            <Button
              size="sm"
              variant="quiet"
              busy={busy === 'none'}
              busyLabel="Settling the conflict"
              aria-describedby={aboutId}
              onClick={() => void settle('none')}
            >
              Keep none of these
            </Button>
          </div>
          <p className={text.caption}>Statements you do not keep are rejected.</p>
          {message && (
            <InlineAlert tone={message.tone} announce>
              {message.text}
            </InlineAlert>
          )}
        </div>
      )}
    </li>
  );
}
