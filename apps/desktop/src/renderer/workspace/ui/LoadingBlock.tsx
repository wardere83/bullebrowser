import { cx, skeleton } from './styles.js';

export interface LoadingBlockProps {
  /** What is loading, for assistive technology: "Loading saved opportunities". */
  label: string;
  /** How many placeholder lines to draw, to roughly match what is coming. */
  lines?: number;
  className?: string;
}

const WIDTHS = ['92%', '78%', '85%', '64%', '88%', '72%'] as const;

/**
 * A quiet placeholder for content that is on its way. Show it where the
 * content will appear (inside the card or under the heading, never instead of
 * the whole screen) so the page does not jump when the content arrives. Its
 * label is announced; the bars are decoration and hold still when the user has
 * asked for reduced motion.
 */
export function LoadingBlock({ label, lines = 3, className }: LoadingBlockProps) {
  return (
    <div role="status" aria-busy="true" className={cx('flex flex-col gap-2.5 py-1', className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: Math.max(1, lines) }, (_, index) => (
        <span
          key={index}
          aria-hidden="true"
          className={cx(skeleton, 'h-3')}
          style={{ width: WIDTHS[index % WIDTHS.length] }}
        />
      ))}
    </div>
  );
}
