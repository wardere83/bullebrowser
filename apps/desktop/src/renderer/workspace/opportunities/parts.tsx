// Small building blocks the Opportunities views share, made from the kit's
// class strings: a row that folds its content away, a group of checkboxes that
// answers one question, and a grid of checkboxes.

import { useId, useState, type ReactNode, type Ref } from 'react';
import { Checkbox, Icon, control, cx, text } from '../ui/index.js';

// ──────────────────────────────────── fold ────────────────────────────────────

export interface FoldProps {
  /** Names what is inside. */
  title: string;
  /** What is chosen or held inside, in a few words, so nothing is hidden by folding it. */
  summary?: ReactNode;
  /** Help for the content as a whole. */
  hint?: ReactNode;
  /** Whether it is open. Leave out to let it keep track itself, starting from `defaultOpen`. */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?(open: boolean): void;
  children: ReactNode;
  className?: string;
}

/**
 * A row that folds its content away: its title and a few words about what is
 * inside stay visible, and the rest opens in place. It is the browser's own
 * disclosure element, so Enter and Space work on it and a search of the page
 * opens it. Use it for parts of a long form that are not needed every time.
 */
export function Fold({
  title,
  summary,
  hint,
  open,
  defaultOpen = false,
  onOpenChange,
  children,
  className,
}: FoldProps) {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const hintId = `${baseId}-hint`;
  const [own, setOwn] = useState(defaultOpen);
  const isOpen = open ?? own;

  return (
    <details
      open={isOpen}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        setOwn(next);
        if (next !== isOpen) onOpenChange?.(next);
      }}
      className={cx('group/fold', className)}
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-md py-2.5 transition-colors hover:bg-white/[0.07] [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2">
          <Icon
            name="chevron-right"
            size={14}
            className="text-ink-inverse/70 transition-transform group-open/fold:rotate-90"
          />
          <span id={titleId} className={text.h3}>
            {title}
          </span>
        </span>
        {summary !== undefined && summary !== '' && (
          <span className={cx(text.caption, 'min-w-0 flex-1 basis-40 break-words pl-[22px]')}>
            {summary}
          </span>
        )}
      </summary>
      <div
        role="group"
        aria-labelledby={titleId}
        aria-describedby={hint ? hintId : undefined}
        className="flex flex-col gap-3 pb-4 pl-[22px] pt-1"
      >
        {hint && (
          <p id={hintId} className={control.hint}>
            {hint}
          </p>
        )}
        {children}
      </div>
    </details>
  );
}

// ─────────────────────────────── groups of choices ─────────────────────────────

export interface ChoiceFieldsetProps {
  /** The question the choices answer. */
  legend: string;
  hint?: ReactNode;
  /** What is wrong with the choice as a whole, in words that say how to fix it. */
  error?: string | null;
  children: ReactNode;
  className?: string;
}

/**
 * Choices that answer one question, under a legend, with a hint and an error
 * that belong to the group. The kit's Fieldset has no error of its own, and a
 * rule such as "choose at least one" is about the group, not about one box.
 */
export function ChoiceFieldset({ legend, hint, error, children, className }: ChoiceFieldsetProps) {
  const baseId = useId();
  const hintId = `${baseId}-hint`;
  const errorId = `${baseId}-error`;
  const describedBy = [hint ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ');

  return (
    <fieldset
      aria-describedby={describedBy || undefined}
      className={cx('flex min-w-0 flex-col gap-2.5', className)}
    >
      <legend className={cx(text.h3, 'mb-1')}>{legend}</legend>
      {hint && (
        <p id={hintId} className={control.hint}>
          {hint}
        </p>
      )}
      {children}
      {error && (
        <p id={errorId} role="alert" className={control.error}>
          <Icon name="alert" size={14} className="mt-px" />
          <span>{error}</span>
        </p>
      )}
    </fieldset>
  );
}

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  /** A line under the label saying what the choice means. */
  hint?: ReactNode;
}

export interface ChoiceGridProps<T extends string> {
  options: readonly ChoiceOption<T>[];
  chosen: readonly T[];
  onToggle(value: T, on: boolean): void;
  /** One choice to a line, for choices that carry an explanation. */
  stacked?: boolean;
  /** Receives the first box, so a form can move focus here when the choice is missing. */
  firstRef?: Ref<HTMLInputElement>;
}

/** A set of checkboxes: side by side where there is room, or one to a line. */
export function ChoiceGrid<T extends string>({
  options,
  chosen,
  onToggle,
  stacked = false,
  firstRef,
}: ChoiceGridProps<T>) {
  return (
    <div
      className={
        stacked
          ? 'flex flex-col gap-3'
          : 'grid gap-x-5 gap-y-2.5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,12.5rem),1fr))]'
      }
    >
      {options.map((option, index) => (
        <Checkbox
          key={option.value}
          ref={index === 0 ? firstRef : undefined}
          label={option.label}
          hint={option.hint}
          checked={chosen.includes(option.value)}
          onChange={(on) => onToggle(option.value, on)}
        />
      ))}
    </div>
  );
}
