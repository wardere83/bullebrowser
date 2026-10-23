import { useEffect, useState } from 'react';
import {
  ALIGNMENT_FINDING_LABELS,
  RFP_SECTION_LABELS,
  type AnalysisNote,
  type RfpAnalysis as Analysis,
  type AlignmentReport,
  type RfpItem,
} from '../../../shared/funding.js';
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
  type RfpView,
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
  Screen,
  Input,
  Select,
  StatusBadge,
  Tabs,
  TabPanel,
  ProgressNote,
  layout,
  text,
} from '../ui/index.js';

function Notes({ title, notes }: { title: string; notes: AnalysisNote[] }) {
  if (!notes.length) return null;
  return (
    <Card>
      <h2 className={text.h2}>{title}</h2>
      {notes.map((note) => (
        <div key={note.id} className={layout.stack}>
          <p className={text.body}>{note.text}</p>
          <CitationList citations={note.citations} />
        </div>
      ))}
    </Card>
  );
}
export function Requirement({ item }: { item: RfpItem }) {
  return (
    <div className={layout.stack}>
      <Badge>{item.basis === 'explicit' ? 'Funder statement' : 'Interpretation'}</Badge>
      <p className={text.body}>{item.text}</p>
      {item.needsReview && (
        <InlineAlert tone="caution">
          Check this point against its source before relying on its figures or dates.
        </InlineAlert>
      )}
      <CitationList citations={item.citations} />
    </div>
  );
}
function AnalysisResult({ analysis, view }: { analysis: Analysis; view: RfpView }) {
  const prioritySections = new Set([
    'purpose',
    'priorities',
    'outcomes',
    'eligibility',
    'evaluation_criteria',
    'supported_activities',
  ]);
  return (
    <div className={layout.stack}>
      <Card>
        <h2 className={text.h2}>
          {view === 'priorities' ? 'Explore Funder Priorities' : 'Reading the funding document'}
        </h2>
        <p className={text.body}>{analysis.overview}</p>
        <p className={text.caption}>
          Read {formatDateTime(analysis.createdAt)} ·{' '}
          {analysis.method === 'assistant'
            ? 'Assistant analysis with verified citations'
            : 'Literal text matches — no interpretation'}
        </p>
      </Card>
      {analysis.limitations.map((limitation, index) => (
        <InlineAlert tone="caution" key={index}>
          {limitation}
        </InlineAlert>
      ))}
      {view === 'priorities' && (
        <InlineAlert tone="info">
          These are the funder’s documented priorities. Keep your organization’s mission and
          approved priorities intact. This document does not establish the funder’s historical
          awards.
        </InlineAlert>
      )}
      {analysis.sections
        .filter((section) => view !== 'priorities' || prioritySections.has(section.id))
        .map((section) => (
          <Card key={section.id}>
            <h2 className={text.h2}>{RFP_SECTION_LABELS[section.id]}</h2>
            <Badge>
              {section.coverage === 'missing'
                ? 'Not stated'
                : section.coverage === 'unclear'
                  ? 'Unclear — check with funder'
                  : 'Documented'}
            </Badge>
            {section.note && <p className={text.body}>{section.note}</p>}
            {section.items.map((item) => (
              <Requirement item={item} key={item.id} />
            ))}
          </Card>
        ))}
      <Card>
        <h2 className={text.h2}>Use of AI tools</h2>
        <p className={text.body}>{analysis.aiUse.summary}</p>
        <CitationList citations={analysis.aiUse.citations} />
      </Card>
      {analysis.literalFindings.length > 0 && (
        <Card>
          <h2 className={text.h2}>Dates, amounts and requirement passages</h2>
          <p className={text.small}>
            These are exact text matches. Read the surrounding document to determine which apply.
          </p>
          {analysis.literalFindings.map((finding, index) => (
            <div key={index}>
              <p className={text.body}>{finding.text}</p>
              <CitationList citations={[finding.citation]} />
            </div>
          ))}
        </Card>
      )}
      {analysis.glossary.length > 0 && (
        <Card>
          <h2 className={text.h2}>Funding terms explained</h2>
          {analysis.glossary.map((term, index) => (
            <div key={index}>
              <h3 className={text.h3}>{term.term}</h3>
              <p className={text.body}>{term.plainLanguage}</p>
              <CitationList citations={term.citations} />
            </div>
          ))}
        </Card>
      )}
      <Notes title="Uncertainties and possible conflicts" notes={analysis.uncertainties} />
      <Notes title="Questions before applying" notes={analysis.questions} />
      <InlineAlert tone="info">
        Check the official notice for amendments, linked attachments and the latest deadlines. An
        uploaded document cannot verify that a later amendment exists.
      </InlineAlert>
    </div>
  );
}
function AlignmentResult({ report }: { report: AlignmentReport }) {
  if (report.stale)
    return (
      <InlineAlert tone="caution">
        Your profile or supporting documents changed. Assess funding alignment again to use current
        approved evidence.
      </InlineAlert>
    );
  return (
    <div className={layout.stack}>
      <Card>
        <h2 className={text.h2}>Assess Your Funding Alignment</h2>
        <p className={text.body}>{report.summary}</p>
        <p className={text.caption}>
          {report.profileApprovedAt
            ? `Profile approved ${formatDateTime(report.profileApprovedAt)}`
            : 'No approved profile at the time of this comparison'}{' '}
          ·{' '}
          {report.method === 'assistant'
            ? 'Evidence-based comparison'
            : 'Relevant passages — no judgement'}
        </p>
      </Card>
      {report.items.map((item) => (
        <Card key={item.id}>
          <h3 className={text.h3}>{item.topic}</h3>
          <Badge>{ALIGNMENT_FINDING_LABELS[item.finding]}</Badge>
          <h4 className={text.overline}>Funder requirement</h4>
          <Requirement item={item.requirement} />
          <h4 className={text.overline}>Organization evidence</h4>
          {item.facts.length === 0 && (
            <p className={text.body}>
              No documented evidence was found. This is not proof that your organization lacks this
              capability.
            </p>
          )}
          {item.facts.map((fact, index) => (
            <div key={index}>
              <p className={text.body}>{fact.text}</p>
              <CitationList citations={fact.citations} />
            </div>
          ))}
          {item.recommendation && (
            <InlineAlert tone="info" title="Recommendation">
              {item.recommendation}
            </InlineAlert>
          )}
        </Card>
      ))}
      <Notes title="Gaps and possible barriers" notes={report.gaps} />
      <Notes title="Uncertainties" notes={report.uncertainties} />
      <Notes title="Questions to resolve" notes={report.questions} />
    </div>
  );
}
export function RfpAnalysis() {
  const params = useRouteParams('rfp');
  const navigate = useWorkspaceStore((state) => state.navigate);
  const refreshJobs = useWorkspaceStore((state) => state.refreshJobs);
  const stopJob = useWorkspaceStore((state) => state.stopJob);
  const canManage = useCan('funding.manage');
  const consent = useConsentGate();
  const documents = useAsync(() => unwrap(fundingBridge().rfps.list()), []);
  const saved = useAsync(() => unwrap(fundingBridge().opportunities.listSaved()), []);
  const id = params.rfpId ?? documents.value?.[0]?.id ?? '';
  const view: RfpView = params.view ?? 'analysis';
  const document = documents.value?.find((entry) => entry.id === id);
  useEffect(() => {
    if (!params.rfpId && id) navigate('rfp', { rfpId: id, view });
  }, [params.rfpId, id, view, navigate]);
  const analysis = useAsync(
    () => (id ? unwrap(fundingBridge().rfps.analysis(id)) : Promise.resolve(null)),
    [id],
  );
  const alignment = useAsync(
    () => (id ? unwrap(fundingBridge().rfps.alignment(id)) : Promise.resolve(null)),
    [id],
  );
  const analysisJob = useJob('rfp_analysis', id);
  const alignmentJob = useJob('alignment', id);
  const job = view === 'alignment' ? alignmentJob : analysisJob;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(false);
  const [savedId, setSavedId] = useState('');
  const [officialUrl, setOfficialUrl] = useState('');
  useFundingEvent(['rfps_changed', 'job', 'profile_changed', 'documents_changed'], () => {
    documents.reload();
    analysis.reload();
    alignment.reload();
  });
  const act = async (call: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await consent.run(() => consent.run(call));
      documents.reload();
      analysis.reload();
      alignment.reload();
      void refreshJobs();
    } catch (failure) {
      const failed = toCallError(failure);
      if (failed.code !== 'CANCELLED') setError(failed.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen
      title="RFP Analysis"
      description="Understand what the funder asks for, compare it with your organization’s evidence, and keep funding documents separate from your Knowledge Hub."
    >
      <div className={layout.stack}>
        <Card>
          <h2 className={text.h2}>Funding documents</h2>
          <p className={text.body}>
            Upload a PDF, DOCX, TXT or Markdown notice, including any amendments you need to read.
            You can also add an official listing saved in Opportunities.
          </p>
          {canManage && (
            <Button
              variant="primary"
              busy={busy}
              onClick={() =>
                void act(async () => {
                  const added = await unwrap(fundingBridge().rfps.add());
                  if (added[0]) navigate('rfp', { rfpId: added[0].id, view });
                })
              }
            >
              Upload funding documents
            </Button>
          )}
          {saved.value && saved.value.length > 0 && (
            <div className={layout.stack}>
              <Field label="Saved official listing">
                <Select value={savedId} onChange={(event) => setSavedId(event.target.value)}>
                  <option value="">Choose a listing</option>
                  {saved.value.map((entry) => (
                    <option key={entry.opportunity.id} value={entry.opportunity.id}>
                      {entry.opportunity.title}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                disabled={!savedId || !canManage || busy}
                onClick={() =>
                  void act(async () => {
                    const added = await unwrap(fundingBridge().rfps.addFromOpportunity(savedId));
                    navigate('rfp', { rfpId: added.id, view });
                  })
                }
              >
                Read saved listing
              </Button>
            </div>
          )}
          <Field
            label="Official funding link"
            hint="Grants.gov, California Grants Portal, NYC City Record or an EU topic notice. For other funders, upload the official notice."
          >
            <Input
              type="url"
              maxLength={2000}
              value={officialUrl}
              onChange={(event) => setOfficialUrl(event.target.value)}
            />
          </Field>
          <Button
            disabled={!officialUrl.trim() || !canManage || busy}
            onClick={() =>
              void act(async () => {
                const added = await unwrap(fundingBridge().rfps.addFromUrl(officialUrl));
                navigate('rfp', { rfpId: added.id, view });
              })
            }
          >
            Read official link
          </Button>
          <Button variant="quiet" onClick={() => navigate('opportunities', { view: 'search' })}>
            Find an official opportunity
          </Button>
        </Card>
        {error && <InlineAlert tone="error">{error}</InlineAlert>}
        {documents.state === 'loading' && <LoadingBlock label="Loading funding documents" />}
        {documents.error && (
          <InlineAlert tone="error" action={<Button onClick={documents.reload}>Try again</Button>}>
            {documents.error.message}
          </InlineAlert>
        )}
        {documents.value?.length === 0 && (
          <EmptyState
            icon="document"
            title="No funding documents yet"
            body="Add an official funding notice to begin."
          />
        )}
        {documents.value && documents.value.length > 0 && (
          <Field label="Funding document">
            <Select
              value={id}
              onChange={(event) => navigate('rfp', { rfpId: event.target.value, view })}
            >
              {documents.value.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {document && (
          <>
            <Card>
              <h2 className={text.h2}>{document.name}</h2>
              <StatusBadge kind="document" status={document.status} />
              {document.statusDetail && (
                <InlineAlert tone="caution">{document.statusDetail}</InlineAlert>
              )}
              {document.warnings.map((warning, index) => (
                <InlineAlert key={index} tone="caution">
                  {warning}
                </InlineAlert>
              ))}
              {canManage && (
                <Button variant="quiet" onClick={() => setRemoving(true)}>
                  Delete funding document
                </Button>
              )}
            </Card>
            <Tabs
              id="rfp-views"
              label="Funding document views"
              tabs={[
                { id: 'analysis', label: 'Analysis' },
                { id: 'alignment', label: 'Our alignment' },
                { id: 'priorities', label: 'Funder priorities' },
              ]}
              value={view}
              onChange={(next) => navigate('rfp', { rfpId: id, view: next })}
            />
            <TabPanel tabsId="rfp-views" tab={view} className={layout.stack}>
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
              {canManage && (
                <Button
                  variant="primary"
                  busy={busy || job?.state === 'running'}
                  disabled={document.status !== 'ready'}
                  onClick={() =>
                    void act(() =>
                      view === 'alignment'
                        ? unwrap(fundingBridge().rfps.assessAlignment(id))
                        : unwrap(fundingBridge().rfps.analyze(id)),
                    )
                  }
                >
                  {view === 'alignment' ? 'Assess funding alignment' : 'Analyze funding document'}
                </Button>
              )}
              {(view === 'alignment' ? alignment.error : analysis.error) && (
                <InlineAlert tone="error">
                  {(view === 'alignment' ? alignment.error : analysis.error)?.message}
                </InlineAlert>
              )}
              {view === 'alignment' ? (
                alignment.value ? (
                  <AlignmentResult report={alignment.value} />
                ) : (
                  <EmptyState
                    title="No alignment comparison yet"
                    body="Analyze this document, then compare its requirements with your approved profile and organization documents."
                  />
                )
              ) : analysis.value ? (
                <AnalysisResult analysis={analysis.value} view={view} />
              ) : (
                <EmptyState
                  title="No analysis yet"
                  body="Start an analysis when the document is ready. A connected assistant explains requirements; without one, you can read exact dates, amounts and requirement passages."
                />
              )}
              <Button onClick={() => navigate('guide', { rfpId: id })}>
                Open ethical proposal guide
              </Button>
            </TabPanel>
          </>
        )}
      </div>
      <Dialog
        open={removing}
        onClose={() => setRemoving(false)}
        title="Delete funding document"
        description="This removes its analysis, alignment and related proposal guides."
        primaryAction={{
          label: 'Delete funding document',
          variant: 'danger',
          busy,
          onClick: () =>
            void act(async () => {
              await unwrap(fundingBridge().rfps.remove(id));
              setRemoving(false);
              navigate('rfp', { view });
            }),
        }}
        secondaryAction={{ label: 'Keep funding document' }}
      />
      {consent.dialog}
    </Screen>
  );
}
