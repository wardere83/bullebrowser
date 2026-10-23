import { useId, type ReactNode, type Ref } from 'react';
import { Icon } from './icons.js';
import { control, cx } from './styles.js';

export interface CheckboxProps {
  /** The visible label; clicking it toggles the box. */
  label: ReactNode;
  /** Help shown under the label. */
  hint?: ReactNode;
  /** What is wrong, shown under the label and read out. */
  error?: string | null;
  checked: boolean;
  onChange(checked: boolean): void;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  ref?: Ref<HTMLInputElement>;
  className?: string;
}

/**
 * One yes-or-no choice with its label, for a setting or a filter that takes
 * effect on its own, and for an acknowledgement a person must tick. For a
 * choice between named options use RadioGroup.
 */
export function Checkbox({
  label,
  hint,
  error,
  checked,
  onChange,
  disabled,
  required,
  name,
  ref,
  className,
}: CheckboxProps) {
  const baseId = useId();
  const hintId = `${baseId}-hint`;
  const errorId = `${baseId}-error`;
  const describedBy =
    [hint ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cx('flex min-w-0 flex-col gap-1', className)}>
      <label
        className={cx(
          'flex items-start gap-2.5 text-sm leading-5 text-ink-inverse/85',
          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        )}
      >
        <span className="relative mt-0.5 inline-flex h-4 w-4 shrink-0">
          <input
            ref={ref}
            type="checkbox"
            name={name}
            checked={checked}
            disabled={disabled}
            required={required}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            onChange={(event) => onChange(event.target.checked)}
            className={cx(control.choice, 'rounded', error && 'border-red-400')}
          />
          <Icon
            name="check"
            size={12}
            className="pointer-events-none absolute left-0.5 top-0.5 text-surface-dark opacity-0 peer-checked:opacity-100"
          />
        </span>
        <span className="min-w-0">{label}</span>
      </label>
      {hint && (
        <p id={hintId} className={cx(control.hint, 'pl-[1.625rem]')}>
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className={cx(control.error, 'pl-[1.625rem]')}>
          <Icon name="alert" size={14} className="mt-px" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
