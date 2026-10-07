import type { ButtonHTMLAttributes, Ref } from 'react';
import { Icon, type IconName } from './icons.js';
import { button, cx } from './styles.js';

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'type' | 'children' | 'aria-label'
> {
  /** What the button does, in words. Required: it is the button's only name. */
  label: string;
  icon: IconName;
  size?: 'sm' | 'md';
  /** quiet: no edge, for toolbars and rows. outlined: stands on its own. */
  tone?: 'quiet' | 'outlined';
  ref?: Ref<HTMLButtonElement>;
}

/**
 * A button that shows only an icon. Use it where the meaning is familiar and
 * space is tight (remove a row, open a menu). `label` is required and becomes
 * both the accessible name and the tooltip; when in doubt, use a Button with
 * words instead.
 */
export function IconButton({
  label,
  icon,
  size = 'md',
  tone = 'quiet',
  className,
  ref,
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...rest}
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cx(button.icon.base, button.icon.size[size], button.icon.tone[tone], className)}
    >
      <Icon name={icon} size={size === 'sm' ? 14 : 16} />
    </button>
  );
}
