// What can be done with a profile statement, for the two tabs that list them:
// approve, reject, add, edit and remove. The hook makes the calls, shows main's
// answer at once, says what happened, keeps keyboard focus near the statement,
// and owns the dialogs. A tab renders `dialogs` once and puts `rootRef` on the
// element that contains its statements.

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import type {
  OrganizationProfile,
  ProfileClaim,
  ProfileFieldId,
} from '../../../shared/funding.js';
import { fundingBridge, toCallError, unwrap } from '../../lib/funding-client.js';
import { isDisplayed } from '../ui/focus.js';
import { CLAIM_STATUS, announce } from '../ui/index.js';
import {
  AddStatementDialog,
  EditStatementDialog,
  RemoveStatementDialog,
} from './ClaimDialogs.js';
import {
  addedClaims,
  approvedMessage,
  claimIndex,
  focusAfterChange,
  rejectedMessage,
  type ClaimChange,
  type FocusTarget,
} from './profile.js';
import { leftOutNote } from './statement-form.js';
import { useFocusRepair } from './useFocusRepair.js';

/** Something to say beside one statement: a call that failed, or evidence that was left out. */
export interface ClaimNote {
  claimId: string;
  tone: 'error' | 'caution';
  message: string;
}

type PendingAction = 'approve' | 'reject';

type OpenDialog =
  | { kind: 'add'; field: ProfileFieldId; lockField: boolean; title: string; submitLabel: string }
  | { kind: 'edit'; claimId: string }
  | { kind: 'remove'; claimId: string };

export interface ClaimActions {
  /** May add, edit and remove statements. */
  canManage: boolean;
  /** May approve and reject statements. */
  canApprove: boolean;
  /** Every statement of the profile by id, for showing what a proposal would replace. */
  index: ReadonlyMap<string, ProfileClaim>;
  /** The statements with a call on its way, and which call. */
  pending: ReadonlyMap<string, PendingAction>;
  note: ClaimNote | null;
  /**
   * Approves the statements. Resolves with null, or with what went wrong; for
   * one statement the failure is also shown beside it.
   */
  approve(claims: readonly ProfileClaim[]): Promise<string | null>;
  reject(claim: ProfileClaim): Promise<void>;
  /** Opens the form for a new statement. `only` keeps the form to that one field. */
  add(field: ProfileFieldId, only?: { title: string; submitLabel: string }): void;
  edit(claim: ProfileClaim): void;
  remove(claim: ProfileClaim): void;
  /** Put this on the element that contains the tab's statements. */
  rootRef: RefObject<HTMLDivElement | null>;
  /** Render once in the tab. */
  dialogs: ReactNode;
}

const NO_CLAIMS: ReadonlyMap<string, ProfileClaim> = new Map();
const NOTHING_PENDING: ReadonlyMap<string, PendingAction> = new Map();

/**
 * The element focus should go to: the statement where it is listed now, or its
 * field's heading, or the tab's own heading when the field has no section here.
 */
function locate(root: HTMLElement | null, target: FocusTarget): HTMLElement | null {
  if (!root) return null;
  if (target.claimId) {
    const item = Array.from(root.querySelectorAll<HTMLElement>('[data-claim-id]')).find(
      (element) => element.dataset.claimId === target.claimId && isDisplayed(element),
    );
    if (item) return item;
  }
  const section = Array.from(root.querySelectorAll<HTMLElement>('[data-profile-field]')).find(
    (element) => element.dataset.profileField === target.field,
  );
  return (section ?? root).querySelector<HTMLElement>('h2, h3');
}

export function useClaimActions({
  profile,
  apply,
  canManage,
  canApprove,
}: {
  profile: OrganizationProfile | undefined;
  apply(profile: OrganizationProfile): void;
  canManage: boolean;
  canApprove: boolean;
}): ClaimActions {
  const rootRef = useRef<HTMLDivElement>(null);
  const repairFocus = useFocusRepair();
  const [pending, setPending] = useState(NOTHING_PENDING);
  const [note, setNote] = useState<ClaimNote | null>(null);
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const index = useMemo(() => (profile ? claimIndex(profile) : NO_CLAIMS), [profile]);

  /** Shows main's answer, says what happened, and keeps focus near the statement. */
  const settle = useCallback(
    (result: OrganizationProfile, change: ClaimChange, message: string) => {
      apply(result);
      announce(message);
      repairFocus(() => locate(rootRef.current, focusAfterChange(result, change)));
    },
    [apply, repairFocus],
  );

  const mark = useCallback((ids: readonly string[], action: PendingAction | null) => {
    setPending((current) => {
      const next = new Map(current);
      for (const id of ids) {
        if (action) next.set(id, action);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const approve = useCallback(
    async (claims: readonly ProfileClaim[]): Promise<string | null> => {
      const first = claims[0];
      if (!first) return null;
      const ids = claims.map((claim) => claim.id);
      mark(ids, 'approve');
      setNote(null);
      try {
        const result = await unwrap(fundingBridge().knowledge.approveClaims(ids));
        settle(
          result,
          { claimId: ids.length === 1 ? first.id : null, field: first.field },
          approvedMessage(ids.length),
        );
        return null;
      } catch (error) {
        const message = toCallError(error).message;
        if (ids.length === 1) setNote({ claimId: first.id, tone: 'error', message });
        return message;
      } finally {
        mark(ids, null);
      }
    },
    [mark, settle],
  );

  const reject = useCallback(
    async (claim: ProfileClaim): Promise<void> => {
      mark([claim.id], 'reject');
      setNote(null);
      try {
        const result = await unwrap(fundingBridge().knowledge.rejectClaims([claim.id]));
        settle(result, { claimId: claim.id, field: claim.field }, rejectedMessage(1));
      } catch (error) {
        setNote({ claimId: claim.id, tone: 'error', message: toCallError(error).message });
      } finally {
        mark([claim.id], null);
      }
    },
    [mark, settle],
  );

  const add = useCallback(
    (field: ProfileFieldId, only?: { title: string; submitLabel: string }) =>
      setDialog({
        kind: 'add',
        field,
        lockField: Boolean(only),
        title: only?.title ?? 'Add a statement',
        submitLabel: only?.submitLabel ?? 'Add statement',
      }),
    [],
  );
  const edit = useCallback(
    (claim: ProfileClaim) => setDialog({ kind: 'edit', claimId: claim.id }),
    [],
  );
  const remove = useCallback(
    (claim: ProfileClaim) => setDialog({ kind: 'remove', claimId: claim.id }),
    [],
  );
  const close = useCallback(() => setDialog(null), []);

  // A dialog about a statement shows only while that statement is still there.
  const editing = dialog?.kind === 'edit' ? index.get(dialog.claimId) : undefined;
  const removing = dialog?.kind === 'remove' ? index.get(dialog.claimId) : undefined;

  const dialogs = (
    <>
      {dialog?.kind === 'add' && (
        <AddStatementDialog
          title={dialog.title}
          submitLabel={dialog.submitLabel}
          field={dialog.field}
          lockField={dialog.lockField}
          onClose={close}
          onSaved={(result, input) => {
            const added = addedClaims(profile, result)[0];
            // Main leaves out a passage it cannot match to its document. Say so
            // beside the statement rather than let it pass unnoticed.
            const leftOut = added ? leftOutNote(input.evidence.length, added.citations.length) : '';
            const listed = added
              ? `Statement added. It is listed as ${CLAIM_STATUS[added.status].label.toLowerCase()}.`
              : 'Statement added.';
            close();
            setNote(added && leftOut ? { claimId: added.id, tone: 'caution', message: leftOut } : null);
            settle(
              result,
              { claimId: added?.id ?? null, field: added?.field ?? input.field },
              leftOut ? `${listed} ${leftOut}` : listed,
            );
          }}
        />
      )}
      {editing && (
        <EditStatementDialog
          claim={editing}
          onClose={close}
          onSaved={(result) => {
            close();
            setNote(null);
            settle(result, { claimId: editing.id, field: editing.field }, 'Statement saved.');
          }}
        />
      )}
      {removing && (
        <RemoveStatementDialog
          claim={removing}
          onClose={close}
          onRemoved={(result) => {
            close();
            setNote(null);
            settle(result, { claimId: removing.id, field: removing.field }, 'Statement removed.');
          }}
        />
      )}
    </>
  );

  return {
    canManage,
    canApprove,
    index,
    pending,
    note,
    approve,
    reject,
    add,
    edit,
    remove,
    rootRef,
    dialogs,
  };
}
