import { useEffect, useState } from 'react';
import { onAnnouncement } from './announce.js';

/** Invisible, and enough to make a repeated sentence count as new text. */
const NO_BREAK_SPACE = String.fromCharCode(160);

/** Long enough to be read out; short enough that nobody comes across it later. */
const CLEAR_AFTER_MS = 6000;

/**
 * The workspace's one live region. Mounted once by the workspace shell; screens
 * never render it. To have something read out, call `announce(message)`.
 */
export function Announcer() {
  const [text, setText] = useState('');

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = onAnnouncement((message) => {
      // The same sentence twice in a row must still be read the second time,
      // and a live region only speaks when its text changes.
      setText((previous) => (previous === message ? `${message}${NO_BREAK_SPACE}` : message));
      // An announcement is about a moment. Left in the page it would be found
      // later by someone reading through it, and could name an organization
      // that is no longer the active one.
      clearTimeout(timer);
      timer = setTimeout(() => setText(''), CLEAR_AFTER_MS);
    });
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, []);

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {text}
    </div>
  );
}
