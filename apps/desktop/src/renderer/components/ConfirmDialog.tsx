import { useAgentStore } from '../state/agent-store.js';
import { Modal } from './Modal.js';

export function ConfirmDialog() {
  const pending = useAgentStore((s) => s.pendingConfirm);
  const setPending = useAgentStore((s) => s.setPendingConfirm);
  // Browsing access is asked for inline in the chat panel, not as a modal —
  // a dialog over the page for "may I read this?" is heavy-handed.
  if (!pending || pending.kind !== 'destructive') return null;

  const reply = (approved: boolean) => {
    void window.bullebrowser.agent.replyConfirm(pending.runId, pending.id, approved);
    setPending(null);
  };

  return (
    <Modal title="Check before it goes out" onClose={() => reply(false)} width={440}>
      <div className="space-y-4 text-sm">
        <p className="text-ink-primary">
          This step would pay, send, delete or submit your details on a
          website in your name. Finding and reading funding never asks.
        </p>
        <div className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded border border-line bg-surface-muted p-3 font-mono text-xs">
          {pending.message}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => reply(false)}
            className="rounded border border-line px-3 py-1.5 text-sm hover:bg-surface-muted"
          >
            Skip this step
          </button>
          <button
            type="button"
            onClick={() => reply(true)}
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-ink-primary hover:bg-accent-hover"
          >
            Go ahead
          </button>
        </div>
      </div>
    </Modal>
  );
}
