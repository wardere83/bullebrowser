// Asks before anything leaves the device.
//
// Two kinds of work send information out: reading documents with the connected
// assistant, and searching the official funding sources. Main refuses both
// with CONSENT_REQUIRED until someone who manages the organization's settings
// has agreed once. A screen wraps such a call in `consent.run(...)` and renders
// `consent.dialog`: the first refusal opens this dialog, agreeing records the
// answer and runs the call again, and declining ends it with CANCELLED, which
// screens already treat as nothing having happened.

import { useCallback, useRef, useState, type ReactNode } from 'react';
import type { OrgConsents } from '../../shared/funding.js';
import { FundingCallError, toCallError } from '../lib/funding-client.js';
import { useCan, useWorkspaceStore } from '../state/workspace-store.js';
import { Dialog, InlineAlert, layout, text } from './ui/index.js';

type ConsentKind = keyof OrgConsents;

export const CONSENT_COPY: Record<ConsentKind, { title: string; points: string[]; agree: string }> = {
  documentAnalysisAt: {
    title: 'Send document excerpts to the assistant',
    points: [
      'To read your documents, BulleBrowser sends excerpts of them to the AI assistant connected in Settings, using your own key.',
      'Excerpts are sent only for the step you ask for, such as drafting a profile or analyzing an RFP.',
      'Your files stay on this device. Without this, BulleBrowser still reads, searches and quotes them here.',
    ],
    agree: 'Allow for this organization',
  },
  liveFundingSearchAt: {
    title: 'Search the official funding sources',
    points: [
      'To find listings, BulleBrowser sends the search words and filters shown on this screen to the official sources it reads.',
      'It does not send your documents or your approved profile to those sources.',
      'Each listing is shown with the source it came from and when it was read.',
    ],
    agree: 'Allow for this organization',
  },
};

interface Pending {
  kind: ConsentKind;
  resume(): void;
  decline(): void;
}

const declined = () => new FundingCallError('CANCELLED', 'Nothing was sent.');

export interface ConsentGate {
  /** Runs the call, asking for the acknowledgement first when main says it is missing. */
  run<T>(call: () => Promise<T>): Promise<T>;
  /** Render this once in the screen. */
  dialog: ReactNode;
}

export function useConsentGate(): ConsentGate {
  const recordConsent = useWorkspaceStore((state) => state.recordConsent);
  const mayAgree = useCan('settings.manage');
  const [pending, setPending] = useState<Pending | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState('');
  // One question at a time: a second call that needs the same answer waits for the first.
  const open = useRef<Promise<void> | null>(null);

  const ask = useCallback((kind: ConsentKind): Promise<void> => {
    open.current ??= new Promise<void>((resolve, reject) => {
      setFailure('');
      setPending({ kind, resume: resolve, decline: () => reject(declined()) });
    }).finally(() => {
      open.current = null;
    });
    return open.current;
  }, []);

  const run = useCallback(
    async <T,>(call: () => Promise<T>): Promise<T> => {
      try {
        return await call();
      } catch (error) {
        const failed = toCallError(error);
        if (failed.code !== 'CONSENT_REQUIRED' || !failed.consent) throw failed;
        await ask(failed.consent);
        return call();
      }
    },
    [ask],
  );

  const agree = async () => {
    if (!pending || saving) return;
    setSaving(true);
    setFailure('');
    try {
      await recordConsent(pending.kind);
      setPending(null);
      pending.resume();
    } catch (error) {
      setFailure(toCallError(error).message);
    } finally {
      setSaving(false);
    }
  };

  const decline = () => {
    if (!pending || saving) return;
    setPending(null);
    pending.decline();
  };

  const copy = pending ? CONSENT_COPY[pending.kind] : null;
  const dialog = copy ? (
    <Dialog
      open
      onClose={decline}
      title={copy.title}
      size="md"
      dismissable={!saving}
      primaryAction={
        mayAgree
          ? { label: copy.agree, onClick: () => void agree(), busy: saving, busyLabel: 'Saving your answer' }
          : undefined
      }
      secondaryAction={{ label: 'Not now', onClick: decline, disabled: saving }}
    >
      <div className={layout.stack}>
        <ul className={`${layout.stack} list-disc pl-5 ${text.body}`}>
          {copy.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        <p className={text.small}>You are asked once for each organization. The answer is kept in its activity record.</p>
        {mayAgree ? null : (
          <InlineAlert tone="info">
            Only an owner or admin of this organization can allow this. Ask one of them to open this screen.
          </InlineAlert>
        )}
        {failure ? <InlineAlert tone="error">{failure}</InlineAlert> : null}
      </div>
    </Dialog>
  ) : null;

  return { run, dialog };
}
