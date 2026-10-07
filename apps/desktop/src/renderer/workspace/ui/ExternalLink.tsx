import type { MouseEvent, ReactNode } from 'react';
import { Icon } from './icons.js';
import { safeExternalUrl } from './links.js';
import { cx, text } from './styles.js';

export interface ExternalLinkProps {
  /** A web address. Anything that is not http or https is shown as plain text, not as a link. */
  href: string;
  children: ReactNode;
  className?: string;
}

/**
 * A link to a web page, such as a listing on its official source. It opens the
 * page in a new browser tab inside the app; the app's own window never
 * navigates, so the workspace is still there on its tab. Assistive technology
 * is told that it opens in a new tab.
 *
 * Use it for every address the workspace shows. Never build an `<a>` to an
 * outside address by hand, and never use it for moving between screens (that
 * is `navigate`).
 */
export function ExternalLink({ href, children, className }: ExternalLinkProps) {
  const url = safeExternalUrl(href);
  if (!url) {
    return (
      <span className={className}>
        {children}
        <span className="sr-only"> (link unavailable)</span>
      </span>
    );
  }

  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    // A plain click opens the tab through the bridge. Anything else (a middle
    // click, a modified click) is left to the app's link handling in the main
    // process, which also opens a tab and never navigates this window.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    void window.bullebrowser.tabs.create(url);
  };

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={open}
      className={cx(text.link, 'inline-flex items-baseline gap-1 break-words', className)}
    >
      <span>{children}</span>
      <Icon name="external" size={12} className="translate-y-px self-center" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
