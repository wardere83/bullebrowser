import { useEffect, useId, useState } from 'react';
import { FEEDBACK_COMMENT_MAX, type FeedbackKind, type FeedbackRating } from '../../shared/feedback.js';
import { useFeedbackStore } from '../state/feedback-store.js';

const BUTTON = 'inline-flex items-center rounded p-1 transition-opacity hover:bg-surface-muted hover:opacity-100 focus-visible:opacity-100 disabled:opacity-40';

function Thumb({ down = false, filled = false }: { down?: boolean; filled?: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden className={down ? 'rotate-180' : undefined}>
      <path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3Z" />
      <path d="M7 10l4.2-7.4a1.6 1.6 0 0 1 3 .9L13.5 9H19a2 2 0 0 1 2 2.3l-1.3 7.5A2.5 2.5 0 0 1 17.2 21H7" />
    </svg>
  );
}

/**
 * Thumbs up and down on a reply or a playbook, with an optional comment after
 * a press. Ratings stay on this device; Settings lets the user email them to
 * the team or save them as a file.
 */
export function FeedbackBar({ feedbackKey, kind, excerpt, className = '' }: {
  feedbackKey: string;
  kind: FeedbackKind;
  excerpt: string;
  className?: string;
}) {
  const entry = useFeedbackStore((state) => state.entries[feedbackKey]);
  const load = useFeedbackStore((state) => state.load);
  const rate = useFeedbackStore((state) => state.rate);
  const [asking, setAsking] = useState(false);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const commentId = useId();
  useEffect(() => { void load(); }, [load]);

  const choose = async (rating: FeedbackRating) => {
    setBusy(true);
    setNote('');
    try {
      if (entry?.rating === rating) {
        await rate({ key: feedbackKey, kind, rating: null });
        setAsking(false);
      } else {
        await rate({ key: feedbackKey, kind, rating, comment: entry?.comment ?? '', excerpt });
        setComment(entry?.comment ?? '');
        setAsking(true);
      }
    } catch {
      setNote('That rating could not be saved. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const saveComment = async () => {
    if (!entry) return;
    setBusy(true);
    try {
      await rate({ key: feedbackKey, kind, rating: entry.rating, comment, excerpt });
      setAsking(false);
      setNote('Thanks for the feedback.');
    } catch {
      setNote('That comment could not be saved. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const what = kind === 'strategy' ? 'playbook' : 'response';
  return (
    <div className={className}>
      <div className="inline-flex items-center">
        <FeedbackThumbs rating={entry?.rating} busy={busy} what={what} onChoose={(rating) => void choose(rating)} />
        {note && !asking && <span role="status" className="ml-1.5 text-[11px] text-ink-secondary">{note}</span>}
      </div>
      {asking && entry && (
        <form className="mt-1.5 max-w-md rounded-lg border border-line/60 bg-white p-2" onSubmit={(e) => { e.preventDefault(); void saveComment(); }}>
          <label htmlFor={commentId} className="block text-[11px] text-ink-secondary">
            {entry.rating === 'up' ? 'What worked well? (optional)' : 'What should be better? (optional)'}
          </label>
          <textarea id={commentId} value={comment} autoFocus rows={2} maxLength={FEEDBACK_COMMENT_MAX}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setAsking(false); }}
            className="mt-1 w-full resize-none rounded border border-line px-2 py-1 text-sm text-ink-primary focus:border-primary focus:outline-none" />
          <div className="mt-1.5 flex items-center justify-end gap-2">
            <button type="button" onClick={() => { setAsking(false); setNote('Thanks for the feedback.'); }}
              className="rounded px-2 py-1 text-xs text-ink-secondary hover:bg-surface-muted">Skip</button>
            <button type="submit" disabled={busy}
              className="rounded-md bg-primary px-2.5 py-1 text-[12px] font-medium text-white hover:bg-primary-hover disabled:bg-line">Save</button>
          </div>
        </form>
      )}
    </div>
  );
}

/** The two thumbs, showing the rating already given. */
export function FeedbackThumbs({ rating, busy = false, what, onChoose }: {
  rating?: FeedbackRating;
  busy?: boolean;
  what: string;
  onChoose: (rating: FeedbackRating) => void;
}) {
  const tone = (value: FeedbackRating) => rating === value ? 'text-primary opacity-100' : 'text-ink-secondary opacity-70 group-hover:opacity-100';
  return (
    <div role="group" aria-label={`Rate this ${what}`} className="inline-flex items-center gap-0.5">
      <button type="button" disabled={busy} onClick={() => onChoose('up')} aria-pressed={rating === 'up'}
        aria-label={`Good ${what}`} title={`Good ${what}`} className={`${BUTTON} ${tone('up')}`}>
        <Thumb filled={rating === 'up'} />
      </button>
      <button type="button" disabled={busy} onClick={() => onChoose('down')} aria-pressed={rating === 'down'}
        aria-label={`Bad ${what}`} title={`Bad ${what}`} className={`${BUTTON} ${tone('down')}`}>
        <Thumb down filled={rating === 'down'} />
      </button>
    </div>
  );
}
