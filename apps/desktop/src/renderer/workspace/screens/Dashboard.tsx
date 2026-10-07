import { useId, type ReactNode } from 'react';
import {
  ORGANIZATION_KIND_LABELS,
  type RfpDocument,
  type SavedOpportunity,
} from '../../../shared/funding.js';
import {
  NOT_STATED,
  formatDate,
  formatDateTime,
  formatDay,
  fundingBridge,
  unwrap,
  useAsync,
  type AsyncResult,
} from '../../lib/funding-client.js';
import {
  useActiveOrganization,
  useCan,
  useFundingEvent,
  useWorkspaceStore,
} from '../../state/workspace-store.js';
import { ALIGNMENT_STATE_LABELS, ANALYSIS_STATE_LABELS, describeActivity } from '../activity.js';
import {
  COMPLETE_PROFILE_FIRST,
  GUIDANCE_USES_APPROVED,
  NEEDS_ASSISTANT,
  POSITIONING_SHORT,
  WORKS_WITHOUT_ASSISTANT,
} from '../copy.js';
import { ErrorBoundary } from '../ErrorBoundary.js';
import { openAssistantSettings } from '../settings-intent.js';
import { setupProgress } from '../setup.js';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  InlineAlert,
  LoadingBlock,
  Screen,
  SectionHeading,
  StatusBadge,
  card,
  cx,
  layout,
  text,
} from '../ui/index.js';
import { WORKFLOWS } from '../workflows.js';

/** How many rows a dashboard list shows before pointing to the full screen. */
const LIST_LIMIT = 5;

/**
 * The workspace's home for one organization: how far its setup has got, the
 * four things BulleBrowser helps with, and what the organization has in hand.
 * Each card loads on its own and shows its own loading, empty and error
 * states, so one that fails never blanks the rest.
 */
export function Dashboard() {
  const organization = useActiveOrganization();

  return (
    <Screen
      title={organization?.name ?? 'Dashboard'}
      titleAddon={
        organization && <Badge icon="building">{ORGANIZATION_KIND_LABELS[organization.kind]}</Badge>
      }
      description={POSITIONING_SHORT}
    >
      <ErrorBoundary what="Profile setup">
        <SetupCard />
      </ErrorBoundary>
      <div className={layout.section}>
        <WorkflowChoices />
        <AssistantNote />
      </div>
      <div className={layout.cardGrid}>
        <ErrorBoundary what="Saved opportunities">
          <SavedOpportunitiesCard />
        </ErrorBoundary>
        <ErrorBoundary what="Funding documents">
          <FundingDocumentsCard />
        </ErrorBoundary>
      </div>
      <ErrorBoundary what="Recent activity">
        <RecentActivityCard />
      </ErrorBoundary>
    </Screen>
  );
}

// ───────────────────────────────── profile setup ───────────────────────────────

function SetupCard() {
  const headingId = useId();
  const setup = useWorkspaceStore((state) => state.setup);
  const status = useWorkspaceStore((state) => state.setupStatus);
  const error = useWorkspaceStore((state) => state.setupError);
  const refreshSetup = useWorkspaceStore((state) => state.refreshSetup);
  const navigate = useWorkspaceStore((state) => state.navigate);

  if (!setup) {
    return (
      <Card as="section" padding="lg" aria-labelledby={headingId} className={layout.section}>
        <SectionHeading level={2} id={headingId} title="Profile setup" />
        {status === 'error' ? (
          <InlineAlert
            tone="error"
            action={
              <Button size="sm" onClick={() => void refreshSetup()}>
                Try again
              </Button>
            }
          >
            {error?.message ?? 'The setup status could not be loaded.'}
          </InlineAlert>
        ) : (
          <LoadingBlock label="Loading profile setup" />
        )}
      </Card>
    );
  }

  const progress = setupProgress(setup);
  if (progress.complete) return <SetupComplete />;

  return (
    <Card as="section" padding="lg" aria-labelledby={headingId} className={layout.section}>
      <SectionHeading
        level={2}
        id={headingId}
        title="Profile setup"
        addon={
          <Badge>
            {progress.completed} of {progress.total}
          </Badge>
        }
      />
      {/* The steps, then what to do next: side by side when the card is wide. */}
      <div className={layout.split}>
        <ol className="flex flex-col gap-3">
          {setup.steps.map((step) => (
            <li key={step.id} className="flex items-start gap-2.5">
              <Icon
                name={step.done ? 'check-circle' : 'circle'}
                className={cx('mt-0.5', step.done ? 'text-emerald-300' : 'text-ink-inverse/60')}
              />
              <div className="min-w-0">
                <p
                  className={cx(
                    'text-sm leading-5',
                    step.done ? 'text-ink-inverse/85' : 'text-ink-inverse',
                  )}
                >
                  {step.label}
                  <span className="sr-only">{step.done ? ' (done)' : ' (not done)'}</span>
                </p>
                {step.detail && <p className={cx(text.caption, 'mt-0.5')}>{step.detail}</p>}
              </div>
            </li>
          ))}
        </ol>
        <div className="flex flex-col items-start gap-3">
          {setup.nextAction && <p className={text.body}>{setup.nextAction}</p>}
          <Button
            variant="primary"
            trailingIcon="arrow-right"
            onClick={() => navigate('knowledge')}
          >
            Open Organization Knowledge Hub
          </Button>
          {/* Tailored guidance rests on approved statements only. Once some are
              approved, the first sentence would no longer be true. */}
          <p className={text.caption}>
            {setup.readyForTailoredGuidance ? GUIDANCE_USES_APPROVED : COMPLETE_PROFILE_FIRST}
          </p>
        </div>
      </div>
    </Card>
  );
}

/** Setup is done: a quiet line with the day the profile was last approved. */
function SetupComplete() {
  const navigate = useWorkspaceStore((state) => state.navigate);
  const profile = useAsync(() => unwrap(fundingBridge().knowledge.getProfile()), []);
  useFundingEvent(['profile_changed'], profile.reload);
  const approvedAt = profile.state === 'ready' ? profile.value.approvedAt : null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <p
        role="status"
        className="flex min-w-0 flex-1 basis-64 items-start gap-2 text-sm leading-5 text-ink-inverse/85"
      >
        <Icon name="check-circle" className="mt-0.5 text-emerald-300" />
        <span>
          Profile setup is complete.
          {approvedAt !== null && ` Your profile was last approved on ${formatDay(approvedAt)}.`}
        </span>
      </p>
      <Button size="sm" variant="quiet" onClick={() => navigate('knowledge', { tab: 'profile' })}>
        Review profile
      </Button>
    </div>
  );
}

// ─────────────────────────── what can I help you with? ─────────────────────────

function WorkflowChoices() {
  const baseId = useId();
  const navigate = useWorkspaceStore((state) => state.navigate);

  return (
    <section aria-labelledby={`${baseId}-heading`} className={layout.section}>
      <SectionHeading level={2} id={`${baseId}-heading`} title="What can I help you with?" />
      <ul className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr))]">
        {WORKFLOWS.map((workflow) => {
          const labelId = `${baseId}-${workflow.id}-label`;
          const descriptionId = `${baseId}-${workflow.id}-description`;
          return (
            <li key={workflow.id}>
              <button
                type="button"
                aria-labelledby={labelId}
                aria-describedby={descriptionId}
                onClick={() => navigate(workflow.route, workflow.params)}
                className={cx(card.interactive, 'flex h-full w-full items-start gap-3 p-4')}
              >
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/[0.12] text-primary">
                  <Icon name={workflow.icon} size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    id={labelId}
                    className="block text-sm font-semibold leading-5 text-ink-inverse"
                  >
                    {workflow.label}
                  </span>
                  <span id={descriptionId} className={cx(text.small, 'mt-1 block')}>
                    {workflow.description}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** One calm line when no assistant is connected: what still works, and where to connect one. */
function AssistantNote() {
  const assistant = useWorkspaceStore((state) => state.assistant);
  if (!assistant || assistant.connected) return null;

  return (
    <p className={cx(text.small, 'flex items-start gap-2')}>
      <Icon name="info" className="mt-0.5 text-ink-inverse/60" />
      <span>
        No assistant is connected. {assistant.note.trim() || WORKS_WITHOUT_ASSISTANT}{' '}
        {NEEDS_ASSISTANT}{' '}
        <button type="button" onClick={openAssistantSettings} className={text.link}>
          Open Settings
        </button>
      </span>
    </p>
  );
}

// ──────────────────────────────── the list cards ───────────────────────────────

/** The frame the list cards share: a heading, then loading, an error with a retry, or the content. */
function ListCard<T>({
  title,
  loadingLabel,
  result,
  action,
  children,
}: {
  title: string;
  loadingLabel: string;
  result: AsyncResult<T>;
  action?: ReactNode;
  children(value: T): ReactNode;
}) {
  const headingId = useId();
  return (
    <Card as="section" padding="lg" aria-labelledby={headingId} className={layout.section}>
      <SectionHeading
        level={2}
        id={headingId}
        title={title}
        actions={result.state === 'ready' ? action : undefined}
      />
      {result.state === 'loading' && <LoadingBlock label={loadingLabel} />}
      {result.state === 'error' && (
        <InlineAlert
          tone="error"
          action={
            <Button size="sm" onClick={result.reload}>
              Try again
            </Button>
          }
        >
          {result.error.message}
        </InlineAlert>
      )}
      {result.state === 'ready' && children(result.value)}
    </Card>
  );
}

const ROW_TITLE =
  '-mx-1.5 block w-[calc(100%+0.75rem)] rounded-md px-1.5 py-0.5 text-left text-sm font-medium leading-5 text-ink-inverse transition-colors hover:bg-white/[0.07] hover:text-primary';

function SavedOpportunitiesCard() {
  const navigate = useWorkspaceStore((state) => state.navigate);
  const saved = useAsync(() => unwrap(fundingBridge().opportunities.listSaved()), []);
  useFundingEvent(['saved_changed'], saved.reload);
  const total = saved.state === 'ready' ? saved.value.length : 0;

  return (
    <ListCard
      title="Saved opportunities"
      loadingLabel="Loading saved opportunities"
      result={saved}
      action={
        total > LIST_LIMIT ? (
          <Button
            size="sm"
            variant="quiet"
            onClick={() => navigate('opportunities', { view: 'saved' })}
          >
            View all {total}
          </Button>
        ) : undefined
      }
    >
      {(items) =>
        items.length === 0 ? (
          <EmptyState
            icon="bookmark"
            title="No saved opportunities yet"
            body="Listings you save in Opportunities appear here with their current status and deadline."
            action={
              <Button size="sm" onClick={() => navigate('opportunities')}>
                Go to Opportunities
              </Button>
            }
          />
        ) : (
          <ul className={layout.list}>
            {items.slice(0, LIST_LIMIT).map((item) => (
              <SavedOpportunityRow key={item.opportunity.id} item={item} />
            ))}
          </ul>
        )
      }
    </ListCard>
  );
}

function SavedOpportunityRow({ item }: { item: SavedOpportunity }) {
  const navigate = useWorkspaceStore((state) => state.navigate);
  const { opportunity } = item;
  // The date the app read, or else the deadline in the source's own words.
  const deadline = opportunity.closeDate
    ? formatDate(opportunity.closeDate)
    : opportunity.closeDateText.trim() || NOT_STATED;

  return (
    <li className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
      <div>
        <button
          type="button"
          onClick={() =>
            navigate('opportunities', { view: 'saved', opportunityId: opportunity.id })
          }
          className={ROW_TITLE}
        >
          {opportunity.title}
        </button>
        <p className={text.caption}>{opportunity.funder}</p>
      </div>
      <StatusBadge
        kind="opportunity"
        status={opportunity.status}
        reason={opportunity.statusReason}
      />
      <p className={text.caption}>
        Deadline: {deadline}
        <span aria-hidden="true"> · </span>
        <span className="sr-only">. </span>
        Status checked {formatDateTime(item.recheckedAt)}
      </p>
    </li>
  );
}

function FundingDocumentsCard() {
  const navigate = useWorkspaceStore((state) => state.navigate);
  const documents = useAsync(() => unwrap(fundingBridge().rfps.list()), []);
  useFundingEvent(['rfps_changed', 'job'], (event) => {
    if (event.kind === 'rfps_changed') documents.reload();
    else if (
      event.job.state !== 'running' &&
      (event.job.kind === 'rfp_processing' ||
        event.job.kind === 'rfp_analysis' ||
        event.job.kind === 'alignment')
    ) {
      documents.reload();
    }
  });
  const total = documents.state === 'ready' ? documents.value.length : 0;

  return (
    <ListCard
      title="Funding documents in analysis"
      loadingLabel="Loading funding documents"
      result={documents}
      action={
        total > LIST_LIMIT ? (
          <Button size="sm" variant="quiet" onClick={() => navigate('rfp')}>
            View all {total}
          </Button>
        ) : undefined
      }
    >
      {(items) =>
        items.length === 0 ? (
          <EmptyState
            icon="document"
            title="No funding documents yet"
            body="Add a funding notice or a request for proposals in RFP Analysis to see what the funder asks for."
            action={
              <Button size="sm" onClick={() => navigate('rfp')}>
                Go to RFP Analysis
              </Button>
            }
          />
        ) : (
          <ul className={layout.list}>
            {items.slice(0, LIST_LIMIT).map((item) => (
              <FundingDocumentRow key={item.id} document={item} />
            ))}
          </ul>
        )
      }
    </ListCard>
  );
}

function FundingDocumentRow({ document }: { document: RfpDocument }) {
  const navigate = useWorkspaceStore((state) => state.navigate);
  const read = document.status === 'ready';
  const analysis = document.analysisStatus;
  const alignment = document.alignmentStatus;
  // Say why something failed, where main gave a reason.
  const problem =
    document.status === 'failed'
      ? document.statusDetail
      : analysis.state === 'failed'
        ? analysis.error
        : alignment.state === 'failed'
          ? alignment.error
          : '';

  return (
    <li className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
      <div>
        <button
          type="button"
          onClick={() => navigate('rfp', { rfpId: document.id, view: 'analysis' })}
          className={ROW_TITLE}
        >
          {document.name}
        </button>
        <p className={text.caption}>Added {formatDay(document.uploadedAt)}</p>
      </div>
      <div className={layout.row}>
        {read ? (
          <>
            <StatusBadge
              kind="analysis"
              status={analysis.state}
              label={ANALYSIS_STATE_LABELS[analysis.state]}
            />
            {alignment.state !== 'none' && (
              <StatusBadge
                kind="analysis"
                status={alignment.state}
                label={ALIGNMENT_STATE_LABELS[alignment.state]}
              />
            )}
          </>
        ) : (
          <StatusBadge kind="document" status={document.status} />
        )}
      </div>
      {problem && <p className="text-xs leading-4 text-red-300">{problem}</p>}
    </li>
  );
}

// ──────────────────────────────── recent activity ──────────────────────────────

/**
 * The organization's activity record. Only people whose role may read it see
 * it: the card appears when the call succeeds and is simply absent otherwise.
 */
function RecentActivityCard() {
  const headingId = useId();
  const mayRead = useCan('audit.read');
  const activity = useAsync(
    () => (mayRead ? unwrap(fundingBridge().identity.activity(8)) : Promise.resolve(null)),
    [mayRead],
  );
  useFundingEvent(
    [
      'documents_changed',
      'profile_changed',
      'rfps_changed',
      'guides_changed',
      'saved_changed',
      'identity_changed',
    ],
    activity.reload,
  );

  if (activity.state !== 'ready' || activity.value === null) return null;

  return (
    <Card as="section" padding="lg" aria-labelledby={headingId} className={layout.section}>
      <SectionHeading level={2} id={headingId} title="Recent activity" />
      {activity.value.length === 0 ? (
        <p className={text.small}>Nothing has been recorded yet.</p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {activity.value.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5">
              <span className={cx(text.caption, 'w-40 shrink-0 tabular-nums')}>
                {formatDateTime(entry.at)}
              </span>
              <span className="min-w-0 flex-1 basis-56 break-words text-sm leading-5 text-ink-inverse/85">
                {describeActivity(entry)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
