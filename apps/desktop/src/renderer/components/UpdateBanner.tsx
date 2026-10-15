import { useEffect, useRef, useState } from 'react';
import type { UpdateStatus } from '../../shared/ipc.js';
import { useAgentStore } from '../state/agent-store.js';
import { clearUpdateChat, saveUpdateChat, SAVE_UPDATE_CHAT_EVENT, type UpdateChatSnapshot } from '../lib/update-session.js';

// Downloads and verification happen in the background. Show one action only.
export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const inFlight = useRef(false);
  const running = useAgentStore((state) => state.status === 'running');
  useEffect(() => {
    let active = true;
    let received = false;
    const unsubscribe = window.bullebrowser.updates.onStatus((next) => {
      if (!active) return;
      received = true;
      setStatus(next);
      setError(false);
    });
    void window.bullebrowser.updates.status().then((next) => {
      if (active && !received) setStatus(next);
    }).catch(() => {});
    return () => { active = false; unsubscribe(); };
  }, []);

  const available = status.state === 'ready' || status.state === 'deferred' || (status.state === 'error' && status.retryable !== false);
  if (!available) return null;
  const update = async () => {
    if (inFlight.current || running) return;
    inFlight.current = true;
    setBusy(true);
    setError(false);
    try {
      if (status.state === 'ready' || status.state === 'deferred') {
        const snapshot = new CustomEvent<UpdateChatSnapshot>(SAVE_UPDATE_CHAT_EVENT, { detail: {} });
        window.dispatchEvent(snapshot);
        const current = useAgentStore.getState().current;
        const chat = snapshot.detail.chat ?? (current ? { conversationId: current.id, draft: '' } : null);
        if (chat) saveUpdateChat(chat);
        await window.bullebrowser.updates.apply(status.state === 'ready' ? status.version : status.preparedVersion);
      } else await window.bullebrowser.updates.retry();
    } catch {
      clearUpdateChat();
      setError(true);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const title = running ? 'Finish the current task before updating.' : error ? 'The update could not be applied. Click to retry.'
    : status.state === 'deferred' ? `Install prepared v${status.preparedVersion} and reopen automatically. v${status.version} will download afterward.`
    : status.state === 'ready' ? `Install v${status.version}. The app briefly restarts automatically and restores your tabs and chat.`
      : 'Retry downloading the app update in the background.';
  return (
    <button type="button" onClick={() => void update()} disabled={busy || running}
      title={title} aria-label="Update" className="no-drag shrink-0 rounded bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-400 disabled:opacity-60">
      Update
    </button>
  );
}
