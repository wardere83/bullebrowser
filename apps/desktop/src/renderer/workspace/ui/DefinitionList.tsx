import type { ReactNode } from 'react';
import { cx, text } from './styles.js';

/** Wraps DefinitionRows. Renders the `<dl>` they need around them. */
export function DefinitionList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <dl className={cx('flex flex-col gap-2.5', className)}>{children}</dl>;
}

export interface DefinitionRowProps {
  /** The name of the fact: "Deadline", "Award amount". */
  term: ReactNode;
  /** The fact. Say "Not stated" rather than leaving it empty. */
  children: ReactNode;
  /** Side by side (the default; stacks by itself when narrow) or always stacked. */
  direction?: 'row' | 'column';
  className?: string;
}

/**
 * One labelled fact, for the details of a listing, a document or an
 * organization. Put rows inside a DefinitionList. Prefer it to a table when
 * each fact has one value; when a source does not state something, the row
 * stays and says so.
 */
export function DefinitionRow({
  term,
  children,
  direction = 'row',
  className,
}: DefinitionRowProps) {
  return (
    <div
      className={cx(
        direction === 'row'
          ? 'flex flex-wrap items-baseline gap-x-4 gap-y-0.5'
          : 'flex flex-col gap-0.5',
        className,
      )}
    >
      <dt className={cx(text.caption, direction === 'row' && 'w-36 shrink-0')}>{term}</dt>
      <dd className="min-w-0 flex-1 basis-48 break-words text-sm leading-5 text-ink-inverse/85">
        {children}
      </dd>
    </div>
  );
}
