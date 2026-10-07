import { useId, useState } from 'react';
import { ORGANIZATION_KIND_LABELS, type Organization } from '../../shared/funding.js';
import { toCallError } from '../lib/funding-client.js';
import { activeOrganization, hasPermission, useWorkspaceStore } from '../state/workspace-store.js';
import { OrganizationForm } from './OrganizationForm.js';
import {
  ROLE_LABELS,
  changedOrganizationFields,
  confirmsOrganizationName,
} from './organization.js';
import {
  Dialog,
  Field,
  Icon,
  InlineAlert,
  Input,
  Menu,
  announce,
  cx,
  text,
  type MenuSection,
} from './ui/index.js';

type OpenDialog =
  | { kind: 'add' }
  // Tied to the organization they were opened for: when another becomes
  // active, a dialog about the previous one is no longer shown.
  | { kind: 'details'; organizationId: string }
  | { kind: 'delete'; organizationId: string };

/**
 * Shows which organization is active and lets the user switch to another, add
 * one, see or edit its details and, as an owner, delete it. Switching resets
 * the workspace to the dashboard; nothing from the previous organization stays
 * on screen (the store sees to that).
 */
export function OrganizationSwitcher({ compact = false }: { compact?: boolean }) {
  const identity = useWorkspaceStore((state) => state.identity);
  const switchOrganization = useWorkspaceStore((state) => state.switchOrganization);
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const organization = activeOrganization(identity);
  if (!identity || !organization) return null;

  const kindLabel = ORGANIZATION_KIND_LABELS[organization.kind];
  const isOwner = identity.session.role === 'owner';
  const close = () => setDialog(null);

  const choose = async (target: Organization) => {
    setSwitchError(null);
    if (target.id === organization.id) return;
    try {
      await switchOrganization(target.id);
      announce(`Now working in ${target.name}.`);
    } catch (error) {
      setSwitchError(toCallError(error).message);
    }
  };

  const sections: MenuSection[] = [
    {
      id: 'organizations',
      label: 'Organizations',
      items: identity.organizations.map((entry) => ({
        id: entry.id,
        label: entry.name,
        description: ORGANIZATION_KIND_LABELS[entry.kind],
        kind: 'choice' as const,
        checked: entry.id === organization.id,
        onSelect: () => void choose(entry),
      })),
    },
    {
      id: 'manage',
      items: [
        {
          id: 'add',
          label: 'Add an organization',
          icon: 'plus' as const,
          onSelect: () => setDialog({ kind: 'add' }),
        },
        {
          id: 'details',
          label: 'Organization details',
          icon: 'sliders' as const,
          onSelect: () => setDialog({ kind: 'details', organizationId: organization.id }),
        },
        ...(isOwner
          ? [
              {
                id: 'delete',
                label: 'Delete this organization…',
                icon: 'trash' as const,
                tone: 'danger' as const,
                onSelect: () => setDialog({ kind: 'delete', organizationId: organization.id }),
              },
            ]
          : []),
      ],
    },
  ];

  const forThisOrganization =
    dialog && dialog.kind !== 'add' && dialog.organizationId === organization.id
      ? dialog.kind
      : null;

  return (
    <div className={cx('min-w-0', compact && 'max-w-[17rem]')}>
      <Menu
        label="Organization"
        triggerLabel={`Organization: ${organization.name}, ${kindLabel}. Switch or manage organizations`}
        triggerClassName="flex w-full items-center gap-2.5 rounded-lg border border-white/40 px-2 py-1.5 text-left transition-colors hover:bg-white/10"
        width={288}
        sections={sections}
        trigger={
          <>
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.07] text-primary">
              <Icon name="building" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold leading-5 text-ink-inverse">
                {organization.name}
              </span>
              <span className="block text-xs leading-4 text-ink-inverse/60">{kindLabel}</span>
            </span>
            <Icon name="chevron-down" size={14} className="text-ink-inverse/70" />
          </>
        }
      />
      {switchError && (
        <p role="alert" className="mt-1.5 flex items-start gap-1.5 text-xs leading-4 text-red-300">
          <Icon name="alert" size={14} className="mt-px" />
          <span>{switchError}</span>
        </p>
      )}

      {dialog?.kind === 'add' && <AddOrganizationDialog onClose={close} />}
      {forThisOrganization === 'details' && (
        <OrganizationDetailsDialog
          organization={organization}
          canManage={hasPermission(identity, 'organization.manage')}
          roleLabel={identity.session.role ? ROLE_LABELS[identity.session.role] : null}
          onClose={close}
        />
      )}
      {forThisOrganization === 'delete' && (
        <DeleteOrganizationDialog organization={organization} onClose={close} />
      )}
    </div>
  );
}

function AddOrganizationDialog({ onClose }: { onClose(): void }) {
  const formId = useId();
  const createOrganization = useWorkspaceStore((state) => state.createOrganization);
  const [busy, setBusy] = useState(false);

  return (
    <Dialog
      open
      onClose={onClose}
      title="Add an organization"
      description="Each organization keeps its own documents, profile, funding documents and guides. Nothing is shared between them."
      primaryAction={{
        label: 'Create organization',
        form: formId,
        busy,
        busyLabel: 'Creating organization',
      }}
      secondaryAction={{ label: 'Not now', disabled: busy }}
      dismissable={!busy}
    >
      <OrganizationForm
        id={formId}
        onBusyChange={setBusy}
        onSubmit={async (input) => {
          await createOrganization(input);
          announce(`${input.name} was created. You are now working in it.`);
          onClose();
        }}
      />
    </Dialog>
  );
}

function OrganizationDetailsDialog({
  organization,
  canManage,
  roleLabel,
  onClose,
}: {
  organization: Organization;
  canManage: boolean;
  roleLabel: string | null;
  onClose(): void;
}) {
  const formId = useId();
  const updateOrganization = useWorkspaceStore((state) => state.updateOrganization);
  const [busy, setBusy] = useState(false);

  return (
    <Dialog
      open
      onClose={onClose}
      title="Organization details"
      description="The name, type and location BulleBrowser uses for this organization."
      primaryAction={
        canManage
          ? { label: 'Save changes', form: formId, busy, busyLabel: 'Saving changes' }
          : undefined
      }
      secondaryAction={{ label: 'Back', disabled: busy }}
      dismissable={!busy}
    >
      <div className="flex flex-col gap-4">
        {!canManage && (
          <InlineAlert tone="info">
            Only an owner can change an organization’s name, type or location.
            {roleLabel ? ` Your role here is ${roleLabel}.` : ''}
          </InlineAlert>
        )}
        <OrganizationForm
          id={formId}
          organization={organization}
          disabled={!canManage}
          onBusyChange={setBusy}
          onSubmit={async (input) => {
            const patch = changedOrganizationFields(organization, input);
            if (Object.keys(patch).length > 0) {
              await updateOrganization(organization.id, patch);
              announce('Organization details saved.');
            }
            onClose();
          }}
        />
      </div>
    </Dialog>
  );
}

function DeleteOrganizationDialog({
  organization,
  onClose,
}: {
  organization: Organization;
  onClose(): void;
}) {
  const deleteOrganization = useWorkspaceStore((state) => state.deleteOrganization);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = confirmsOrganizationName(typed, organization.name);

  const remove = async () => {
    if (!confirmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteOrganization(organization.id);
      announce(`${organization.name} was deleted.`);
      onClose();
    } catch (failure) {
      setError(toCallError(failure).message);
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Delete ${organization.name}?`}
      primaryAction={{
        label: 'Delete organization',
        variant: 'danger',
        disabled: !confirmed,
        busy,
        busyLabel: 'Deleting organization',
        onClick: () => void remove(),
      }}
      secondaryAction={{ label: 'Keep organization', disabled: busy }}
      dismissable={!busy}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void remove();
        }}
      >
        <p className={text.body}>
          Every document, profile, funding document, analysis and guide that{' '}
          <strong className="font-semibold text-ink-inverse">{organization.name}</strong> holds on
          this device will be deleted. This cannot be undone.
        </p>
        <Field label={`Type “${organization.name}” to confirm`}>
          <Input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
          />
        </Field>
        {error && <InlineAlert tone="error">{error}</InlineAlert>}
      </form>
    </Dialog>
  );
}
