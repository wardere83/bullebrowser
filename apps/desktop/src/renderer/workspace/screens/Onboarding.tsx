import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import {
  ACCEPTED_EXTENSIONS,
  KNOWLEDGE_CATEGORY_LABELS,
  MAX_DOCUMENT_BYTES,
  PROFILE_FIELDS,
  PROFILE_FIELD_LABELS,
  type DocumentFormat,
  type KnowledgeCategory,
  type KnowledgeDocument,
} from '../../../shared/funding.js';
import {
  type FundingCallError,
  formatFileSize,
  fundingBridge,
  pluralize,
  toCallError,
  unwrap,
  useAsync,
} from '../../lib/funding-client.js';
import {
  useActiveOrganization,
  useFundingEvent,
  useJob,
  useWorkspaceStore,
} from '../../state/workspace-store.js';
import { KNOWLEDGE_HUB_DESCRIPTION, POSITIONING } from '../copy.js';
import { OrganizationForm } from '../OrganizationForm.js';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  InlineAlert,
  LoadingBlock,
  SectionHeading,
  StatusBadge,
  announce,
  cx,
  layout,
  text,
  type IconName,
} from '../ui/index.js';

type Step = 1 | 2 | 3;

const STEPS: readonly { number: Step; label: string }[] = [
  { number: 1, label: 'Your organization' },
  { number: 2, label: 'Organization Knowledge Hub' },
  { number: 3, label: 'Review your profile' },
];

const FORMAT_NAMES: Record<DocumentFormat, string> = {
  pdf: 'PDF',
  docx: 'DOCX',
  txt: 'TXT',
  md: 'Markdown',
};

/** "a, b, c and d". */
function listInWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const ACCEPTED_FORMATS = listInWords(
  (Object.keys(ACCEPTED_EXTENSIONS) as DocumentFormat[]).map((format) => FORMAT_NAMES[format]),
);

/** The kinds of document worth adding: every category the hub knows, bar the catch-all. */
const USEFUL_DOCUMENTS = (Object.keys(KNOWLEDGE_CATEGORY_LABELS) as KnowledgeCategory[])
  .filter((category) => category !== 'other')
  .map((category) => KNOWLEDGE_CATEGORY_LABELS[category]);

const PROFILE_TOPICS = listInWords(
  PROFILE_FIELDS.map((field) => PROFILE_FIELD_LABELS[field].toLowerCase()),
);

/**
 * The first-run steps, shown in the page slot while there is no organization
 * and, once one has been created here, until the user finishes or leaves. It
 * is a screen like any other: the assistant panel stays where it is and stays
 * usable throughout. After the first step it can be left at any point; the
 * dashboard then carries the setup status.
 */
export function Onboarding() {
  const organization = useActiveOrganization();
  const [chosenStep, setChosenStep] = useState<Step>(organization ? 2 : 1);
  // Without an organization there is nothing for the later steps to work on.
  const step: Step = organization ? chosenStep : 1;

  // Each step is a new view: move focus to its heading so a keyboard or
  // screen-reader user lands at the top of it. Not on first render, when the
  // assistant's composer rightly has focus.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    headingRef.current?.focus();
  }, [step]);

  return (
    <div className="mx-auto flex w-full max-w-[42rem] flex-col gap-8">
      <Stepper current={step} />
      {step === 1 && (
        <OrganizationStep headingRef={headingRef} onCreated={() => setChosenStep(2)} />
      )}
      {step === 2 && <DocumentsStep headingRef={headingRef} onContinue={() => setChosenStep(3)} />}
      {step === 3 && <ReviewStep headingRef={headingRef} onBack={() => setChosenStep(2)} />}
    </div>
  );
}

function Stepper({ current }: { current: Step }) {
  return (
    <ol aria-label="Setup steps" className="flex flex-wrap gap-x-6 gap-y-2">
      {STEPS.map((step) => {
        const done = step.number < current;
        const active = step.number === current;
        return (
          <li
            key={step.number}
            aria-current={active ? 'step' : undefined}
            className={cx(
              'flex items-center gap-2 text-[13px] leading-5',
              active
                ? 'font-semibold text-ink-inverse'
                : done
                  ? 'text-ink-inverse/85'
                  : 'text-ink-inverse/70',
            )}
          >
            <span
              className={cx(
                'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                active
                  ? 'border-primary bg-primary text-surface-dark'
                  : done
                    ? 'border-primary text-primary'
                    : 'border-white/40 text-ink-inverse/70',
              )}
            >
              {done ? (
                <>
                  <Icon name="check" size={12} />
                  <span className="sr-only">{step.number}</span>
                </>
              ) : (
                step.number
              )}
            </span>
            <span>{step.label}</span>
            {done && <span className="sr-only">(done)</span>}
          </li>
        );
      })}
    </ol>
  );
}

type HeadingRef = RefObject<HTMLHeadingElement | null>;

// ───────────────────────────── 1. Your organization ────────────────────────────

function OrganizationStep({
  headingRef,
  onCreated,
}: {
  headingRef: HeadingRef;
  onCreated(): void;
}) {
  const createOrganization = useWorkspaceStore((state) => state.createOrganization);
  const formHeadingId = useId();

  return (
    <>
      <SectionHeading
        level={1}
        title="Welcome to BulleBrowser"
        description={POSITIONING}
        headingRef={headingRef}
      />
      <Card as="section" padding="lg" aria-labelledby={formHeadingId} className={layout.section}>
        <SectionHeading
          level={2}
          id={formHeadingId}
          title="Your organization"
          description="Start with the organization this guidance is for. You can add others later."
        />
        <OrganizationForm
          submitLabel="Create organization"
          busyLabel="Creating organization"
          onSubmit={async (input) => {
            await createOrganization(input, { onboarding: true });
            onCreated();
          }}
        />
      </Card>
    </>
  );
}

// ─────────────────────────── 2. Organization Knowledge Hub ─────────────────────

/** Leaves the first-run steps for the dashboard, whatever route was set in the meantime. */
function useLeaveOnboarding(): () => void {
  const finishOnboarding = useWorkspaceStore((state) => state.finishOnboarding);
  const navigate = useWorkspaceStore((state) => state.navigate);
  return () => {
    finishOnboarding();
    navigate('dashboard');
  };
}

function DocumentsStep({ headingRef, onContinue }: { headingRef: HeadingRef; onContinue(): void }) {
  const leave = useLeaveOnboarding();
  const listHeadingId = useId();
  const documents = useAsync(() => unwrap(fundingBridge().knowledge.listDocuments()), []);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<FundingCallError | null>(null);

  useFundingEvent(['documents_changed', 'job'], (event) => {
    // A document's state changes while it is read; reload when main says the
    // list changed or a document's job ends, not on every progress tick.
    if (event.kind === 'documents_changed') documents.reload();
    else if (event.job.kind === 'document_processing' && event.job.state !== 'running') {
      documents.reload();
    }
  });

  const add = async () => {
    if (adding) return;
    setAdding(true);
    setAddError(null);
    try {
      const added = await unwrap(fundingBridge().knowledge.addDocuments());
      if (added.length > 0) announce(`${pluralize(added.length, 'document')} added.`);
      documents.reload();
    } catch (error) {
      const failure = toCallError(error);
      // Closing the file picker without choosing anything is not a failure.
      if (failure.code !== 'CANCELLED') setAddError(failure);
    } finally {
      setAdding(false);
    }
  };

  const count = documents.value?.length ?? 0;
  const hasDocuments = count > 0;

  return (
    <>
      <SectionHeading
        level={1}
        title="Organization Knowledge Hub"
        description={KNOWLEDGE_HUB_DESCRIPTION}
        headingRef={headingRef}
      />

      <Card padding="lg" className={layout.section}>
        <SectionHeading
          level={2}
          title="What you can upload"
          description={`${ACCEPTED_FORMATS} files, up to ${formatFileSize(MAX_DOCUMENT_BYTES)} each. Documents stay on this device.`}
        />
        <div>
          <p className={text.caption}>Documents that help</p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {USEFUL_DOCUMENTS.map((label) => (
              <li key={label}>
                <Badge>{label}</Badge>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <Button
            variant={hasDocuments ? 'secondary' : 'primary'}
            icon="upload"
            busy={adding}
            busyLabel="Opening the file picker"
            onClick={() => void add()}
          >
            Add documents
          </Button>
        </div>
        {addError && <InlineAlert tone="error">{addError.message}</InlineAlert>}
      </Card>

      <section aria-labelledby={listHeadingId} className={layout.section}>
        <SectionHeading
          level={2}
          id={listHeadingId}
          title="Added documents"
          description={hasDocuments ? `${pluralize(count, 'document')} added so far.` : undefined}
        />
        {documents.state === 'loading' && <LoadingBlock label="Loading documents" lines={2} />}
        {documents.state === 'error' && (
          <InlineAlert
            tone="error"
            action={
              <Button size="sm" onClick={documents.reload}>
                Try again
              </Button>
            }
          >
            {documents.error.message}
          </InlineAlert>
        )}
        {documents.state === 'ready' &&
          (documents.value.length === 0 ? (
            <Card>
              <EmptyState
                icon="document"
                title="No documents yet"
                body="Documents you add are listed here while BulleBrowser reads them."
              />
            </Card>
          ) : (
            <Card padding="none">
              <ul className={cx(layout.list, 'px-4')}>
                {documents.value.map((document) => (
                  <DocumentRow key={document.id} document={document} />
                ))}
              </ul>
            </Card>
          ))}
      </section>

      <div className="flex flex-col gap-2">
        <div className={layout.row}>
          <Button
            variant={hasDocuments ? 'primary' : 'secondary'}
            trailingIcon="arrow-right"
            disabled={!hasDocuments}
            onClick={onContinue}
          >
            Continue
          </Button>
          <Button variant="quiet" onClick={leave}>
            Do this later
          </Button>
        </div>
        {!hasDocuments && (
          <p className={text.caption}>
            Add at least one document to continue, or do this later from the dashboard.
          </p>
        )}
      </div>
    </>
  );
}

function DocumentRow({ document }: { document: KnowledgeDocument }) {
  const job = useJob('document_processing', document.id);
  const facts = [
    FORMAT_NAMES[document.format],
    formatFileSize(document.sizeBytes),
    document.pageCount ? pluralize(document.pageCount, 'page') : '',
  ].filter(Boolean);

  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 flex-1 basis-56">
        <p className="break-words text-sm font-medium leading-5 text-ink-inverse">
          {document.name}
        </p>
        <p className={cx(text.caption, 'mt-0.5')}>{facts.join(' · ')}</p>
        {job?.state === 'running' && <p className={cx(text.caption, 'mt-1')}>{job.message}</p>}
        {document.status === 'failed' && document.statusDetail && (
          <p className="mt-1 text-xs leading-4 text-red-300">
            {document.statusDetail} You can retry or replace it in the Organization Knowledge Hub.
          </p>
        )}
        {document.warnings.map((warning, index) => (
          <p key={index} className="mt-1 text-xs leading-4 text-accent">
            {warning}
          </p>
        ))}
      </div>
      <StatusBadge kind="document" status={document.status} />
    </li>
  );
}

// ───────────────────────────── 3. Review your profile ──────────────────────────

const REVIEW_POINTS: readonly { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'document',
    title: 'Proposed from your documents',
    body: `BulleBrowser reads the documents you added and proposes statements about your ${PROFILE_TOPICS}. Each one shows the passage it comes from.`,
  },
  {
    icon: 'check-circle',
    title: 'Nothing is added without approval',
    body: 'A statement becomes part of your profile only when a person approves it. Until then it is a proposal and is not used for guidance.',
  },
  {
    icon: 'question',
    title: 'Missing and conflicting information is flagged',
    body: 'Where your documents leave something out or disagree with each other, BulleBrowser says so and leaves the decision to you. It does not guess.',
  },
];

function ReviewStep({ headingRef, onBack }: { headingRef: HeadingRef; onBack(): void }) {
  const finishOnboarding = useWorkspaceStore((state) => state.finishOnboarding);
  const navigate = useWorkspaceStore((state) => state.navigate);
  const leave = useLeaveOnboarding();
  const assistant = useWorkspaceStore((state) => state.assistant);

  return (
    <>
      <SectionHeading
        level={1}
        title="Review your profile"
        description="Your profile is what BulleBrowser checks funding opportunities and funder requirements against. You decide what goes in it."
        headingRef={headingRef}
      />

      <Card padding="lg">
        <ul className="flex flex-col gap-5">
          {REVIEW_POINTS.map((point) => (
            <li key={point.title} className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.07] text-primary">
                <Icon name={point.icon} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-5 text-ink-inverse">{point.title}</p>
                <p className={cx(text.small, 'mt-1')}>{point.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {assistant && !assistant.connected && (
        <InlineAlert tone="info">
          No assistant is connected, so proposals are exact passages from your documents rather than
          written summaries. You can connect one in Settings at any time.
        </InlineAlert>
      )}

      <div className={layout.row}>
        <Button
          variant="primary"
          onClick={() => {
            finishOnboarding();
            navigate('knowledge', { tab: 'profile' });
          }}
        >
          Review profile
        </Button>
        <Button onClick={leave}>Go to dashboard</Button>
        <Button variant="quiet" onClick={onBack}>
          Back
        </Button>
      </div>
    </>
  );
}
