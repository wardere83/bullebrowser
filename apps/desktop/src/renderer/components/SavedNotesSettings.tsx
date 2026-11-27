import type { AssistantNote } from '@bullebrowser/agent-core';
import { useEffect, useState } from 'react';

/** Notes the assistant was asked to keep between conversations. */
export function SavedNotesSettings() {
  const [notes, setNotes] = useState<AssistantNote[] | null>(null);
  const [error, setError] = useState('');
  const refresh = async () => {
    try {
      setNotes(await window.bullebrowser.notes.list());
    } catch {
      setNotes([]);
      setError('Saved notes could not be loaded.');
    }
  };
  useEffect(() => { void refresh(); }, []);

  const remove = async (id: string) => {
    setError('');
    try {
      await window.bullebrowser.notes.remove(id);
      await refresh();
    } catch {
      setError('That note could not be deleted. Try again.');
    }
  };
  const clearAll = async () => {
    setError('');
    try {
      await window.bullebrowser.notes.clear();
      await refresh();
    } catch {
      setError('Notes could not be cleared. Try again.');
    }
  };

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">Saved notes</h3>
      <p className="mt-2 text-xs text-ink-secondary">
        Things you asked the assistant to remember between conversations, such as a preference or a deadline.
        They stay on this device, and the assistant can look them up in any chat until you delete them.
      </p>
      {notes && notes.length === 0 && <p className="mt-2 text-sm">No saved notes yet.</p>}
      {notes && notes.length > 0 && (
        <>
          <ul aria-label="Saved notes" className="mt-2 max-h-56 divide-y divide-line/30 overflow-y-auto rounded border border-line/40">
            {[...notes].reverse().map((note) => (
              <li key={note.id} className="flex items-start gap-2 px-3 py-1.5 text-xs">
                <span className="selectable min-w-0 flex-1 whitespace-pre-wrap break-words">{note.text}</span>
                <span className="shrink-0 text-ink-secondary">{new Date(note.savedAt).toLocaleDateString()}</span>
                <button type="button" onClick={() => void remove(note.id)} className="shrink-0 text-ink-secondary hover:text-danger"
                  aria-label={`Delete note: ${note.text.slice(0, 60)}`}>Delete</button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => void clearAll()}
            className="mt-2 rounded border border-line px-3 py-1.5 text-sm hover:bg-surface-muted">
            Clear all notes
          </button>
        </>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
