import type { ReactNode, Ref } from 'react';
import { cx, layout, text } from './styles.js';

export interface SectionHeadingProps {
  /** 1 for the screen's title (once per screen), 2 for a section, 3 for a group inside one. */
  level: 1 | 2 | 3;
  title: ReactNode;
  /** One or two sentences under the title. */
  description?: ReactNode;
  /** Buttons that act on the whole section; they sit to the right and wrap below when there is no room. */
  actions?: ReactNode;
  /** Something small beside the title that is not part of it, such as a Badge. */
  addon?: ReactNode;
  /** Lets `aria-labelledby` point at the heading. */
  id?: string;
  /** For moving focus to the heading; the heading is focusable from script either way. */
  headingRef?: Ref<HTMLHeadingElement>;
  className?: string;
}

/**
 * A heading with an optional description and actions. Every screen has exactly
 * one `level={1}` (use <Screen>, which renders it for you), then level 2 for
 * its sections and level 3 inside those, in order and without skipping.
 *
 * The heading can take focus from script (tabIndex -1), which is how the
 * workspace moves a keyboard or screen-reader user to a screen that has just
 * opened.
 */
export function SectionHeading({
  level,
  title,
  description,
  actions,
  addon,
  id,
  headingRef,
  className,
}: SectionHeadingProps) {
  const Heading = level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3';
  const headingClass = level === 1 ? text.h1 : level === 2 ? text.h2 : text.h3;
  const descriptionClass = level === 1 ? text.lead : text.small;

  return (
    <div className={cx('flex flex-wrap items-start justify-between gap-x-4 gap-y-3', className)}>
      <div className="min-w-0 flex-1 basis-64">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Heading
            id={id}
            ref={headingRef}
            tabIndex={-1}
            className={cx(headingClass, 'min-w-0 break-words')}
          >
            {title}
          </Heading>
          {addon}
        </div>
        {description && (
          <p className={cx(descriptionClass, layout.prose, level === 1 ? 'mt-2' : 'mt-1')}>
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
