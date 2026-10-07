// Small DOM helpers for keeping keyboard focus where it belongs. Used by Dialog
// and Menu, and by the workspace when a screen changes.

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** True when the element is rendered: not inside something hidden with `display: none`. */
export function isDisplayed(element: Element): boolean {
  return element.getClientRects().length > 0;
}

/** The elements inside `root` that Tab can reach, in document order. */
export function focusableWithin(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => isDisplayed(element) && element.getAttribute('aria-hidden') !== 'true',
  );
}

/**
 * Marks the element the workspace falls back to when focus has nowhere to
 * return to. Workspace.tsx writes this attribute on its content area.
 */
export const FOCUS_FALLBACK_ATTRIBUTE = 'data-workspace-focus-fallback';

/**
 * Puts focus back where it was before something (a dialog, a menu) took it.
 * When that element is gone, focus goes to the heading of the view that is now
 * showing instead of being dropped on the page body, where a keyboard user
 * would lose their place.
 */
export function restoreFocus(previous: HTMLElement | null): void {
  if (previous && previous.isConnected && isDisplayed(previous)) {
    previous.focus();
    return;
  }
  const fallback = document.querySelector<HTMLElement>(`[${FOCUS_FALLBACK_ATTRIBUTE}]`);
  // The view's heading says where the user now is; the area itself is the last resort.
  (fallback?.querySelector<HTMLElement>('h1') ?? fallback)?.focus({ preventScroll: true });
}
