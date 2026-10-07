// Keeps keyboard focus from being dropped when a change removes the control
// that made it: an approved statement moves to another list, a deleted
// document's row disappears, a dialog closes over a button that is gone.
//
// A component asks for a repair in the same handler that applies the change.
// After the page has updated, focus is moved to the place the component names,
// but only if it really was lost: when the control is still there, or the
// person has moved on to something else, nothing is touched.

import { useCallback, useEffect, useState } from 'react';

type Find = () => HTMLElement | null | undefined;

/**
 * True when focus has nowhere useful to be: on the page itself, or on the
 * screen's title, which is where a closing dialog leaves it when the control
 * that opened the dialog is gone (see restoreFocus in ui/focus.ts).
 */
function focusWasLost(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || active.tagName === 'H1';
}

/**
 * Returns a function to call with a way to find where focus should go. It is
 * looked up after the next update, so it can name an element that the change
 * itself brings onto the page.
 */
export function useFocusRepair(): (find: Find) => void {
  const [pending, setPending] = useState<{ find: Find } | null>(null);

  useEffect(() => {
    if (!pending) return;
    setPending(null);
    if (focusWasLost()) pending.find()?.focus();
  }, [pending]);

  return useCallback((find: Find) => setPending({ find }), []);
}
