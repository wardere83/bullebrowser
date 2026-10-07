// Two small pieces the Knowledge Hub's tabs share: a line of short facts, and a
// passage of a document shown word for word.

import { Fragment } from 'react';
import { cx, text } from '../ui/index.js';

/**
 * Short facts on one line, such as "PDF · 2.4 MB · 24 pages". The dots are
 * for the eye only; a screen reader hears the facts separated by commas.
 */
export function FactLine({
  facts,
  className,
}: {
  facts: readonly (string | false | null | undefined)[];
  className?: string;
}) {
  const shown = facts.filter((fact): fact is string => Boolean(fact));
  if (shown.length === 0) return null;
  return (
    <p className={cx(text.caption, className)}>
      {shown.map((fact, index) => (
        <Fragment key={index}>
          {index > 0 && (
            <>
              <span aria-hidden="true"> · </span>
              <span className="sr-only">, </span>
            </>
          )}
          {fact}
        </Fragment>
      ))}
    </p>
  );
}

/**
 * A passage exactly as the app read it from a document, drawn the way the
 * quotation in a citation is drawn, with its line breaks kept. Use it only for
 * text that came from a document: an assistant's wording is never shown like
 * this.
 */
export function PassageQuote({ children, className }: { children: string; className?: string }) {
  return (
    <blockquote
      className={cx(
        'selectable whitespace-pre-line break-words border-l-2 border-primary/60 pl-3 text-[13px] leading-5 text-ink-inverse/85',
        className,
      )}
    >
      {children}
    </blockquote>
  );
}
