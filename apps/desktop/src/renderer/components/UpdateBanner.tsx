import { useCallback, useEffect, useRef, useState } from 'react';
import type { UpdateStatus } from '../../shared/ipc.js';
import { useBrowserStore } from '../state/browser-store.js';
import { Modal } from './Modal.js';
import { useAgentStore } from '../state/agent-store.js';
import { saveUpdateChat, SAVE_UPDATE_CHAT_EVENT, type UpdateChatSnapshot } from '../lib/update-session.js';

// Always discoverable. Download completion means "prepared", not "running".
export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' });
  const [checking, setChecking] = useState(false);
  const [staging, setStaging] = useState(false);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState('');
  const [details, setDetails] = useState<{ installedVersion: string; activationIssue: string | null; completedVersion: string | null } | null>(null);
  const inFlight = useRef(false);
  const open = useBrowserStore((s) => s.showUpdates);
  const openUpdates = useBrowserStore((s) => s.openUpdates);
  const closeUpdates = useBrowserStore((s) => s.closeUpdates);

  const refreshDetails = useCallback(() => {
    void window.bullebrowser.updates.details().then(setDetails).catch(() => {});
  }, []);
  useEffect(() => {
    let active = true;
    let received = false;
    const unsubscribe = window.bullebrowser.updates.onStatus((next) => {
      if (!active) return;
      received = true;
      setStatus(next);
      setError('');
      refreshDetails();
    });
    void window.bullebrowser.updates.status().then((next) => {
      if (active && !received) setStatus(next);
    }).catch(() => { if (active) setError('Could not read update status. Please check again.'); });
    refreshDetails();
    return () => { active = false; unsubscribe(); };
  }, [refreshDetails]);

  const check = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    setError('');
    try {
      await window.bullebrowser.updates.check();
      setStatus(await window.bullebrowser.updates.status());
      setChecked(true);
      refreshDetails();
    } catch {
      setError('Could not check for updates. Check your connection and retry.');
    } finally { inFlight.current = false; setChecking(false); }
  }, [refreshDetails]);
  useEffect(() => {
    const online = () => { void check(); };
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [check]);

  useEffect(() => {
    const save = () => {
      if (status.state !== 'ready' && status.state !== 'deferred') return;
      const snapshot = new CustomEvent<UpdateChatSnapshot>(SAVE_UPDATE_CHAT_EVENT, { detail: {} });
      window.dispatchEvent(snapshot);
      const current = useAgentStore.getState().current;
      const chat = snapshot.detail.chat ?? (current ? { conversationId: current.id, draft: '' } : null);
      if (chat) { try { saveUpdateChat(chat); } catch { /* A full disk must not block closing. */ } }
    };
    window.addEventListener('beforeunload', save);
    return () => window.removeEventListener('beforeunload', save);
  }, [status]);

  const prepare = async () => {
    if (inFlight.current || (status.state !== 'ready' && status.state !== 'deferred')) return;
    inFlight.current = true;
    setStaging(true);
    setError('');
    try {
      await window.bullebrowser.updates.apply(status.state === 'ready' ? status.version : status.preparedVersion);
      setStatus(await window.bullebrowser.updates.status());
      refreshDetails();
    } catch { setError('Could not prepare this update. Your app is still open. Check again or use the latest installer.'); }
    finally { inFlight.current = false; setStaging(false); }
  };
  const downloading = status.state === 'downloading';
  const ready = status.state === 'ready' || status.state === 'deferred';
  const scheduled = status.state === 'ready' && status.scheduled;
  const progress = ready ? 100 : downloading
    ? status.phase === 'preparing' ? undefined : status.percent === undefined ? undefined : Math.min(99, status.percent)
    : undefined;
  const label = checking ? 'Checking…' : downloading
    ? status.phase === 'preparing' ? 'Preparing…' : `Updating${progress === undefined ? '…' : ` ${progress}%`}`
    : scheduled ? 'Restart required' : ready ? 'Update' : status.state === 'error' || error ? 'Update issue' : details?.completedVersion ? 'Update Completed' : 'Updates';
  const show = () => {
    openUpdates();
    if (status.state === 'idle' || status.state === 'error') void check();
    else if (ready && !scheduled) void prepare();
  };

  return <>
    <button type="button" onClick={show} aria-label="Update" aria-haspopup="dialog"
      title="View update progress. Updating never closes this window."
      className="update-control no-drag relative shrink-0 overflow-hidden rounded px-3 py-1.5 text-xs font-semibold text-white"
      data-active={downloading || checking || staging}>
      <span className="relative z-10">{label}</span>
      {progress !== undefined && <span aria-hidden className="update-fill" style={{ width: `${progress}%` }} />}
    </button>
    {open && <Modal title="BulleBrowser updates" onClose={closeUpdates} width={460}>
      <div className="no-drag space-y-4 text-sm">
        <p>Running version: <strong>{details?.installedVersion ?? 'Checking…'}</strong></p>
        {details?.completedVersion && <p role="status" className="rounded border border-green-300 bg-green-50 p-3 font-semibold text-green-900">Update Completed — v{details.completedVersion} is now running.</p>}
        {details?.activationIssue && <p role="alert" className="rounded border border-amber-300 bg-amber-50 p-3">{details.activationIssue}</p>}
        <p role="status">{checking ? 'Checking for published updates…' : downloading
          ? status.phase === 'preparing' ? 'Download complete. Verifying and preparing the signed update…' : `Downloading v${status.version} in the background.`
          : ready ? `v${status.state === 'deferred' ? status.preparedVersion : status.version} is downloaded and verified. Restart BulleBrowser when convenient to activate it.`
          : status.state === 'error' ? status.message : checked ? 'No newer published release was found.' : details?.completedVersion ? 'The installed update is active.' : 'Check for the latest published release.'}</p>
        {(downloading || ready) && <div>
          <div role="progressbar" aria-label="Update download progress" aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={progress} aria-valuetext={progress === undefined ? 'Verifying or waiting for download progress' : `${progress}% prepared`}
            className="update-track h-3 overflow-hidden rounded-full">
            <div className="update-meter h-full rounded-full" data-indeterminate={progress === undefined}
              style={{ width: progress === undefined ? '35%' : `${progress}%` }} />
          </div>
          <p className="mt-2 text-xs text-ink-secondary">{ready ? '100% prepared. A restart is required to activate native app changes; your browser remains open until you choose to restart.' : 'Your tabs and current tasks stay open.'}</p>
        </div>}
        {status.state === 'deferred' && <p className="text-xs">v{status.version} is also available and will download after the prepared version activates.</p>}
        {error && <p role="alert" className="text-danger">{error}</p>}
        <div className="flex flex-wrap gap-2">
          {ready && !scheduled && <button type="button" disabled={staging} onClick={() => void prepare()}
            className="rounded bg-primary px-3 py-2 font-medium text-white disabled:opacity-60">{staging ? 'Preparing…' : 'Prepare update — restart later'}</button>}
          <button type="button" disabled={checking || downloading || staging || (status.state === 'error' && status.retryable === false)}
            onClick={() => void check()} className="rounded border border-line px-3 py-2 disabled:opacity-60">{checking ? 'Checking…' : 'Check for updates'}</button>
          <a href="https://bullebrowser.com/download" target="_blank" rel="noopener noreferrer" className="rounded border border-line px-3 py-2">Latest installer</a>
        </div>
        <p className="text-xs text-ink-secondary">Updates appear after a release is published. Changes to the native application require a normal relaunch; download progress does not change the running version.</p>
      </div>
    </Modal>}
  </>;
}
