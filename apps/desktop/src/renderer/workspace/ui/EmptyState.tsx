import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons.js';
import { cx, text } from './styles.js';

export interface EmptyStateProps {
  /** What is missing, in a few words: "No saved opportunities yet". */
  title: string;
  /** Why it is empty and what will appear here. */
  body?: ReactNode;
  /** The one thing to do about it, usually a Button. */
  action?: ReactNode;
  icon?: IconName;
  className?: string;
}

/**
 * What a list, a card or a screen shows when it has nothing to show yet. It
 * says so plainly, explains what would appear, and offers the next step. It is
 * for "nothing yet", not for "could not load": a failure is an InlineAlert with
 * a way to try again.
 */
export function EmptyState({ title, body, action, icon, className }: EmptyStateProps) {
  return (
    <div className={cx('flex flex-col items-start gap-3 py-2', className)}>
      {icon && (
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.07] text-ink-inverse/70">
          <Icon name={icon} size={18} />
        </span>
      )}
      <div className="min-w-0">
        <p className="text-sm font-medium leading-5 text-ink-inverse">{title}</p>
        {body && <p className={cx(text.small, 'mt-1 max-w-[60ch]')}>{body}</p>}
      </div>
      {action}
    </div>
  );
}
