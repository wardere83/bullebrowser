import { useEffect, type ButtonHTMLAttributes, type Ref } from 'react';
import { announce } from './announce.js';
import { Icon, Spinner, type IconName } from './icons.js';
import { button, cx } from './styles.js';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  /** primary: the one main action of a view. secondary: any other. quiet: low-key, text only. danger: deletes something. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** The action is under way: the button keeps its width, shows progress and ignores clicks. */
  busy?: boolean;
  /** What is read out when the button goes busy, for example "Saving". */
  busyLabel?: string;
  /** An icon before the label. */
  icon?: IconName;
  /** An icon after the label. */
  trailingIcon?: IconName;
  /** "submit" sends the form the button is in, or the one named by `form`. */
  type?: 'button' | 'submit';
  /** Fills the width of its container. */
  block?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

/**
 * The workspace's button. Use `primary` once per view for the main action,
 * `secondary` for the others, `quiet` for low-key actions that sit in text or
 * a toolbar, and `danger` only for the button that actually deletes. While
 * `busy` it keeps its width, stays focusable, ignores clicks and says its
 * `busyLabel` to assistive technology.
 *
 * Its label must not be one the app already uses elsewhere; see the reserved
 * names in reserved.test.ts ("Not now", "Back", "Keep" and "Discard" are the
 * words for backing out).
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  busy = false,
  busyLabel = 'Working',
  icon,
  trailingIcon,
  type = 'button',
  block = false,
  className,
  children,
  onClick,
  ref,
  ...rest
}: ButtonProps) {
  useEffect(() => {
    if (busy) announce(busyLabel);
  }, [busy, busyLabel]);

  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      aria-busy={busy || undefined}
      // Busy is not `disabled`: a disabled button drops out of the tab order,
      // and focus would be lost in the middle of the action.
      aria-disabled={busy || undefined}
      onClick={(event) => {
        if (busy) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      className={cx(
        button.base,
        button.size[size],
        button.variant[variant],
        block && 'w-full',
        className,
      )}
    >
      {/* Kept in place and merely made transparent while busy, so the button
          neither changes width nor loses its name. */}
      <span className={cx('inline-flex items-center gap-2', busy && 'opacity-0')}>
        {icon && <Icon name={icon} />}
        {children}
        {trailingIcon && <Icon name={trailingIcon} />}
      </span>
      {busy && (
        <span className="absolute inset-0 grid place-items-center">
          <Spinner />
        </span>
      )}
    </button>
  );
}
