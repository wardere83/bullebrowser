import { useEffect, useRef, useState } from 'react';
import type { UpdateStatus } from '../../shared/ipc.js';

// Chrome stays above the native webpage view. Preparing a signed update never
// quits this session; installation belongs to the user's next normal quit.
export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' });
  const current = useRef<UpdateStatus>(status);
  const [busy, setBusy] = useState(false);
  const [prepared, setPrepared] = useState<string | null>(null);
  const [actionError, setActionError] = useState(false);

  useEffect(() => {
    let active = true;
    let receivedEvent = false;
    const receive = (next: UpdateStatus) => {
      current.current = next;
      setStatus(next);
      setActionError(false);
      if (next.state !== 'idle') setPrepared(null);
    };
    const unsubscribe = window.bullebrowser.updates.onStatus((next) => {
      if (!active) return;
      receivedEvent = true;
      receive(next);
    });
    void window.bullebrowser.updates.status().then((initial) => {
      if (active && !receivedEvent) receive(initial);
    }).catch(() => {});
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!prepared) return;
    const timeout = setTimeout(() => setPrepared(null), 8000);
    return () => clearTimeout(timeout);
  }, [prepared]);

  const prepare = async () => {
    if (status.state !== 'ready' || busy) return;
    const version = status.version;
    setBusy(true);
    setActionError(false);
    try {
      await window.bullebrowser.updates.prepare(version);
      // A newer release arriving during the request must keep its own notice.
      if (current.current.state === 'idle' || (current.current.state === 'ready' && current.current.version === version)) {
        current.current = { state: 'idle' };
        setStatus({ state: 'idle' });
        setPrepared(version);
      }
    } catch {
      // Keep the ready action available if preparation did not succeed.
      if (current.current.state === 'idle' || (current.current.state === 'ready' && current.current.version === version)) {
        const ready: UpdateStatus = { state: 'ready', version };
        current.current = ready;
        setStatus(ready);
        setActionError(true);
      }
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    if (busy || status.state !== 'error' || status.retryable === false) return;
    setBusy(true);
    try {
      await window.bullebrowser.updates.retry();
    } catch {
      // The existing error stays visible until a successful retry event.
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async () => {
    if (busy || status.state !== 'deferred') return;
    const version = status.version;
    setBusy(true);
    try {
      await window.bullebrowser.updates.dismiss(version);
      if (current.current.state === 'deferred' && current.current.version === version) {
        current.current = { state: 'idle' };
        setStatus({ state: 'idle' });
      }
    } catch {
      // Retain this or a newer notice until its acknowledgment succeeds.
    } finally {
      setBusy(false);
    }
  };

  if (status.state === 'idle') {
    return prepared ? (
      <div role="status" className="no-drag max-w-52 text-[11px] leading-tight text-emerald-300">
        v{prepared} prepared. Applies after you quit and reopen.
      </div>
    ) : null;
  }

  const progress = status.state === 'downloading' && status.percent !== undefined
    ? Math.round(status.percent)
    : null;
  const actionClass = 'rounded bg-emerald-500 px-2 py-1.5 text-xs font-semibold text-white hover:bg-emerald-400 disabled:opacity-60';

  return (
    <section
      aria-label="App update"
      className="no-drag flex shrink-0 items-center gap-2 rounded-md bg-white/5 px-2 py-1"
    >
      <div role="status" className="max-w-44 text-[11px] leading-tight">
        <div className="font-medium">
          {status.state === 'downloading' && (status.phase === 'preparing'
            ? `Preparing v${status.version}…`
            : `Downloading v${status.version}${progress === null ? '…' : ` · ${progress}%`}`)}
          {status.state === 'ready' && `v${status.version} ready`}
          {status.state === 'deferred' && `v${status.version} available`}
          {status.state === 'error' && `v${status.version} update interrupted`}
        </div>
        {status.state === 'ready' && <div className={actionError ? 'text-amber-300' : 'text-white/65'}>{actionError ? 'Couldn’t prepare. Try again.' : 'Applies after you quit and reopen'}</div>}
        {status.state === 'deferred' && (
          <div
            className="text-white/65"
            title={`v${status.preparedVersion} is already prepared. It applies after you quit and reopen; v${status.version} downloads on that next launch.`}
          >
            After v{status.preparedVersion}’s next launch
          </div>
        )}
        {status.state === 'error' && <div className="truncate text-white/65" title={status.message}>{status.message}</div>}
        {status.state === 'downloading' && (
          <progress
            aria-label="Update download progress"
            value={status.phase === 'preparing' ? undefined : progress ?? undefined}
            max={100}
            className="mt-1 block h-1 w-28 accent-emerald-400"
          />
        )}
      </div>
      {status.state === 'ready' && (
        <button
          type="button"
          onClick={() => void prepare()}
          disabled={busy}
          title={`Prepare BulleBrowser ${status.version} without closing the app. Applies after you quit and reopen.`}
          className={actionClass}
        >
          {busy ? 'Preparing…' : 'Update App'}
        </button>
      )}
      {status.state === 'error' && status.retryable !== false && (
        <button type="button" onClick={() => void retry()} disabled={busy} className={actionClass}>
          {busy ? 'Retrying…' : 'Retry update'}
        </button>
      )}
      {status.state === 'deferred' && (
        <button type="button" onClick={() => void dismiss()} disabled={busy} className={actionClass}>
          {busy ? 'Saving…' : 'Got it'}
        </button>
      )}
    </section>
  );
}
