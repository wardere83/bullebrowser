import { useEffect, useState } from 'react';
import { FEEDBACK_ADDRESS, type FeedbackEntry } from '../../shared/feedback.js';
import { useFeedbackStore } from '../state/feedback-store.js';

const SECTION_TITLE = 'text-xs font-semibold uppercase tracking-wide text-ink-secondary';
const BUTTON = 'rounded border border-line px-3 py-1.5 text-sm hover:bg-surface-muted disabled:opacity-50';

/** The ratings given with the thumbs under replies and playbooks. */
export function FeedbackSettings() {
  const [entries, setEntries] = useState<FeedbackEntry[]>([]);
  const [note, setNote] = useState('');
  const reset = useFeedbackStore((state) => state.reset);
  useEffect(() => {
    void window.bullebrowser.feedback.list().then(setEntries).catch(() => setEntries([]));
  }, []);
  const up = entries.filter((entry) => entry.rating === 'up').length;
  const down = entries.length - up;

  const email = async () => {
    setNote('');
    try {
      await window.bullebrowser.feedback.email();
      setNote('Your mail app opened with the feedback filled in. Send it from there when you are ready.');
    } catch {
      setNote(`Your mail app could not be opened. Use Save as file and attach it to an email to ${FEEDBACK_ADDRESS}.`);
    }
  };
  const save = async () => {
    setNote('');
    try {
      if (await window.bullebrowser.feedback.exportFile()) setNote('Feedback saved.');
    } catch {
      setNote('The file could not be saved. Try another folder.');
    }
  };
  const clear = async () => {
    await window.bullebrowser.feedback.clear();
    setEntries([]);
    reset([]);
    setNote('Feedback cleared.');
  };

  return (
    <div>
      <h3 className={SECTION_TITLE}>Feedback</h3>
      <p className="mt-2 text-xs text-ink-secondary">
        Use the thumbs under a reply or a strategy playbook to rate it, and add a comment if you like.
        Ratings stay on this device. Nothing reaches the BulleBrowser team unless you email it or share the file yourself.
      </p>
      <p className="mt-2 text-sm">
        {entries.length === 0 ? 'No ratings yet.' : `${up} thumbs up, ${down} thumbs down`}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={entries.length === 0} onClick={() => void email()} className={BUTTON}>Email to the BulleBrowser team</button>
        <button type="button" disabled={entries.length === 0} onClick={() => void save()} className={BUTTON}>Save as file…</button>
        <button type="button" disabled={entries.length === 0} onClick={() => void clear()} className={BUTTON}>Clear</button>
      </div>
      {note && <p role="status" className="mt-2 text-xs text-ink-secondary">{note}</p>}
    </div>
  );
}
