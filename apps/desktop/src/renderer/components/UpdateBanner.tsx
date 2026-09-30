import { useEffect, useState } from 'react';
import type { UpdateStatus } from '../../shared/ipc.js';

// "Update App", in the top-right corner. It appears only when a newer version
// has been downloaded and is waiting — never otherwise — so clicking it is a
// relaunch onto that version and nothing more: no download bar, no progress
// to watch, no chance of being stranded half-updated on a bad connection. The
// app never restarts itself; this click is how people move to a new version
// (an unclicked update still installs on a normal quit).
//
// Lives in the top bar, not floating over the page: the active tab is a native
// view painted on top of this window, so anything positioned over the page area
// is simply invisible. The top bar is renderer chrome, so it actually shows.
//
// Deliberately not a modal either — an update is never more important than what
// the user is in the middle of.
export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' });
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    void window.bullebrowser.updates.status().then(setStatus);
    return window.bullebrowser.updates.onStatus(setStatus);
  }, []);

  if (status.state !== 'ready') return null;

  const install = () => {
    setInstalling(true);
    void window.bullebrowser.updates.install();
  };

  return (
    <button
      type="button"
      onClick={install}
      disabled={installing}
      title={`BulleBrowser ${status.version} is ready. Restarts the app on the new version.`}
      // no-drag: the top bar is a window drag region, which would otherwise
      // swallow the click.
      className="no-drag flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-emerald-500 px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-400 disabled:opacity-70"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
        <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
      </svg>
      {installing ? 'Updating…' : 'Update App'}
    </button>
  );
}
