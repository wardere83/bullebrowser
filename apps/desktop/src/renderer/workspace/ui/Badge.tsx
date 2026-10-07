import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons.js';
import { badge, cx } from './styles.js';

export type BadgeTone = keyof typeof badge.tone;

export interface BadgeProps {
  /** neutral for facts, info for something in progress, success, caution, danger. */
  tone?: BadgeTone;
  /** The shape that goes with the meaning, so the badge never relies on colour. */
  icon?: IconName;
  children: ReactNode;
  className?: string;
}

/**
 * A short label for a fact about one thing: its type, its count, its state.
 * The words carry the meaning; the tone and icon only support them. For the
 * states the funding contract defines (a listing's status, a document's
 * processing state, a claim's state) use StatusBadge, which picks the words,
 * the tone and the icon for you.
 */
export function Badge({ tone = 'neutral', icon, children, className }: BadgeProps) {
  return (
    <span className={cx(badge.base, badge.tone[tone], className)}>
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}
