import { useState } from 'react';
import type { ConversationDetail } from '../../shared/ipc.js';
import { useAgentStore } from '../state/agent-store.js';

export function SessionScratchpad({ conversation }: { conversation: ConversationDetail }) {
  const [text, setText] = useState(conversation.scratchpad ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  async function save(value: string) {
    setSaving(true);
    setMessage('');
    try {
      await window.bullebrowser.conversations.setScratchpad(conversation.id, value);
      const store = useAgentStore.getState();
      if (store.current?.id === conversation.id) store.setCurrent({ ...store.current, scratchpad: value });
      setText(value);
      setMessage(value ? 'Saved for later tasks in this conversation.' : 'Session notes forgotten.');
    } catch {
      setMessage('Could not save session notes. Try again.');
    } finally {
      setSaving(false);
    }
  }
  return <details className="shrink-0 border-b border-line px-5 py-2 text-xs">
    <summary className="cursor-pointer text-ink-secondary">Session scratchpad</summary>
    <p className="my-2 text-ink-secondary">Notes apply to every task in this conversation until you forget them. They are not verified sources.</p>
    <textarea aria-label="Session notes" value={text} maxLength={12000} disabled={saving}
      onChange={(event) => { setText(event.target.value); setMessage('Unsaved changes'); }}
      className="w-full rounded border border-line bg-white p-2 text-ink-primary" rows={3} />
    <div className="mt-2 flex items-center gap-3">
      <button type="button" disabled={saving} onClick={() => void save(text)} className="text-primary disabled:opacity-50">Save notes</button>
      <button type="button" disabled={saving} onClick={() => void save('')} className="text-danger disabled:opacity-50">Forget this</button>
      <span role="status" className="text-ink-secondary">{message}</span>
    </div>
  </details>;
}
