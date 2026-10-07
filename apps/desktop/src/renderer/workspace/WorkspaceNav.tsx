import { useEffect, useRef } from 'react';
import { useWorkspaceStore } from '../state/workspace-store.js';
import { ROUTES } from './routes.js';
import { setupProgress } from './setup.js';
import { Icon, cx } from './ui/index.js';
import { nav as styles } from './ui/styles.js';

/**
 * The workspace's navigation: the four screens, in a rail beside the content
 * or, when the slot is narrow, in one row above it that scrolls sideways. The
 * current screen is marked with aria-current="page" as well as by its look.
 */
export function WorkspaceNav({ orientation }: { orientation: 'rail' | 'row' }) {
  const route = useWorkspaceStore((state) => state.route);
  const navigate = useWorkspaceStore((state) => state.navigate);
  const currentRef = useRef<HTMLButtonElement>(null);

  // In the row, the current screen's name must not be left scrolled out of view.
  useEffect(() => {
    if (orientation === 'row') {
      currentRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [route, orientation]);

  const row = orientation === 'row';

  return (
    <nav
      aria-label="Workspace"
      className={cx(row && 'workspace-nav-row -mx-4 overflow-x-auto px-4')}
    >
      <ul className={cx('flex', row ? 'gap-1' : 'flex-col gap-0.5')}>
        {ROUTES.map((definition) => {
          const current = definition.route === route;
          return (
            <li key={definition.route} className={cx(row && 'shrink-0')}>
              <button
                ref={current ? currentRef : undefined}
                type="button"
                aria-current={current ? 'page' : undefined}
                onClick={() => navigate(definition.route)}
                className={
                  row
                    ? cx(styles.pill, current ? styles.pillCurrent : styles.pillIdle)
                    : cx(styles.item, current ? styles.current : styles.idle)
                }
              >
                <Icon name={definition.icon} className={cx(current && 'text-primary')} />
                <span className={cx(!row && 'min-w-0 flex-1 text-balance')}>
                  {definition.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * "Profile setup: 3 of 5", with the steps drawn as segments. Until setup is
 * complete it is a link to the Organization Knowledge Hub, where the remaining
 * steps are done; after that it is a plain statement.
 */
export function SetupIndicator({
  className,
  separated = false,
}: {
  className?: string;
  /** Draws a hairline above it, for when it sits under the navigation in the rail. */
  separated?: boolean;
}) {
  const setup = useWorkspaceStore((state) => state.setup);
  const navigate = useWorkspaceStore((state) => state.navigate);
  if (!setup) return null;

  const progress = setupProgress(setup);
  const segments = (
    <span aria-hidden="true" className="flex gap-1">
      {Array.from({ length: progress.total }, (_, index) => (
        <span
          key={index}
          className={cx(
            'h-1 flex-1 rounded-full',
            index < progress.completed ? 'bg-primary' : 'bg-white/[0.16]',
          )}
        />
      ))}
    </span>
  );

  const indicator = progress.complete ? (
    <div className={cx('flex flex-col gap-1.5 px-2 py-1.5', className)}>
      <span className="flex items-center gap-1.5 text-xs leading-4 text-ink-inverse/70">
        <Icon name="check-circle" size={14} className="text-emerald-300" />
        Profile setup complete
      </span>
      {segments}
    </div>
  ) : (
    <button
      type="button"
      onClick={() => navigate('knowledge')}
      className={cx(
        'flex flex-col gap-1.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.07]',
        // In the rail it fills the width; in the compact header the caller sizes it.
        separated && 'w-full',
        className,
      )}
    >
      <span className="flex items-center justify-between gap-2 text-xs leading-4 text-ink-inverse/70">
        <span>{progress.label}</span>
        <Icon name="chevron-right" size={12} />
      </span>
      {segments}
      <span className="sr-only">Open the Organization Knowledge Hub to continue</span>
    </button>
  );

  return separated ? <div className="border-t border-white/10 pt-3">{indicator}</div> : indicator;
}
