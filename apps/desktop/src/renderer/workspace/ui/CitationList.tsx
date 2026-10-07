import type { Citation } from '../../../shared/funding.js';
import { formatCitationSource } from '../../lib/funding-client.js';
import { cx, text } from './styles.js';

export interface CitationListProps {
  citations: readonly Citation[];
  /** Names the list for assistive technology. */
  label?: string;
  className?: string;
}

/**
 * The evidence for a statement: each quotation exactly as the app read it from
 * the document, then where it comes from (the document's name with the page,
 * or the section when there are no pages). A quotation whose wording differs
 * slightly from the source says "matched approximately".
 *
 * Show it under every statement that has citations. Do not paraphrase, trim or
 * restyle a quotation, and do not render citations any other way: this is what
 * lets a reader check the app's work.
 */
export function CitationList({ citations, label = 'Sources', className }: CitationListProps) {
  if (citations.length === 0) return null;
  return (
    <ul aria-label={label} className={cx('selectable flex flex-col gap-3', className)}>
      {citations.map((citation, index) => (
        <li key={`${citation.documentId}:${citation.blockId}:${index}`}>
          <figure>
            <blockquote className="border-l-2 border-primary/60 pl-3 text-[13px] leading-5 text-ink-inverse/85">
              {citation.quote}
            </blockquote>
            <figcaption className={cx(text.caption, 'mt-1 pl-3.5')}>
              {formatCitationSource(citation)}
              {citation.match === 'approximate' && (
                <>
                  <span aria-hidden="true"> · </span>
                  <span className="sr-only">, </span>
                  matched approximately
                </>
              )}
            </figcaption>
          </figure>
        </li>
      ))}
    </ul>
  );
}
