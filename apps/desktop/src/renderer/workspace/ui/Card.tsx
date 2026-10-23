import type { HTMLAttributes, ReactNode } from 'react';
import { card, cx } from './styles.js';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** The element to render. Use "section" with `aria-labelledby` for a card with its own heading. */
  as?: 'div' | 'section' | 'article' | 'li';
  padding?: keyof typeof card.padding;
  children: ReactNode;
}

/**
 * A surface one shade lighter than the page, with a hairline edge. Use it to
 * group things that belong together: a list with its heading, a form, a
 * summary. Do not nest cards, and do not use one just to draw a box round a
 * single line of text. A card that is itself clickable is a `<button>` with
 * `card.interactive` from styles.ts, not this component.
 */
export function Card({
  as: Element = 'div',
  padding = 'md',
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <Element {...rest} className={cx(card.base, card.padding[padding], className)}>
      {children}
    </Element>
  );
}
