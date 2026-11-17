import { Children, Fragment, type ReactNode } from 'react';

// Acronyms whose lowercase plural must survive an uppercase label. CSS would
// otherwise show "CBOs" as "CBOS".
const MIXED_CASE = /(CBOs)/;

function keepString(text: string): ReactNode {
  if (!MIXED_CASE.test(text)) return text;
  return text.split(MIXED_CASE).map((part, i) =>
    i % 2 ? (
      <span key={i} className="normal-case">
        {part}
      </span>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

/** Text for an uppercase label, with mixed-case acronyms left as written. */
export function keepCase(children: ReactNode): ReactNode {
  if (typeof children === 'string') return keepString(children);
  if (Array.isArray(children)) return Children.map(children, (child) => (typeof child === 'string' ? keepString(child) : child));
  return children;
}
