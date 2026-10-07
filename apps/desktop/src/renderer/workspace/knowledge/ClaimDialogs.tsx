// The three dialogs that change a profile statement: a short form to write
// one, a short form to edit one, and the question asked before one is removed.
// Each makes its own call and hands back the profile main returned.

import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from 'react';
import {
  PROFILE_FIELDS,
  PROFILE_FIELD_LABELS,
  type KnowledgePassage,
  type NewClaimInput,
  type OrganizationProfile,
  type ProfileClaim,
  type ProfileFieldId,
} from '../../../shared/funding.js';
import {
  type AsyncResult,
  formatCitationSource,
  fundingBridge,
  toCallError,
  unwrap,
  useAsync,
} from '../../lib/funding-client.js';
import {
  Button,
  Checkbox,
  CitationList,
  DefinitionList,
  DefinitionRow,
  Dialog,
  Field,
  Fieldset,
  InlineAlert,
  LoadingBlock,
  Select,
  Textarea,
  layout,
  text,
} from '../ui/index.js';
import { passageKey, uniquePassages } from './passages.js';
import { PassageQuote } from './Pieces.js';
import { NO_SOURCE_DOCUMENT } from './profile.js';
import {
  NO_PICKS,
  buildClaimInput,
  canCite,
  checkStatement,
  partOf,
  quoteOf,
  sameWording,
  togglePick,
  withPart,
  type EvidencePick,
  type EvidencePicks,
  type PartRange,
} from './statement-form.js';

/** False once the component has gone, so an answer that arrives late sets nothing. */
function useAlive(): RefObject<boolean> {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return alive;
}

// ───────────────────────────────── add a statement ─────────────────────────────

export interface AddStatementDialogProps {
  /** "Add a statement", or "Add a priority" among the priorities. */
  title: string;
  /** The button that saves: "Add statement" or "Add priority". */
  submitLabel: string;
  /** The field the form opens on. */
  field: ProfileFieldId;
  /** Shows the field without letting it be changed, when the form was opened for one field only. */
  lockField: boolean;
  onClose(): void;
  onSaved(profile: OrganizationProfile, input: NewClaimInput): void;
}

/**
 * A statement written by a person: its field, its wording and, if they wish,
 * passages from their own documents as evidence. The passages are offered by
 * the app; the form has no way to type a quotation.
 */
export function AddStatementDialog({
  title,
  submitLabel,
  field: openedOn,
  lockField,
  onClose,
  onSaved,
}: AddStatementDialogProps) {
  const formId = useId();
  const alive = useAlive();
  const statementRef = useRef<HTMLTextAreaElement>(null);
  const [field, setField] = useState<ProfileFieldId>(openedOn);
  const [statement, setStatement] = useState('');
  const [picks, setPicks] = useState<EvidencePicks>(NO_PICKS);
  const [statementError, setStatementError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const suggestions = useAsync(
    () => unwrap(fundingBridge().knowledge.suggestPassages(field)).then(uniquePassages),
    [field],
  );

  const changeField = (value: string) => {
    const next = PROFILE_FIELDS.find((entry) => entry === value);
    if (!next || next === field) return;
    setField(next);
    // The passages on offer belong to the field, so what was picked for
    // another field does not carry over.
    setPicks(NO_PICKS);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const built = buildClaimInput(field, statement, picks.values());
    if (!built.ok) {
      setStatementError(built.error);
      statementRef.current?.focus();
      return;
    }
    setStatementError(null);
    setFormError(null);
    setBusy(true);
    try {
      const profile = await unwrap(fundingBridge().knowledge.addClaim(built.input));
      if (alive.current) onSaved(profile, built.input);
    } catch (error) {
      if (!alive.current) return;
      setFormError(toCallError(error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      description="Write it in your organization’s own words. It is labelled as written by your team."
      size="lg"
      primaryAction={{ label: submitLabel, form: formId, busy, busyLabel: 'Saving the statement' }}
      secondaryAction={{ label: 'Discard', disabled: busy }}
      dismissable={!busy}
    >
      <form
        id={formId}
        noValidate
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-5"
      >
        {formError && <InlineAlert tone="error">{formError}</InlineAlert>}

        {lockField ? (
          <DefinitionList>
            <DefinitionRow term="Profile field">{PROFILE_FIELD_LABELS[field]}</DefinitionRow>
          </DefinitionList>
        ) : (
          <Field label="Profile field">
            <Select value={field} onChange={(event) => changeField(event.target.value)}>
              {PROFILE_FIELDS.map((entry) => (
                <option key={entry} value={entry}>
                  {PROFILE_FIELD_LABELS[entry]}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Statement" error={statementError} required>
          <Textarea
            ref={statementRef}
            value={statement}
            onChange={(event) => {
              setStatement(event.target.value);
              if (statementError) setStatementError(null);
            }}
            rows={4}
          />
        </Field>

        <Fieldset
          legend="Evidence from your documents"
          hint="Optional. Pick the passages that support the statement. They are cited word for word, and BulleBrowser checks each one against its document."
        >
          <EvidencePicker suggestions={suggestions} picks={picks} onChange={setPicks} />
        </Fieldset>
      </form>
    </Dialog>
  );
}

function EvidencePicker({
  suggestions,
  picks,
  onChange,
}: {
  suggestions: AsyncResult<KnowledgePassage[]>;
  picks: EvidencePicks;
  onChange(picks: EvidencePicks): void;
}) {
  if (suggestions.state === 'loading') {
    return <LoadingBlock label="Looking for passages in your documents" lines={3} />;
  }
  if (suggestions.state === 'error') {
    return (
      <InlineAlert
        tone="error"
        action={
          <Button size="sm" onClick={suggestions.reload}>
            Try again
          </Button>
        }
      >
        {suggestions.error.message} You can still add the statement without evidence.
      </InlineAlert>
    );
  }
  if (suggestions.value.length === 0) {
    return (
      <p className={text.small}>
        No passage in your documents speaks to this field. You can still add the statement; it will
        say “{NO_SOURCE_DOCUMENT}”.
      </p>
    );
  }
  return (
    <ul className={layout.list}>
      {suggestions.value.map((passage) => {
        const key = passageKey(passage);
        return (
          <EvidenceOption
            key={key}
            passage={passage}
            pick={picks.get(key)}
            onToggle={(picked) => onChange(togglePick(picks, passage, picked))}
            onPart={(part) => onChange(withPart(picks, key, part))}
          />
        );
      })}
    </ul>
  );
}

/** Enough lines to show most passages whole, without one long passage filling the dialog. */
function rowsFor(passage: string): number {
  const lines = Math.ceil(passage.length / 70) + (passage.match(/\n/g)?.length ?? 0);
  return Math.min(10, Math.max(3, lines));
}

function EvidenceOption({
  passage,
  pick,
  onToggle,
  onPart,
}: {
  passage: KnowledgePassage;
  pick: EvidencePick | undefined;
  onToggle(picked: boolean): void;
  onPart(part: PartRange | null): void;
}) {
  const passageRef = useRef<HTMLTextAreaElement>(null);
  const source = formatCitationSource(passage);
  const citable = canCite(passage);

  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <Checkbox
        label={
          <>
            Use as evidence<span className="sr-only">: {source}</span>
          </>
        }
        hint={citable ? undefined : 'This passage cannot be cited.'}
        checked={Boolean(pick)}
        disabled={!citable}
        onChange={onToggle}
      />
      <p className={text.caption}>{source}</p>
      {pick ? (
        <>
          {/* Read-only, so the words cannot be changed, and a text field, so a
              part of them can be selected with the keyboard as well as the mouse. */}
          <Field
            label="Passage to cite"
            hint="To cite only part of the passage, select that part of the text."
          >
            <Textarea
              ref={passageRef}
              readOnly
              value={passage.text}
              rows={rowsFor(passage.text)}
              onSelect={(event) => {
                const { selectionStart, selectionEnd } = event.currentTarget;
                // A caret is not a selection: a part once chosen stays until
                // another is selected or it is given up with the button below.
                if (selectionStart === selectionEnd) return;
                onPart(partOf(passage.text, selectionStart, selectionEnd));
              }}
            />
          </Field>
          {pick.part ? (
            <div className={layout.stack}>
              <p role="status" className={text.small}>
                Only this part will be cited:
              </p>
              <PassageQuote>{quoteOf(pick)}</PassageQuote>
              <div>
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() => {
                    onPart(null);
                    // The button goes with the part; focus stays with the passage.
                    passageRef.current?.focus();
                  }}
                >
                  Cite the whole passage
                </Button>
              </div>
            </div>
          ) : (
            <p role="status" className={text.small}>
              The whole passage will be cited.
            </p>
          )}
        </>
      ) : (
        <PassageQuote>{passage.text}</PassageQuote>
      )}
    </li>
  );
}

// ───────────────────────────────── edit a statement ────────────────────────────

export interface EditStatementDialogProps {
  claim: ProfileClaim;
  onClose(): void;
  onSaved(profile: OrganizationProfile): void;
}

/** Changes a statement's wording. Its sources are shown beside it and cannot be changed here. */
export function EditStatementDialog({ claim, onClose, onSaved }: EditStatementDialogProps) {
  const formId = useId();
  const alive = useAlive();
  const statementRef = useRef<HTMLTextAreaElement>(null);
  const [statement, setStatement] = useState(claim.text);
  const [statementError, setStatementError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const checked = checkStatement(statement);
    if (!checked.ok) {
      setStatementError(checked.error);
      statementRef.current?.focus();
      return;
    }
    if (sameWording(claim.text, checked.text)) {
      onClose();
      return;
    }
    setStatementError(null);
    setFormError(null);
    setBusy(true);
    try {
      const profile = await unwrap(fundingBridge().knowledge.updateClaim(claim.id, checked.text));
      if (alive.current) onSaved(profile);
    } catch (error) {
      if (!alive.current) return;
      setFormError(toCallError(error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Edit statement"
      size="lg"
      primaryAction={{
        label: 'Save statement',
        form: formId,
        busy,
        busyLabel: 'Saving the statement',
      }}
      secondaryAction={{ label: 'Discard changes', disabled: busy }}
      dismissable={!busy}
    >
      <form
        id={formId}
        noValidate
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-5"
      >
        {formError && <InlineAlert tone="error">{formError}</InlineAlert>}
        <Field
          label="Statement"
          error={statementError}
          hint={
            claim.origin === 'extracted' && !claim.edited
              ? 'Once you change the wording, the statement is labelled “Edited”.'
              : undefined
          }
          required
        >
          <Textarea
            ref={statementRef}
            value={statement}
            onChange={(event) => {
              setStatement(event.target.value);
              if (statementError) setStatementError(null);
            }}
            rows={5}
          />
        </Field>
        <div className={layout.stack}>
          <p className={text.overline}>Sources of this statement</p>
          {claim.citations.length > 0 ? (
            <>
              <CitationList citations={claim.citations} />
              <p className={text.caption}>Keep the wording true to what these passages say.</p>
            </>
          ) : (
            <p className={text.small}>{NO_SOURCE_DOCUMENT}</p>
          )}
        </div>
      </form>
    </Dialog>
  );
}

// ──────────────────────────────── remove a statement ───────────────────────────

export interface RemoveStatementDialogProps {
  claim: ProfileClaim;
  onClose(): void;
  onRemoved(profile: OrganizationProfile): void;
}

export function RemoveStatementDialog({ claim, onClose, onRemoved }: RemoveStatementDialogProps) {
  const alive = useAlive();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const profile = await unwrap(fundingBridge().knowledge.deleteClaim(claim.id));
      if (alive.current) onRemoved(profile);
    } catch (failure) {
      if (!alive.current) return;
      setError(toCallError(failure).message);
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Remove this statement?"
      primaryAction={{
        label: 'Remove statement',
        variant: 'danger',
        busy,
        busyLabel: 'Removing the statement',
        onClick: () => void remove(),
      }}
      secondaryAction={{ label: 'Keep statement', disabled: busy }}
      dismissable={!busy}
    >
      <div className={layout.stack}>
        <p className="whitespace-pre-line break-words text-sm leading-6 text-ink-inverse">
          {claim.text}
        </p>
        <p className={text.small}>
          {claim.status === 'approved'
            ? 'It will no longer be part of your profile. This cannot be undone.'
            : 'The statement is deleted. This cannot be undone.'}
        </p>
        {error && <InlineAlert tone="error">{error}</InlineAlert>}
      </div>
    </Dialog>
  );
}
