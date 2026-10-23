// The note kept with a saved listing: a few lines a person writes for
// themselves and their colleagues. It stays on this device with the listing.

import { useRef, useState } from 'react';
import type { SavedOpportunity } from '../../../shared/funding.js';
import { fundingBridge, toCallError, unwrap } from '../../lib/funding-client.js';
import { Button, Field, InlineAlert, Textarea, announce, cx, layout, text } from '../ui/index.js';
import { useAlive } from './hooks.js';
import { noteIsChanged, noteWasShortened } from './saved.js';
import { useListingServices } from './services.js';

export interface SavedNoteProps {
  entry: SavedOpportunity;
  /** The id of the listing's title, so each note field says which listing it belongs to. */
  titleId: string;
}

export function SavedNote({ entry, titleId }: SavedNoteProps) {
  const services = useListingServices();
  const alive = useAlive();
  const [stored, setStored] = useState(entry.note);
  const [typed, setTyped] = useState(entry.note);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [shortened, setShortened] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  // The stored note can change while the card is on screen (saved here, or the
  // list was read again). Follow it, unless something unsaved is being typed.
  if (entry.note !== stored) {
    setStored(entry.note);
    if (typed === stored) setTyped(entry.note);
  }

  if (!services.canManage) {
    if (!entry.note.trim()) return null;
    return (
      <div className={cx(layout.divider, 'flex flex-col gap-2 pt-4')}>
        <p className={text.overline}>Note</p>
        <p className={cx(text.body, layout.prose, 'whitespace-pre-line break-words')}>
          {entry.note}
        </p>
      </div>
    );
  }

  const save = async () => {
    if (saving) return;
    const sent = typed;
    setSaving(true);
    setProblem(null);
    setShortened(false);
    try {
      const list = await unwrap(fundingBridge().opportunities.setNote(entry.opportunity.id, sent));
      if (!alive.current) return;
      services.applySaved(list);
      const kept = list.find((item) => item.opportunity.id === entry.opportunity.id)?.note ?? '';
      setStored(kept);
      setTyped(kept);
      setShortened(noteWasShortened(sent, kept));
      announce('Note saved.');
    } catch (error) {
      if (!alive.current) return;
      const failed = toCallError(error);
      if (failed.code !== 'CANCELLED') setProblem(failed.message);
    } finally {
      if (alive.current) setSaving(false);
    }
  };

  const changed = noteIsChanged(stored, typed);

  return (
    <div className={cx(layout.divider, layout.stack, 'pt-4')}>
      <Field label="Note" hint="Kept with this saved listing, on this device." optional>
        <Textarea
          ref={fieldRef}
          rows={3}
          value={typed}
          aria-describedby={titleId}
          onChange={(event) => {
            setTyped(event.target.value);
            setShortened(false);
          }}
        />
      </Field>
      <div className={layout.row}>
        <Button
          size="sm"
          busy={saving}
          busyLabel="Saving the note"
          disabled={!changed}
          aria-describedby={titleId}
          onClick={() => void save()}
        >
          Save note
        </Button>
        {changed && !saving && (
          <Button
            size="sm"
            variant="quiet"
            onClick={() => {
              setTyped(stored);
              // This button goes away with the change; keep focus in the note.
              fieldRef.current?.focus();
            }}
          >
            Discard changes
          </Button>
        )}
      </div>
      {shortened && (
        <InlineAlert tone="caution" announce>
          The note was longer than can be kept, so it was shortened. Check what was saved.
        </InlineAlert>
      )}
      {problem && <InlineAlert tone="error">{problem}</InlineAlert>}
    </div>
  );
}
