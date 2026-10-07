import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ORGANIZATION_KIND_LABELS,
  type IdentityState,
  type Organization,
} from '../../shared/funding.js';
import { toCallError } from '../lib/funding-client.js';
import { activeOrganization, useWorkspaceStore } from '../state/workspace-store.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import {
  CONTENT_MAX_WIDTH,
  GUTTER_CLASS,
  RAIL_WIDTH,
  WorkspaceLayoutProvider,
  layoutFor,
  useElementWidth,
  type WorkspaceLayout,
} from './layout.js';
import { OrganizationSwitcher } from './OrganizationSwitcher.js';
import { routeDefinition } from './routes.js';
import { Onboarding } from './screens/Onboarding.js';
import { Announcer } from './ui/Announcer.js';
import {
  Button,
  Icon,
  InlineAlert,
  LoadingBlock,
  SectionHeading,
  announce,
  card,
  cx,
  text,
} from './ui/index.js';
import { SetupIndicator, WorkspaceNav } from './WorkspaceNav.js';

/**
 * Funding tools shown only in an explicitly opened funding tab. They show,
 * in order of what is known: a loading
 * state, an error with a way to try again, the first-run steps when there is
 * no organization, and otherwise the navigation with the current screen.
 *
 * It stays mounted while a web page is in front (`visible` is false) and is
 * only hidden, so a half-filled form or a list of results is still there when
 * the user comes back to the tab. Hidden means `display: none`: nothing in it
 * can be focused or is read out.
 */
export function Workspace({ visible }: { visible: boolean }) {
  const identity = useWorkspaceStore((state) => state.identity);
  const identityStatus = useWorkspaceStore((state) => state.identityStatus);
  const identityError = useWorkspaceStore((state) => state.identityError);
  const onboardingOrganizationId = useWorkspaceStore((state) => state.onboardingOrganizationId);
  const refreshIdentity = useWorkspaceStore((state) => state.refreshIdentity);
  const [rootRef, slotWidth] = useElementWidth<HTMLElement>();
  const layout = layoutFor(slotWidth);
  const organization = activeOrganization(identity);

  const view: View = !identity
    ? identityStatus === 'error'
      ? 'error'
      : 'loading'
    : !organization && identity.organizations.length > 0
      ? 'choose'
      : !organization || onboardingOrganizationId === organization.id
        ? 'onboarding'
        : 'shell';

  // When the user's own action replaces one view with another (finishing the
  // first-run steps, "Try again", deleting the last organization), the control
  // they used is gone and focus with it. Put it on the new view's heading.
  // Not when the app is starting: nobody asked for that, and the assistant's
  // composer has focus then.
  const settledView = useRef<View | null>(view === 'loading' ? null : view);
  useEffect(() => {
    if (view === 'loading') return;
    const previous = settledView.current;
    settledView.current = view;
    if (previous === null || previous === view) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    rootRef.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  }, [view, rootRef]);

  let body: ReactNode;
  if (view === 'loading' || view === 'error') {
    body = (
      <Standalone layout={layout}>
        {identityStatus === 'error' ? (
          <LoadFailed
            message={identityError?.message ?? 'The workspace could not be loaded.'}
            onRetry={() => void refreshIdentity()}
          />
        ) : (
          <div className="mx-auto w-full max-w-[36rem] pt-6">
            <LoadingBlock label="Loading the workspace" lines={4} />
          </div>
        )}
      </Standalone>
    );
  } else if (view === 'choose' && identity) {
    body = (
      <Standalone layout={layout}>
        <ChooseOrganization identity={identity} />
      </Standalone>
    );
  } else if (view === 'shell' && organization) {
    body = <Shell organization={organization} layout={layout} />;
  } else {
    // One element whether or not the organization exists yet, so the steps
    // keep their place when the one created in step one becomes active.
    body = (
      <Standalone layout={layout}>
        <Onboarding />
      </Standalone>
    );
  }

  return (
    <section
      ref={rootRef}
      aria-label="Funding workspace"
      hidden={!visible}
      data-size={layout.size}
      // `hidden` alone would lose to the `flex` class, so the class is swapped too.
      className={cx(
        'workspace h-full min-w-0 bg-surface-dark text-ink-inverse',
        visible ? 'flex' : 'hidden',
        layout.size === 'compact' ? 'flex-col' : 'flex-row',
      )}
    >
      <WorkspaceLayoutProvider value={layout}>
        {body}
        <Announcer />
      </WorkspaceLayoutProvider>
    </section>
  );
}

type View = 'loading' | 'error' | 'choose' | 'onboarding' | 'shell';

/** A view without the navigation: loading, an error, choosing an organization, the first-run steps. */
function Standalone({ layout, children }: { layout: WorkspaceLayout; children: ReactNode }) {
  return (
    <div
      // Where focus goes when a dialog or menu closes and its opener is gone; see ui/focus.ts.
      data-workspace-focus-fallback=""
      tabIndex={-1}
      className={cx(
        'selectable min-h-0 min-w-0 flex-1 overflow-y-auto py-8',
        GUTTER_CLASS[layout.size],
      )}
    >
      {children}
    </div>
  );
}

function LoadFailed({ message, onRetry }: { message: string; onRetry(): void }) {
  return (
    <div className="mx-auto flex w-full max-w-[36rem] flex-col gap-5 pt-6">
      <SectionHeading
        level={1}
        title="The workspace could not be loaded"
        description="Nothing you have stored is affected. Browsing and the assistant still work; the workspace will open as soon as it can be read."
      />
      <InlineAlert
        tone="error"
        action={
          <Button size="sm" onClick={onRetry}>
            Try again
          </Button>
        }
      >
        {message}
      </InlineAlert>
    </div>
  );
}

/** Organizations exist but none is active, for example after the active one was deleted elsewhere. */
function ChooseOrganization({ identity }: { identity: IdentityState }) {
  const switchOrganization = useWorkspaceStore((state) => state.switchOrganization);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = async (organization: Organization) => {
    if (pending) return;
    setPending(organization.id);
    setError(null);
    try {
      await switchOrganization(organization.id);
    } catch (failure) {
      setError(toCallError(failure).message);
      setPending(null);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-[36rem] flex-col gap-5 pt-6">
      <SectionHeading
        level={1}
        title="Choose an organization"
        description="Pick the organization you want to work in. Each one keeps its own documents, profile and funding work."
      />
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      <ul className="flex flex-col gap-2">
        {identity.organizations.map((organization) => (
          <li key={organization.id}>
            <button
              type="button"
              aria-busy={pending === organization.id || undefined}
              onClick={() => void choose(organization)}
              className={cx(card.interactive, 'flex w-full items-center gap-3 px-4 py-3')}
            >
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.07] text-primary">
                <Icon name="building" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block break-words text-sm font-semibold leading-5 text-ink-inverse">
                  {organization.name}
                </span>
                <span className={cx(text.caption, 'block')}>
                  {ORGANIZATION_KIND_LABELS[organization.kind]}
                </span>
              </span>
              <Icon name="chevron-right" className="text-ink-inverse/70" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The navigation and the current screen, for an active organization. */
function Shell({ organization, layout }: { organization: Organization; layout: WorkspaceLayout }) {
  const route = useWorkspaceStore((state) => state.route);
  const visit = useWorkspaceStore((state) => state.visit);
  const contentRef = useRef<HTMLDivElement>(null);
  const definition = routeDefinition(route);
  const CurrentScreen = definition.component;
  const compact = layout.size === 'compact';

  // A screen has just been opened. Start it from the top and say so: move focus
  // to its heading when the control that opened it is gone (a card on the
  // screen that was replaced), and otherwise leave focus where it is (on the
  // navigation, the top bar, the assistant) and announce the screen instead.
  const shown = useRef({ visit, organizationId: organization.id });
  useEffect(() => {
    const previous = shown.current;
    if (previous.visit === visit) return;
    shown.current = { visit, organizationId: organization.id };
    const content = contentRef.current;
    if (!content) return;
    content.scrollTo({ top: 0 });
    const active = document.activeElement;
    if (!active || active === document.body) {
      (content.querySelector<HTMLElement>('h1') ?? content).focus({ preventScroll: true });
    } else if (previous.organizationId === organization.id) {
      // A change of organization is announced by whatever made it.
      announce(definition.label);
    }
  }, [visit, organization.id, definition.label]);

  // The structure is the same in both layouts and only the classes differ, so
  // the organization switcher and the screen keep their state (an open dialog,
  // a half-filled form) when the window is resized across the breakpoint.
  return (
    <>
      <div
        className={
          compact
            ? 'shrink-0 border-b border-white/10 px-4 pt-3'
            : 'flex shrink-0 flex-col gap-3 border-r border-white/10 px-2 py-3'
        }
        style={
          compact ? undefined : { width: RAIL_WIDTH[layout.size === 'wide' ? 'wide' : 'regular'] }
        }
      >
        <div className={cx(compact && 'flex items-center justify-between gap-3')}>
          <OrganizationSwitcher compact={compact} />
          {compact && <SetupIndicator className="w-40 shrink-0" />}
        </div>
        <div className={cx(compact && 'mt-2')}>
          <WorkspaceNav orientation={compact ? 'row' : 'rail'} />
        </div>
        {!compact && <SetupIndicator separated />}
      </div>

      <div
        ref={contentRef}
        // Where focus goes when a dialog or menu closes and its opener is gone; see ui/focus.ts.
        data-workspace-focus-fallback=""
        tabIndex={-1}
        className="selectable min-h-0 min-w-0 flex-1 overflow-y-auto"
      >
        <div
          className={cx('mx-auto w-full', compact ? 'py-5' : 'py-7', GUTTER_CLASS[layout.size])}
          style={{ maxWidth: CONTENT_MAX_WIDTH }}
        >
          {/* A new screen for every route, and for every organization: whatever
              a screen was holding is dropped when the organization changes. */}
          <ErrorBoundary what="This screen" resetKey={`${organization.id}:${route}:${visit}`}>
            <CurrentScreen key={`${organization.id}:${route}`} />
          </ErrorBoundary>
        </div>
      </div>
    </>
  );
}
