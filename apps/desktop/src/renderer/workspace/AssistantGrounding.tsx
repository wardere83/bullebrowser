import { openWorkspace, useWorkspaceStore } from '../state/workspace-store.js';
import { groundingLabel, groundingOf, profileStateText } from './setup.js';
import { Icon, type IconName } from './ui/icons.js';

/**
 * The line under the assistant panel's header that names what the assistant's
 * guidance rests on: the active organization and whether its profile has been
 * approved, or that there is no organization yet. It is a link to the place
 * where that can be changed.
 *
 * It reads the workspace store, which funding events keep up to date, and
 * shows only what the store has confirmed for the active organization: after a
 * switch the new name appears at once and the profile's state only when it is
 * known, so a previous organization's name or state never lingers.
 *
 * It is drawn inside the assistant panel, so it uses the panel's palette (the
 * `text-ink-*` utilities the panel re-maps), not the workspace's.
 */
export function AssistantGrounding() {
  const identity = useWorkspaceStore((state) => state.identity);
  const identityStatus = useWorkspaceStore((state) => state.identityStatus);
  const setup = useWorkspaceStore((state) => state.setup);
  const grounding = groundingOf({ identity, identityStatus, setup });

  // Keeps its height while identity loads, so the panel does not jump.
  if (grounding.kind === 'loading') return <div aria-hidden="true" className="-mt-1.5 h-6" />;

  const profileState = profileStateText(grounding);
  const icon: IconName =
    grounding.kind !== 'organization'
      ? 'info'
      : grounding.profile === 'approved'
        ? 'check-circle'
        : grounding.profile === 'not_approved'
          ? 'circle-dashed'
          : 'building';

  const open = () => {
    if (grounding.kind === 'organization') void openWorkspace('knowledge', { tab: 'profile' });
    else void openWorkspace('knowledge');
  };

  return (
    <div className="-mt-1.5 flex h-6 items-start px-4">
      <button
        type="button"
        onClick={open}
        aria-label={groundingLabel(grounding)}
        className="flex min-w-0 max-w-full items-center gap-1.5 rounded text-left text-[11px] leading-4 text-ink-secondary transition-colors hover:text-ink-primary"
      >
        <Icon
          name={icon}
          size={12}
          className={
            grounding.kind === 'organization' && grounding.profile === 'approved'
              ? 'text-primary'
              : undefined
          }
        />
        {grounding.kind === 'organization' ? (
          <>
            <span className="shrink-0">Grounded in</span>
            <span className="min-w-0 truncate font-medium text-ink-primary">{grounding.name}</span>
            {profileState && <span className="shrink-0">· {profileState}</span>}
          </>
        ) : (
          <span className="truncate">
            {grounding.kind === 'none' ? 'No organization yet' : 'Organization unavailable'}
          </span>
        )}
      </button>
    </div>
  );
}
