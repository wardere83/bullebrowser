import { useId, type ReactNode, type Ref } from 'react';
import { Icon } from './icons.js';
import { control, cx } from './styles.js';

export interface RadioOption<T extends string> {
  value: T;
  label: string;
  /** A short line under the label. */
  description?: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps<T extends string> {
  /** The question the options answer. Always visible. */
  label: string;
  options: readonly RadioOption<T>[];
  /** The chosen value, or null when nothing is chosen yet. */
  value: T | null;
  onChange(value: T): void;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  disabled?: boolean;
  /** Side by side (the default, wrapping when narrow) or stacked. */
  direction?: 'row' | 'column';
  /** Receives the first option, so a form can move focus here when the choice is missing. */
  firstOptionRef?: Ref<HTMLInputElement>;
  className?: string;
}

/**
 * A choice of exactly one from a few named options, all visible at once. Each
 * option is a real radio button, so the arrow keys move between them and Tab
 * moves past the group. Use it for two to five options; use Select for more.
 */
export function RadioGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  hint,
  error,
  required,
  disabled,
  direction = 'row',
  firstOptionRef,
  className,
}: RadioGroupProps<T>) {
  const baseId = useId();
  const labelId = `${baseId}-label`;
  const hintId = `${baseId}-hint`;
  const errorId = `${baseId}-error`;
  const describedBy =
    [hint ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined;

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelId}
      aria-describedby={describedBy}
      aria-required={required || undefined}
      aria-invalid={error ? true : undefined}
      className={cx('flex min-w-0 flex-col gap-1.5', className)}
    >
      <div id={labelId} className={control.label}>
        {label}
      </div>
      <div className={cx('flex gap-2', direction === 'row' ? 'flex-wrap' : 'flex-col')}>
        {options.map((option, index) => (
          <label
            key={option.value}
            className={cx(control.option, direction === 'row' && 'min-w-[9rem] flex-1')}
          >
            <span className="relative mt-0.5 inline-flex h-4 w-4 shrink-0">
              <input
                ref={index === 0 ? firstOptionRef : undefined}
                type="radio"
                name={baseId}
                value={option.value}
                checked={value === option.value}
                disabled={disabled || option.disabled}
                onChange={() => onChange(option.value)}
                className={cx(control.choice, 'rounded-full')}
              />
              <span className="pointer-events-none absolute left-1 top-1 h-2 w-2 rounded-full bg-surface-dark opacity-0 peer-checked:opacity-100" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium leading-5 text-ink-inverse">
                {option.label}
              </span>
              {option.description && (
                <span className="mt-0.5 block text-xs leading-4 text-ink-inverse/70">
                  {option.description}
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
      {hint && (
        <p id={hintId} className={control.hint}>
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className={control.error}>
          <Icon name="alert" size={14} className="mt-px" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
