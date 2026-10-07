// The card in the Profile tab that drafts a profile from the organization's
// documents. It says how a draft would be made right now (with or without a
// connected assistant), starts one, shows its progress with a way to stop it,
// and says how the last one went.

import { useId, useState } from 'react';
import type {
  AssistantAvailability,
  JobProgress,
  ProfileExtractionState,
} from '../../../shared/funding.js';
import { formatDateTime, fundingBridge, toCallError, unwrap } from '../../lib/funding-client.js';
import { useJob, useWorkspaceStore } from '../../state/workspace-store.js';
import type { ConsentGate } from '../ConsentGate.js';
import { openAssistantSettings } from '../settings-intent.js';
import {
  Badge,
  Button,
  Card,
  Icon,
  InlineAlert,
  ProgressNote,
  SectionHeading,
  StatusBadge,
  layout,
  text,
} from '../ui/index.js';
import { CANNOT_DRAFT } from './access.js';
import { draftReadiness, type DocumentTally } from './documents.js';
import { DRAFT_WAYS, draftMode, lastDraftText } from './profile.js';

/**
 * The job that is drafting the profile, or the last one that did. A profile
 * belongs to the organization as a whole, so its job names no subject. Should
 * main name one all the same, there is still only one profile to draft, and
 * the store holds the active organization's jobs only: any job of this kind is
 * the one.
 */
function useDraftJob(): JobProgress | undefined {
  const unnamed = useJob('profile_extraction');
  const any = useWorkspaceStore(
    (state) =>
      state.jobs.find((job) => job.kind === 'profile_extraction' && job.state === 'running') ??
      state.jobs.find((job) => job.kind === 'profile_extraction'),
  );
  return unnamed ?? any;
}

export interface DraftProfileProps {
  /** How the last draft went. Null until the profile has been read. */
  extraction: ProfileExtractionState | null;
  /** The documents by where they have got to. Null when they could not be counted. */
  documents: DocumentTally | null;
  assistant: AssistantAvailability | null;
  canManage: boolean;
  /** True once the profile holds any statement; the draft is then no longer the main thing to do. */
  hasStatements: boolean;
  /** Asks before excerpts of documents are sent to the assistant. */
  runWithConsent: ConsentGate['run'];
  onOpenDocuments(): void;
}

export function DraftProfile({
  extraction,
  documents,
  assistant,
  canManage,
  hasStatements,
  runWithConsent,
  onOpenDocuments,
}: DraftProfileProps) {
  const headingId = useId();
  const job = useDraftJob();
  const stopJob = useWorkspaceStore((state) => state.stopJob);
  const refreshJobs = useWorkspaceStore((state) => state.refreshJobs);
  const [starting, setStarting] = useState(false);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mode = draftMode(assistant);
  const readiness = draftReadiness(documents);
  const running = job?.state === 'running' ? job : null;

  const start = async () => {
    if (starting || running) return;
    setStarting(true);
    setError(null);
    try {
      await runWithConsent(() => unwrap(fundingBridge().knowledge.extractProfile()));
      // Progress arrives as events; the list is read too, in case the first one was missed.
      void refreshJobs();
    } catch (failure) {
      const failed = toCallError(failure);
      // Declining to send excerpts to the assistant is a decision, not a failure.
      if (failed.code !== 'CANCELLED') setError(failed.message);
    } finally {
      setStarting(false);
    }
  };

  const stop = async (jobId: string) => {
    setStoppingId(jobId);
    setError(null);
    try {
      await stopJob(jobId);
    } catch (failure) {
      setStoppingId(null);
      setError(toCallError(failure).message);
    }
  };

  // The job says how the last draft ended while the app still remembers it;
  // after that, the profile's own record of the last run does.
  const failed = job ? job.state === 'failed' : extraction?.status === 'failed';
  const failureDetail =
    job?.state === 'failed' ? job.error?.message || job.message : (extraction?.error ?? '');

  return (
    <Card as="section" padding="lg" aria-labelledby={headingId} className={layout.section}>
      <SectionHeading
        level={3}
        id={headingId}
        title="Draft from your documents"
        description="BulleBrowser reads the documents in your Knowledge Hub and proposes statements for each part of your profile. A draft only proposes: it never changes a statement you have approved."
      />

      <ul className={layout.stack}>
        {(['assistant', 'verbatim'] as const).map((way) => (
          <li key={way} className="flex items-start gap-2.5">
            <Icon
              name={way === 'assistant' ? 'chat' : 'document'}
              className="mt-0.5 text-ink-inverse/60"
            />
            <div className="flex min-w-0 flex-col items-start gap-1.5">
              <p className={text.body}>
                <span className="font-semibold text-ink-inverse">{DRAFT_WAYS[way].title}.</span>{' '}
                {DRAFT_WAYS[way].body}
              </p>
              {mode === way && (
                <Badge tone="info" icon="check">
                  {way === 'assistant'
                    ? 'How it works now: an assistant is connected'
                    : 'How it works now: no assistant is connected'}
                </Badge>
              )}
            </div>
          </li>
        ))}
      </ul>
      {mode === 'unknown' && (
        <p className={text.small}>
          BulleBrowser could not tell whether an assistant is connected. A draft uses one when it
          can.
        </p>
      )}
      {mode === 'verbatim' && (
        <p className={text.small}>
          To have statements drafted and your documents compared, connect an assistant.{' '}
          <button type="button" onClick={openAssistantSettings} className={text.link}>
            Open Settings
          </button>
        </p>
      )}

      {extraction && (
        <p className={text.small}>{lastDraftText(extraction, (at) => formatDateTime(at))}</p>
      )}

      {running ? (
        <ProgressNote
          message={running.message}
          percent={running.percent}
          onStop={() => void stop(running.id)}
          stopping={stoppingId === running.id}
        />
      ) : (
        <>
          {job?.state === 'cancelled' && (
            <StatusBadge
              kind="job"
              status="cancelled"
              reason="The last draft was stopped before it finished."
            />
          )}
          {/* Not read out here: it is still on the page long after it happened.
              The screen says so once, at the moment the draft ends. */}
          {failed && (
            <InlineAlert tone="error" title="The last draft did not finish." announce={false}>
              {failureDetail}
            </InlineAlert>
          )}
          {!job && extraction?.status === 'running' && (
            <p className={text.small}>A draft is being prepared.</p>
          )}
          {canManage ? (
            <div className={layout.stack}>
              <div className={layout.row}>
                <Button
                  variant={hasStatements ? 'secondary' : 'primary'}
                  busy={starting}
                  busyLabel="Starting the draft"
                  disabled={!readiness.ready}
                  onClick={() => void start()}
                >
                  Draft profile from documents
                </Button>
                {!readiness.ready && readiness.openDocuments && (
                  <Button variant="quiet" onClick={onOpenDocuments}>
                    Go to Documents
                  </Button>
                )}
              </div>
              {readiness.ready
                ? readiness.note && <p className={text.caption}>{readiness.note}</p>
                : <p className={text.small}>{readiness.reason}</p>}
            </div>
          ) : (
            <p className={text.small}>{CANNOT_DRAFT}</p>
          )}
        </>
      )}
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
    </Card>
  );
}
