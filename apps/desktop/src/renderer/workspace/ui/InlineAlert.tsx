import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons.js';
import { alert, cx } from './styles.js';

export type AlertTone = 'info' | 'success' | 'caution' | 'error';

export interface InlineAlertProps {
  /** info: worth knowing. success: something worked. caution: check before going on. error: something failed. */
  tone: AlertTone;
  /** A few words in bold before the message. */
  title?: string;
  /** The message: what happened and what to do next. */
  children?: ReactNode;
  /** One action that resolves it, usually a quiet or secondary Button such as "Try again". */
  action?: ReactNode;
  /**
   * Whether assistive technology reads the message out when it appears. On by
   * default for `error` (at once) and `success` (when the user is idle); off
   * for `info` and `caution`, which usually explain something already there.
   */
  announce?: boolean;
  className?: string;
}

const ICONS: Record<AlertTone, IconName> = {
  info: 'info',
  success: 'check-circle',
  caution: 'alert',
  error: 'x-circle',
};

/** The word that says the tone to someone who cannot see the icon or its colour. */
const SPOKEN_TONE: Record<AlertTone, string> = {
  info: 'Note',
  success: 'Done',
  caution: 'Caution',
  error: 'Error',
};

/**
 * A message that sits in the page next to what it is about: a load that
 * failed, a result, a caution before an action. It never covers content and
 * never times out. Say what happened and what to do next; offer the next step
 * as `action`. For a failed field in a form use the field's `error` instead.
 */
export function InlineAlert({
  tone,
  title,
  children,
  action,
  announce,
  className,
}: InlineAlertProps) {
  const live = announce ?? (tone === 'error' || tone === 'success');
  const role = !live ? undefined : tone === 'error' ? 'alert' : 'status';

  return (
    <div role={role} className={cx(alert.base, alert.tone[tone], className)}>
      <Icon name={ICONS[tone]} size={18} className={cx('mt-0.5', alert.icon[tone])} />
      <div className="min-w-0 flex-1">
        <span className="sr-only">{SPOKEN_TONE[tone]}: </span>
        {title && <span className="font-semibold text-ink-inverse">{title} </span>}
        {children}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
