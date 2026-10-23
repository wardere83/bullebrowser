// The Profile tab: drafting a profile from the documents, the places where
// documents disagree, and the nine fields with their statements. Approved
// statements are the profile. Everything else is listed apart from them and
// named for what it is, and becomes part of the profile only when a person
// who may approve it does so.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type {
  AssistantAvailability,
  OrganizationProfile,
  ProfileFieldId,
} from '../../../shared/funding.js';
import { pluralize } from '../../lib/funding-client.js';
import type { ConsentGate } from '../ConsentGate.js';
import {
  Button,
  Card,
  InlineAlert,
  LoadingBlock,
  SectionHeading,
  cx,
  layout,
  text,
} from '../ui/index.js';
import { CANNOT_APPROVE, CANNOT_CHANGE_STATEMENTS } from './access.js';
import { ClaimList, RejectedClaims } from './ClaimItem.js';
import { ConflictList } from './ConflictList.js';
import type { DocumentTally } from './documents.js';
import { DraftProfile } from './DraftProfile.js';
import {
  countProfile,
  describeGroup,
  groupByField,
  liveSelection,
  openConflicts,
  withSelection,
  type FieldGroup,
} from './profile.js';
import { useClaimActions, type ClaimActions } from './useClaimActions.js';
import { useFocusRepair } from './useFocusRepair.js';
import type { ProfileData } from './useProfileData.js';

const NOTHING_TICKED: ReadonlySet<string> = new Set();

export interface ProfileTabProps {
  data: ProfileData;
  /** The documents by where they have got to. Null when they could not be counted. */
  documents: DocumentTally | null;
  assistant: AssistantAvailability | null;
  /** May add, edit and remove statements, and start a draft. */
  canManage: boolean;
  /** May approve and reject statements, and settle conflicts. */
  canApprove: boolean;
  runWithConsent: ConsentGate['run'];
  /** The proposals ticked for "Approve selected". Held by the screen so it survives a look at another tab. */
  selected: ReadonlySet<string>;
  onSelectedChange(selected: ReadonlySet<string>): void;
  /** A field whose heading should take focus, from a link elsewhere in the app. */
  focusField: ProfileFieldId | null;
  onFieldFocused(): void;
  onOpenDocuments(): void;
}

function fieldSection(root: HTMLElement | null, field: ProfileFieldId): HTMLElement | undefined {
  return Array.from(root?.querySelectorAll<HTMLElement>('[data-profile-field]') ?? []).find(
    (element) => element.dataset.profileField === field,
  );
}

export function ProfileTab({
  data,
  documents,
  assistant,
  canManage,
  canApprove,
  runWithConsent,
  selected,
  onSelectedChange,
  focusField,
  onFieldFocused,
  onOpenDocuments,
}: ProfileTabProps) {
  const headingId = useId();
  const approveSelectedRef = useRef<HTMLButtonElement>(null);
  const repairFocus = useFocusRepair();
  const actions = useClaimActions({ profile: data.profile, apply: data.apply, canManage, canApprove });
  const { rootRef } = actions;
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchMessage, setBatchMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(
    null,
  );
  const [approvingField, setApprovingField] = useState<ProfileFieldId | null>(null);
  const [fieldFailure, setFieldFailure] = useState<{ field: ProfileFieldId; text: string } | null>(
    null,
  );

  const profile = data.profile;
  const loaded = profile !== undefined;
  const groups = useMemo(() => (profile ? groupByField(profile) : []), [profile]);
  const conflicts = useMemo(() => (profile ? openConflicts(profile) : []), [profile]);
  const counts = profile ? countProfile(profile) : null;
  // A statement approved or removed in the meantime is no longer ticked.
  const ticked = profile ? liveSelection(selected, profile) : NOTHING_TICKED;

  // A link elsewhere asked for one field: bring it into view and put focus on
  // its heading. Deferred by a frame so that it comes after the workspace has
  // scrolled the newly opened screen to its top.
  useEffect(() => {
    if (!focusField || !loaded) return;
    const frame = requestAnimationFrame(() => {
      const section = fieldSection(rootRef.current, focusField);
      section?.scrollIntoView({ block: 'start' });
      section?.querySelector<HTMLElement>('h3')?.focus({ preventScroll: true });
      onFieldFocused();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusField, loaded, onFieldFocused, rootRef]);

  const approveSelected = async () => {
    if (!profile || batchBusy) return;
    const claims = profile.claims.filter((claim) => ticked.has(claim.id));
    if (claims.length === 0) {
      setBatchMessage({ tone: 'info', text: 'Tick at least one proposed statement first.' });
      return;
    }
    setBatchBusy(true);
    setBatchMessage(null);
    const failure = await actions.approve(claims);
    setBatchBusy(false);
    if (failure) setBatchMessage({ tone: 'error', text: failure });
    else onSelectedChange(NOTHING_TICKED);
  };

  const approveAll = async (group: FieldGroup) => {
    if (approvingField) return;
    setApprovingField(group.field);
    setFieldFailure(null);
    const failure = await actions.approve(group.proposed);
    setApprovingField(null);
    if (failure) setFieldFailure({ field: group.field, text: failure });
  };

  const settled = (result: OrganizationProfile, field: ProfileFieldId) => {
    data.apply(result);
    // The conflict's own buttons are gone with it. Focus goes to the conflicts
    // that are left, or else to the field the settled one was about.
    repairFocus(() => {
      const root = rootRef.current;
      return (
        root?.querySelector<HTMLElement>('[data-conflicts] h3') ??
        fieldSection(root, field)?.querySelector<HTMLElement>('h3')
      );
    });
  };

  return (
    <div ref={rootRef} className={layout.screen}>
      <section aria-labelledby={headingId} className={layout.section}>
        <SectionHeading
          level={2}
          id={headingId}
          title="Profile"
          description="Statements about your organization, each with the passage it comes from. Only approved statements are part of your profile. Proposed statements, and statements that need review, are not used until someone approves them."
        />
        <DraftProfile
          extraction={profile?.extraction ?? null}
          documents={documents}
          assistant={assistant}
          canManage={canManage}
          hasStatements={Boolean(profile && profile.claims.length > 0)}
          runWithConsent={runWithConsent}
          onOpenDocuments={onOpenDocuments}
        />
      </section>

      {data.error && (
        <InlineAlert
          tone="error"
          action={
            <Button size="sm" onClick={data.reload}>
              Try again
            </Button>
          }
        >
          {data.error.message}
        </InlineAlert>
      )}
      {data.loading && <LoadingBlock label="Loading the profile" lines={5} />}

      {profile && (
        <>
          <ConflictList conflicts={conflicts} canApprove={canApprove} onSettled={settled} />

          {(!canApprove || !canManage) && (
            <InlineAlert tone="info">
              {[!canApprove && CANNOT_APPROVE, !canManage && CANNOT_CHANGE_STATEMENTS]
                .filter(Boolean)
                .join(' ')}
            </InlineAlert>
          )}

          <div className={layout.section}>
            {groups.map((group) => (
              <FieldSection
                key={group.field}
                group={group}
                actions={actions}
                ticked={ticked}
                onTick={(claimId, on) => onSelectedChange(withSelection(ticked, claimId, on))}
                approving={approvingField === group.field}
                failure={fieldFailure?.field === group.field ? fieldFailure.text : null}
                onApproveAll={() => void approveAll(group)}
              />
            ))}
          </div>

          {/* Stays at the foot of the view while the fields scroll, so the
              statements ticked far up the page can be approved from anywhere. */}
          {canApprove && counts && counts.proposed > 0 && (
            <div className="sticky bottom-0 z-10 flex flex-col gap-2 border-t border-white/10 bg-surface-dark py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <p role="status" className={cx(text.small, 'min-w-0 flex-1 basis-56')}>
                  {ticked.size === 0
                    ? 'Tick proposed statements to approve several at once.'
                    : `${pluralize(ticked.size, 'statement')} selected.`}
                </p>
                {ticked.size > 0 && (
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => {
                      onSelectedChange(NOTHING_TICKED);
                      setBatchMessage(null);
                      // This button goes when nothing is ticked.
                      repairFocus(() => approveSelectedRef.current);
                    }}
                  >
                    Clear selection
                  </Button>
                )}
                <Button
                  ref={approveSelectedRef}
                  size="sm"
                  variant="primary"
                  icon="check"
                  busy={batchBusy}
                  busyLabel="Approving the selected statements"
                  onClick={() => void approveSelected()}
                >
                  Approve selected
                </Button>
              </div>
              {batchMessage && (
                <InlineAlert tone={batchMessage.tone} announce>
                  {batchMessage.text}
                </InlineAlert>
              )}
            </div>
          )}
        </>
      )}
      {actions.dialogs}
    </div>
  );
}

function FieldSection({
  group,
  actions,
  ticked,
  onTick,
  approving,
  failure,
  onApproveAll,
}: {
  group: FieldGroup;
  actions: ClaimActions;
  ticked: ReadonlySet<string>;
  onTick(claimId: string, ticked: boolean): void;
  approving: boolean;
  failure: string | null;
  onApproveAll(): void;
}) {
  const headingId = useId();
  return (
    <Card
      as="section"
      padding="lg"
      aria-labelledby={headingId}
      data-profile-field={group.field}
      className={cx(layout.section, 'scroll-mt-4')}
    >
      <SectionHeading
        level={3}
        id={headingId}
        title={group.label}
        description={describeGroup(group)}
        actions={
          actions.canApprove && group.proposed.length > 0 ? (
            <Button
              size="sm"
              busy={approving}
              busyLabel="Approving the proposed statements"
              aria-describedby={headingId}
              onClick={onApproveAll}
            >
              Approve all proposed
            </Button>
          ) : undefined
        }
      />
      {failure && <InlineAlert tone="error">{failure}</InlineAlert>}
      {group.gap && (
        <InlineAlert tone="info" title="Not covered by your documents.">
          {group.gap.note.trim() || 'Nothing in your documents speaks to this part of the profile.'}
        </InlineAlert>
      )}
      <ClaimList label="In your profile" claims={group.approved} actions={actions} />
      <ClaimList
        label="Proposed, not part of your profile yet"
        claims={group.proposed}
        actions={actions}
        selection={actions.canApprove ? { ticked, onTick } : undefined}
      />
      <ClaimList
        label="Needs review, not in use until approved again"
        claims={group.needsReview}
        actions={actions}
      />
      <RejectedClaims claims={group.rejected} actions={actions} />
      {actions.canManage && (
        <div>
          <Button
            size="sm"
            variant="quiet"
            icon="plus"
            aria-describedby={headingId}
            onClick={() => actions.add(group.field)}
          >
            Add a statement
          </Button>
        </div>
      )}
    </Card>
  );
}
