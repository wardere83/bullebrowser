import { useEffect, useState } from 'react';
import {
  fundingBridge,
  toCallError,
  unwrap,
  useAsync,
  formatDateTime,
} from '../../lib/funding-client.js';
import {
  useCan,
  useFundingEvent,
  useJob,
  useRouteParams,
  useWorkspaceStore,
} from '../../state/workspace-store.js';
import { useConsentGate } from '../ConsentGate.js';
import {
  Badge,
  Button,
  Card,
  CitationList,
  Dialog,
  EmptyState,
  Field,
  InlineAlert,
  LoadingBlock,
  ProgressNote,
  Screen,
  Select,
  Textarea,
  layout,
  text,
} from '../ui/index.js';
import { Requirement } from './RfpAnalysis.js';

export function ProposalGuide() {
  const params = useRouteParams('guide');
  const navigate = useWorkspaceStore((state) => state.navigate);
  const refreshJobs = useWorkspaceStore((state) => state.refreshJobs);
  const stopJob = useWorkspaceStore((state) => state.stopJob);
  const canManage = useCan('funding.manage');
  const consent = useConsentGate();
  const guides = useAsync(() => unwrap(fundingBridge().guides.list()), []);
  const rfps = useAsync(() => unwrap(fundingBridge().rfps.list()), []);
  const id =
    params.guideId ??
    (params.rfpId
      ? guides.value?.find((guide) => guide.rfpId === params.rfpId)?.id
      : guides.value?.[0]?.id) ??
    '';
  const guide = useAsync(
    () => (id ? unwrap(fundingBridge().guides.get(id)) : Promise.resolve(null)),
    [id],
  );
  const [rfpId, setRfpId] = useState(params.rfpId ?? '');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(false);
  const job = useJob('guide', rfpId);
  const feedbackJob = useJob('guide_feedback', id);
  useEffect(() => {
    setDrafts({});
  }, [id]);
  useFundingEvent(
    ['guides_changed', 'job', 'profile_changed', 'documents_changed', 'rfps_changed'],
    () => {
      guides.reload();
      guide.reload();
    },
  );
  const act = async (call: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await consent.run(call);
      guides.reload();
      guide.reload();
      void refreshJobs();
    } catch (failure) {
      const failed = toCallError(failure);
      if (failed.code !== 'CANCELLED') setError(failed.message);
    } finally {
      setBusy(false);
    }
  };
  const current = guide.value;
  return (
    <Screen
      title="Ethical Strengths-Based Proposal Guide"
      description="Work through a proposal in your own words. Reflective questions, evidence checklists and feedback help you develop your own writing."
    >
      <div className={layout.stack}>
        <Card>
          <h2 className={text.h2}>Start a guide</h2>
          <Field label="Funding document for this guide">
            <Select value={rfpId} onChange={(event) => setRfpId(event.target.value)}>
              <option value="">General guide — no RFP</option>
              {rfps.value?.map((rfp) => (
                <option key={rfp.id} value={rfp.id}>
                  {rfp.name}
                </option>
              ))}
            </Select>
          </Field>
          <p className={text.small}>
            For a tailored guide, analyze the funding document first. The guide honors the funder’s
            AI restrictions and uses your organization’s approved profile.
          </p>
          {canManage && (
            <Button
              variant="primary"
              busy={busy || job?.state === 'running'}
              onClick={() => void act(() => unwrap(fundingBridge().guides.start(rfpId)))}
            >
              Start ethical guide
            </Button>
          )}
        </Card>
        {error && <InlineAlert tone="error">{error}</InlineAlert>}
        {job?.state === 'running' && (
          <ProgressNote
            message={job.message}
            percent={job.percent}
            onStop={() => void stopJob(job.id)}
          />
        )}
        {job?.state === 'failed' && (
          <InlineAlert tone="error">{job.error?.message ?? job.message}</InlineAlert>
        )}
        {guides.state === 'loading' && <LoadingBlock label="Loading proposal guides" />}
        {guides.error && (
          <InlineAlert tone="error" action={<Button onClick={guides.reload}>Try again</Button>}>
            {guides.error.message}
          </InlineAlert>
        )}
        {guides.value && guides.value.length > 0 && (
          <Field label="Saved proposal guide">
            <Select
              value={id}
              onChange={(event) => navigate('guide', { guideId: event.target.value })}
            >
              {guides.value.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.title}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {guide.error && (
          <InlineAlert tone="error" action={<Button onClick={guide.reload}>Try again</Button>}>
            {guide.error.message}
          </InlineAlert>
        )}
        {!current && guides.value?.length === 0 && (
          <EmptyState
            icon="pencil"
            title="No guides yet"
            body="Start a general guide or choose an analyzed RFP for questions tied to the funder’s criteria."
          />
        )}
        {current?.stale && (
          <InlineAlert tone="caution">
            Your approved profile, source evidence or funding analysis changed. Start a new guide to
            use current evidence. The previous guide is retained in your saved list.
          </InlineAlert>
        )}
        {current && !current.stale && (
          <>
            <Card>
              <h2 className={text.h2}>{current.title}</h2>
              <Badge>
                {current.mode === 'limited'
                  ? 'Reflective checklist only — AI use restricted'
                  : 'Questions, outline and feedback'}
              </Badge>
              <p className={text.caption}>
                Updated {formatDateTime(current.updatedAt)} ·{' '}
                {current.method === 'standard'
                  ? 'Standard reflective guide'
                  : 'Assistant guidance grounded in evidence'}
              </p>
              <ul className={text.body}>
                {current.principles.map((principle, index) => (
                  <li key={index}>{principle}</li>
                ))}
              </ul>
              {canManage && (
                <Button variant="quiet" onClick={() => setRemoving(true)}>
                  Delete proposal guide
                </Button>
              )}
            </Card>
            <Card>
              <h2 className={text.h2}>Funder rules on AI tools</h2>
              <p className={text.body}>{current.aiUse.summary}</p>
              <CitationList citations={current.aiUse.citations} />
            </Card>
            {current.mode === 'limited' && (
              <InlineAlert tone="caution">
                This funder restricts AI assistance. Use these questions to reflect independently.
                Draft feedback is disabled. Follow the official policy before using any guidance in
                your application.
              </InlineAlert>
            )}
            {feedbackJob?.state === 'running' && (
              <ProgressNote
                message={feedbackJob.message}
                percent={feedbackJob.percent}
                onStop={() => void stopJob(feedbackJob.id)}
              />
            )}
            {feedbackJob?.state === 'failed' && (
              <InlineAlert tone="error">
                {feedbackJob.error?.message ?? feedbackJob.message}
              </InlineAlert>
            )}
            {current.outline.map((section) => (
              <Card key={section.id}>
                <h2 className={text.h2}>{section.heading}</h2>
                <p className={text.body}>{section.purpose}</p>
                {section.criteria.length > 0 && (
                  <>
                    <h3 className={text.h3}>Criteria to address</h3>
                    {section.criteria.map((criterion) => (
                      <Requirement key={criterion.id} item={criterion} />
                    ))}
                  </>
                )}
                {section.strengths.length > 0 && (
                  <>
                    <h3 className={text.h3}>Documented strengths</h3>
                    {section.strengths.map((strength, index) => (
                      <div key={index}>
                        <p className={text.body}>{strength.text}</p>
                        <CitationList citations={strength.citations} />
                      </div>
                    ))}
                  </>
                )}
                <h3 className={text.h3}>Questions for your own writing</h3>
                {section.questions.map((question) => (
                  <div key={question.id}>
                    <p className={text.body}>{question.text}</p>
                    <p className={text.small}>{question.why}</p>
                  </div>
                ))}
                {section.evidenceToGather.length > 0 && (
                  <>
                    <h3 className={text.h3}>Evidence checklist</h3>
                    <ul className={text.body}>
                      {section.evidenceToGather.map((evidence, index) => (
                        <li key={index}>{evidence}</li>
                      ))}
                    </ul>
                  </>
                )}
                {current.mode === 'full' && canManage && (
                  <>
                    <Field
                      label={`Your own draft for ${section.heading}`}
                      hint="Your text stays in this screen until you request feedback. Excerpts are sent to the assistant after consent. Feedback comments on your writing; it does not rewrite it."
                    >
                      <Textarea
                        maxLength={20000}
                        value={drafts[section.id] ?? ''}
                        onChange={(event) =>
                          setDrafts((previous) => ({
                            ...previous,
                            [section.id]: event.target.value,
                          }))
                        }
                      />
                    </Field>
                    <Button
                      disabled={
                        !drafts[section.id]?.trim() || busy || feedbackJob?.state === 'running'
                      }
                      onClick={() =>
                        void act(() =>
                          unwrap(
                            fundingBridge().guides.requestFeedback(
                              id,
                              section.id,
                              drafts[section.id] ?? '',
                            ),
                          ),
                        )
                      }
                    >
                      Request feedback on {section.heading}
                    </Button>
                  </>
                )}
                {current.feedback
                  .filter((feedback) => feedback.sectionId === section.id)
                  .map((feedback) => (
                    <div key={feedback.id} className={layout.stack}>
                      <h3 className={text.h3}>Feedback · {formatDateTime(feedback.createdAt)}</h3>
                      {feedback.observations.map((observation) => (
                        <div key={observation.id}>
                          <Badge>{observation.kind.replaceAll('_', ' ')}</Badge>
                          <p className={text.body}>{observation.text}</p>
                          <blockquote className={text.small}>{observation.draftExcerpt}</blockquote>
                          <CitationList citations={observation.citations} />
                        </div>
                      ))}
                    </div>
                  ))}
              </Card>
            ))}
          </>
        )}
      </div>
      <Dialog
        open={removing}
        onClose={() => setRemoving(false)}
        title="Delete proposal guide"
        description="This removes this guide and its saved feedback."
        primaryAction={{
          label: 'Delete proposal guide',
          variant: 'danger',
          busy,
          onClick: () =>
            void act(async () => {
              await unwrap(fundingBridge().guides.remove(id));
              setRemoving(false);
              navigate('guide', {});
            }),
        }}
        secondaryAction={{ label: 'Keep proposal guide' }}
      />
      {consent.dialog}
    </Screen>
  );
}
