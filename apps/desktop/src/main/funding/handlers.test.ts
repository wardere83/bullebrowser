import type { BrowserWindow } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  FundingEvent,
  GuideSession,
  Opportunity,
  OrgActivity,
  Organization,
  RfpAnalysis,
  SessionInfo,
} from '../../shared/funding.js';

vi.mock('electron', () => ({ app: { getPath: () => '/nonexistent' }, dialog: {}, ipcMain: {} }));

const { createFundingHandlers } = await import('./handlers.js');
const { FundingError } = await import('./errors.js');
const { JobManager } = await import('./jobs.js');
type HandlerParts = Parameters<typeof createFundingHandlers>[0];

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const USER = '99999999-9999-4999-8999-999999999999';
const RFP = '33333333-3333-4333-8333-333333333333';
const GUIDE = '44444444-4444-4444-8444-444444444444';
const CLAIM = '55555555-5555-4555-8555-555555555555';

function organization(id: string, consents: Partial<Organization['consents']> = {}): Organization {
  return {
    schemaVersion: 1,
    id,
    name: id === ORG_A ? 'Harbor Lantern Collective' : 'Copperline Fabrication Works',
    kind: id === ORG_A ? 'cbo' : 'business',
    location: { country: 'US', region: 'NJ', county: 'Essex', city: 'Newark' },
    consents: { documentAnalysisAt: null, liveFundingSearchAt: null, ...consents },
    createdAt: 1,
    updatedAt: 1,
  };
}

const session: SessionInfo = {
  id: 's',
  userId: USER,
  organizationId: ORG_A,
  authMode: 'local',
  issuedAt: 1,
  expiresAt: null,
  role: 'owner',
  permissions: [],
};

const context = (active: Organization | null) => ({
  window: {} as BrowserWindow,
  session,
  organization: active,
});

const listing = (overrides: Partial<Opportunity> = {}): Opportunity => ({
  id: 'grants-gov:1',
  sourceId: 'grants-gov',
  sourceName: 'Grants.gov',
  funder: 'A federal agency',
  kind: 'grant',
  level: 'federal',
  country: 'US',
  region: '',
  jurisdiction: 'United States',
  geographyNote: '',
  title: 'Workforce pathways',
  summary: 'Training grants.',
  number: 'ABC-1',
  applicantTypes: ['nonprofit'],
  applicantNote: '',
  categories: ['employment_workforce'],
  awardFloor: null,
  awardCeiling: null,
  totalFunding: null,
  currency: 'USD',
  openDate: null,
  closeDate: '2027-04-16',
  closeDateText: 'April 16, 2027',
  status: 'active',
  statusReason: 'Open at the source.',
  unverifiedReason: null,
  sourceStatus: 'posted',
  officialUrl: 'https://www.grants.gov/search-results-detail/1',
  fetchedAt: 1_000,
  match: null,
  ...overrides,
});

const analysis: RfpAnalysis = {
  schemaVersion: 1,
  rfpId: RFP,
  organizationId: ORG_A,
  method: 'text_matches',
  createdAt: 5,
  overview: '',
  sections: [],
  glossary: [],
  aiUse: { stance: 'not_stated', summary: '', citations: [] },
  uncertainties: [],
  questions: [],
  literalFindings: [],
  limitations: [],
};

const guide: GuideSession = {
  schemaVersion: 1,
  id: GUIDE,
  organizationId: ORG_A,
  rfpId: '',
  title: 'General guide',
  mode: 'full',
  aiUse: { stance: 'not_stated', summary: '', citations: [] },
  method: 'standard',
  principles: [],
  outline: [{ id: 'context', heading: 'Context', purpose: '', criteria: [], strengths: [], questions: [], evidenceToGather: [] }],
  feedback: [],
  createdAt: 1,
  updatedAt: 1,
};

function setup(options: { connected?: boolean } = {}) {
  const events: FundingEvent[] = [];
  const recorded: { organizationId: string; action: string; detail: string }[] = [];
  const jobs = new JobManager((event) => events.push(event));
  const complete = vi.fn();
  const knowledge = {
    listDocuments: vi.fn(async (_organizationId: string) => [] as { id: string; name: string }[]),
    addDocuments: vi.fn(),
    replaceDocument: vi.fn(),
    setCategory: vi.fn(),
    retryDocument: vi.fn(),
    deleteDocument: vi.fn(),
    search: vi.fn(async () => []),
    suggestPassages: vi.fn(async () => []),
    sourceDocuments: vi.fn(async () => [{ id: 'd', name: 'plan.pdf', version: 1, label: 'Strategic plan', blocks: [] }]),
    getProfile: vi.fn(async () => ({ claims: [] })),
    setupStatus: vi.fn(),
    beginExtraction: vi.fn(async () => {}),
    applyExtraction: vi.fn(async () => ({})),
    endExtraction: vi.fn(async () => {}),
    approveClaims: vi.fn(async () => ({})),
    rejectClaims: vi.fn(),
    addClaim: vi.fn(),
    updateClaim: vi.fn(),
    deleteClaim: vi.fn(),
    resolveConflict: vi.fn(),
    baseline: vi.fn(async (active: Organization) => ({
      organizationId: active.id,
      organization: { name: active.name, kind: active.kind, location: active.location },
      claims: [{ id: CLAIM }],
      approvedAt: 9,
    })),
    profileTerms: vi.fn(async () => [{ term: 'workforce', field: 'programs' }]),
    suggestFilters: vi.fn(),
    whenIdle: vi.fn(async () => {}),
    forget: vi.fn(),
  };
  const rfps = {
    list: vi.fn(async () => []),
    get: vi.fn(async () => ({ id: RFP, name: 'nofa.pdf' })),
    addFiles: vi.fn(),
    addListing: vi.fn(async () => ({ id: RFP, name: 'Workforce pathways (official listing)' })),
    remove: vi.fn(async () => {}),
    source: vi.fn(async () => ({ id: RFP, name: 'nofa.pdf', version: 1, label: 'Funding document', blocks: [] })),
    analysis: vi.fn(async (): Promise<RfpAnalysis | null> => null),
    saveAnalysis: vi.fn(async () => {}),
    setAnalysisStatus: vi.fn(async () => {}),
    alignment: vi.fn(async () => null),
    saveAlignment: vi.fn(async () => {}),
    setAlignmentStatus: vi.fn(async () => {}),
    whenIdle: vi.fn(async () => {}),
  };
  const guides = {
    list: vi.fn(async () => []),
    get: vi.fn(async (): Promise<GuideSession | null> => guide),
    save: vi.fn(async (_organizationId: string, _guide: GuideSession) => {}),
    remove: vi.fn(async () => {}),
    removeForRfp: vi.fn(async () => {}),
  };
  const opportunities = {
    sources: vi.fn(() => []),
    search: vi.fn(async (input: { signal: AbortSignal }) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (input.signal.aborted) throw new FundingError('CANCELLED', 'Cancelled.');
      return { opportunities: [], reports: [], truncated: false, searchedAt: 1 };
    }),
    detail: vi.fn(async () => ({ opportunity: listing(), description: '', facts: [], links: [] })),
    recheck: vi.fn(async (given: Opportunity) => ({ ...given, title: 'Title as the source has it', fetchedAt: 2_000 })),
  };
  const saved = {
    list: vi.fn(async () => []),
    get: vi.fn(async () => null),
    save: vi.fn(async () => []),
    unsave: vi.fn(async () => []),
    setNote: vi.fn(async () => []),
    replace: vi.fn(async () => {}),
  };
  const pipelines = {
    extractProfile: vi.fn(async (_input: { signal: AbortSignal }): Promise<unknown> => ({
      method: 'verbatim',
      claims: [],
      conflicts: [],
      gaps: [],
      dropped: 0,
    })),
    analyzeRfp: vi.fn(async () => analysis),
    assessAlignment: vi.fn(async () => ({ rfpId: RFP })),
    buildGuide: vi.fn(async (input: { id: string }) => ({ ...guide, id: input.id })),
    reviewDraft: vi.fn(async (input: { id: string; sectionId: string }) => ({
      id: input.id,
      sectionId: input.sectionId,
      createdAt: 7,
      observations: [],
    })),
  };
  const identity = {
    getState: vi.fn(),
    deleteOrganization: vi.fn(async () => ({})),
    recordConsent: vi.fn(async () => ({})),
    can: vi.fn(async () => true),
  };
  const chooseFiles = vi.fn(async () => [] as string[]);
  const forgetOrganization = vi.fn(async () => {});

  const handlers = createFundingHandlers({
    identity,
    assistant: {
      connected: () => options.connected ?? false,
      availability: () => ({ connected: options.connected ?? false, note: '' }),
      complete,
    },
    jobs,
    knowledge,
    rfps,
    guides,
    opportunities,
    saved,
    pipelines,
    chooseFiles,
    activity: {
      record: async (organizationId: string, _actor: string, action: OrgActivity['action'], detail: string) => {
        recorded.push({ organizationId, action, detail });
      },
      list: async () => [],
    },
    emit: (event: FundingEvent) => events.push(event),
    forgetOrganization,
    now: () => 100,
  } as unknown as HandlerParts);

  /** Waits for the job a call started and returns its final state. */
  const finished = async (jobId: string) => {
    await vi.waitFor(() => {
      const job = jobs.list(ORG_A).find((item) => item.id === jobId);
      expect(job?.state).not.toBe('running');
    });
    return jobs.list(ORG_A).find((item) => item.id === jobId);
  };

  return {
    handlers,
    events,
    recorded,
    jobs,
    complete,
    knowledge,
    rfps,
    guides,
    opportunities,
    saved,
    pipelines,
    identity,
    chooseFiles,
    forgetOrganization,
    finished,
  };
}

const refusal = async (work: () => unknown) => {
  try {
    await work();
  } catch (error) {
    return error as InstanceType<typeof FundingError>;
  }
  throw new Error('expected a refusal');
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('asking before anything leaves the device', () => {
  it('refuses to read a profile with a connected assistant until excerpts may be sent', async () => {
    const { handlers, pipelines, complete } = setup({ connected: true });
    const error = await refusal(() => handlers.knowledge.extractProfile(context(organization(ORG_A))));
    expect(error.code).toBe('CONSENT_REQUIRED');
    expect(error.consent).toBe('documentAnalysisAt');
    expect(pipelines.extractProfile).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it('reads a profile on the device, without asking, when no assistant is connected', async () => {
    const { handlers, pipelines, knowledge, finished, recorded } = setup({ connected: false });
    const { jobId } = await handlers.knowledge.extractProfile(context(organization(ORG_A)));
    expect((await finished(jobId))?.state).toBe('completed');
    expect(pipelines.extractProfile).toHaveBeenCalledWith(expect.objectContaining({ complete: null }));
    expect(knowledge.applyExtraction).toHaveBeenCalledWith(ORG_A, expect.anything());
    expect(recorded).toContainEqual(expect.objectContaining({ organizationId: ORG_A, action: 'profile_extracted' }));
  });

  it('hands the assistant to the pipeline once the organization has agreed', async () => {
    const { handlers, pipelines, complete, finished } = setup({ connected: true });
    const agreed = organization(ORG_A, { documentAnalysisAt: 50 });
    const { jobId } = await handlers.knowledge.extractProfile(context(agreed));
    await finished(jobId);
    expect(pipelines.extractProfile).toHaveBeenCalledWith(expect.objectContaining({ complete }));
  });

  it('refuses to search official sources until that has been agreed to', async () => {
    const { handlers, opportunities } = setup();
    const error = await refusal(() => handlers.opportunities.search(context(organization(ORG_A)), {} as never));
    expect(error.code).toBe('CONSENT_REQUIRED');
    expect(error.consent).toBe('liveFundingSearchAt');
    expect(opportunities.search).not.toHaveBeenCalled();
  });

  it('refuses detail, saving, re-checking and reading a listing as a document the same way', async () => {
    const { handlers, opportunities } = setup();
    const active = context(organization(ORG_A));
    for (const work of [
      () => handlers.opportunities.detail(active, 'grants-gov:1'),
      () => handlers.opportunities.save(active, listing()),
      () => handlers.opportunities.recheckSaved(active),
      () => handlers.rfps.addFromOpportunity(active, 'grants-gov:1'),
    ]) {
      expect((await refusal(work)).code).toBe('CONSENT_REQUIRED');
    }
    expect(opportunities.detail).not.toHaveBeenCalled();
    expect(opportunities.recheck).not.toHaveBeenCalled();
  });
});

describe('profile reading', () => {
  it('records why a reading failed and leaves no proposals behind', async () => {
    const { handlers, pipelines, knowledge, finished } = setup();
    pipelines.extractProfile.mockRejectedValueOnce(new FundingError('ASSISTANT_ERROR', 'The assistant could not be reached.'));
    const { jobId } = await handlers.knowledge.extractProfile(context(organization(ORG_A)));
    const job = await finished(jobId);
    expect(job?.state).toBe('failed');
    expect(knowledge.endExtraction).toHaveBeenCalledWith(ORG_A, 'The assistant could not be reached.');
    expect(knowledge.applyExtraction).not.toHaveBeenCalled();
  });

  it('treats a stopped reading as stopped, not failed', async () => {
    const { handlers, pipelines, knowledge, jobs, finished } = setup();
    pipelines.extractProfile.mockImplementationOnce(
      (input: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          input.signal.addEventListener('abort', () => reject(new FundingError('CANCELLED', 'Cancelled.')));
        }),
    );
    const { jobId } = await handlers.knowledge.extractProfile(context(organization(ORG_A)));
    await vi.waitFor(() => expect(pipelines.extractProfile).toHaveBeenCalled());
    jobs.cancel(jobId, ORG_A);
    expect((await finished(jobId))?.state).toBe('cancelled');
    expect(knowledge.endExtraction).toHaveBeenCalledWith(ORG_A, '');
  });

  it('needs at least one document that has been read', async () => {
    const { handlers, knowledge } = setup();
    knowledge.sourceDocuments.mockResolvedValueOnce([]);
    expect((await refusal(() => handlers.knowledge.extractProfile(context(organization(ORG_A))))).code).toBe('INVALID_INPUT');
  });

  it('passes whether the person may approve, as main worked it out', async () => {
    const { handlers, knowledge, identity } = setup();
    identity.can.mockResolvedValueOnce(false);
    await handlers.knowledge.approveClaims(context(organization(ORG_A)), [CLAIM]);
    expect(identity.can).toHaveBeenCalledWith('profile.approve', ORG_A);
    expect(knowledge.approveClaims).toHaveBeenCalledWith(ORG_A, [CLAIM], { userId: USER, canApprove: false });
  });
});

describe('documents', () => {
  it('does nothing when the file dialog is dismissed', async () => {
    const { handlers, knowledge } = setup();
    expect(await handlers.knowledge.addDocuments(context(organization(ORG_A)))).toEqual([]);
    expect(knowledge.addDocuments).not.toHaveBeenCalled();
  });

  it('notes the files that were added even when others were refused', async () => {
    const { handlers, knowledge, chooseFiles, recorded } = setup();
    chooseFiles.mockResolvedValueOnce(['/a/plan.pdf', '/a/sheet.xlsx']);
    knowledge.listDocuments.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'd1', name: 'plan.pdf' }]);
    knowledge.addDocuments.mockRejectedValueOnce(new FundingError('UNSUPPORTED_FILE', '1 of 2 files was not added.'));
    const error = await refusal(() => handlers.knowledge.addDocuments(context(organization(ORG_A))));
    expect(error.code).toBe('UNSUPPORTED_FILE');
    expect(recorded).toContainEqual({ organizationId: ORG_A, action: 'document_added', detail: 'plan.pdf' });
  });

  it('refuses a category the app does not use', async () => {
    const { handlers } = setup();
    const error = await refusal(() => handlers.knowledge.addDocuments(context(organization(ORG_A)), 'secret' as never));
    expect(error.code).toBe('INVALID_INPUT');
  });
});

describe('listings', () => {
  const agreed = () => context(organization(ORG_A, { liveFundingSearchAt: 50 }));

  it("searches with the organization's place and its approved profile terms", async () => {
    const { handlers, opportunities } = setup();
    await handlers.opportunities.search(agreed(), { query: 'training' } as never);
    expect(opportunities.search).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: { query: 'training' },
        organization: { country: 'US', region: 'NJ', county: 'Essex', city: 'Newark' },
        profileTerms: [{ term: 'workforce', field: 'programs' }],
      }),
    );
  });

  it('lets a new search replace the one still running', async () => {
    const { handlers } = setup();
    const first = handlers.opportunities.search(agreed(), {} as never);
    const second = handlers.opportunities.search(agreed(), {} as never);
    expect((await refusal(() => first)).code).toBe('CANCELLED');
    await expect(second).resolves.toMatchObject({ opportunities: [] });
  });

  it("keeps the source's own copy of a saved listing, not what the interface sent", async () => {
    const { handlers, opportunities, saved, events, recorded } = setup();
    await handlers.opportunities.save(agreed(), listing({ title: 'Changed in the interface' }));
    expect(opportunities.recheck).toHaveBeenCalled();
    expect(saved.save).toHaveBeenCalledWith(ORG_A, expect.objectContaining({ title: 'Title as the source has it' }));
    expect(events).toContainEqual({ kind: 'saved_changed', organizationId: ORG_A });
    expect(recorded).toContainEqual(expect.objectContaining({ action: 'opportunity_saved' }));
  });

  it('refuses a listing the app could not have produced', async () => {
    const { handlers, saved } = setup();
    for (const bad of [
      { ...listing(), officialUrl: 'javascript:alert(1)' },
      { ...listing(), id: 'other-source:1' },
      { ...listing(), status: 'open' },
      { ...listing(), extra: true },
      'grants-gov:1',
    ]) {
      expect((await refusal(() => handlers.opportunities.save(agreed(), bad as never))).code).toBe('INVALID_INPUT');
    }
    expect(saved.save).not.toHaveBeenCalled();
  });
});

describe('funding documents', () => {
  it('analyses with text matches when no assistant is connected, and stores the result', async () => {
    const { handlers, pipelines, rfps, finished, recorded } = setup();
    const { jobId } = await handlers.rfps.analyze(context(organization(ORG_A)), RFP);
    expect((await finished(jobId))?.state).toBe('completed');
    expect(pipelines.analyzeRfp).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ORG_A, complete: null }));
    expect(rfps.saveAnalysis).toHaveBeenCalledWith(ORG_A, analysis);
    expect(recorded).toContainEqual(expect.objectContaining({ action: 'rfp_analyzed' }));
  });

  it('says why an analysis failed', async () => {
    const { handlers, pipelines, rfps, finished } = setup();
    pipelines.analyzeRfp.mockRejectedValueOnce(new FundingError('ASSISTANT_ERROR', 'Try again.'));
    const { jobId } = await handlers.rfps.analyze(context(organization(ORG_A)), RFP);
    await finished(jobId);
    expect(rfps.setAnalysisStatus).toHaveBeenLastCalledWith(ORG_A, RFP, { state: 'failed', updatedAt: 100, error: 'Try again.' });
  });

  it('will not assess alignment before a profile is approved', async () => {
    const { handlers, knowledge, pipelines } = setup();
    knowledge.baseline.mockResolvedValueOnce({ organizationId: ORG_A, organization: {} as never, claims: [], approvedAt: 0 });
    const error = await refusal(() => handlers.rfps.assessAlignment(context(organization(ORG_A)), RFP));
    expect(error.code).toBe('INVALID_INPUT');
    expect(error.message).toContain('Approve at least one statement');
    expect(pipelines.assessAlignment).not.toHaveBeenCalled();
  });

  it('analyses the document first when alignment is asked for without an analysis', async () => {
    const { handlers, pipelines, rfps, finished } = setup();
    const { jobId } = await handlers.rfps.assessAlignment(context(organization(ORG_A)), RFP);
    expect((await finished(jobId))?.state).toBe('completed');
    expect(pipelines.analyzeRfp).toHaveBeenCalledTimes(1);
    expect(pipelines.assessAlignment).toHaveBeenCalledWith(expect.objectContaining({ analysis, organizationId: ORG_A }));
    expect(rfps.saveAlignment).toHaveBeenCalled();
  });

  it('removes a document together with its running work and its guides', async () => {
    const { handlers, rfps, guides, jobs, events } = setup();
    const cancelSubject = vi.spyOn(jobs, 'cancelSubject');
    await handlers.rfps.remove(context(organization(ORG_A)), RFP);
    expect(cancelSubject).toHaveBeenCalledWith(ORG_A, RFP);
    expect(guides.removeForRfp).toHaveBeenCalledWith(ORG_A, RFP);
    expect(rfps.remove).toHaveBeenCalledWith(ORG_A, RFP);
    expect(events).toContainEqual({ kind: 'guides_changed', organizationId: ORG_A });
  });
});

describe('proposal guide', () => {
  it('builds a general guide without a funding document', async () => {
    const { handlers, pipelines, guides, finished } = setup();
    const { jobId } = await handlers.guides.start(context(organization(ORG_A)), '');
    expect((await finished(jobId))?.state).toBe('completed');
    expect(pipelines.buildGuide).toHaveBeenCalledWith(expect.objectContaining({ rfp: null, analysis: null, complete: null }));
    expect(guides.save).toHaveBeenCalledWith(ORG_A, expect.objectContaining({ organizationId: ORG_A }));
  });

  it('offers feedback only with a connected assistant', async () => {
    const { handlers } = setup({ connected: false });
    const error = await refusal(() => handlers.guides.requestFeedback(context(organization(ORG_A)), GUIDE, 'context', 'My draft.'));
    expect(error.code).toBe('NO_ASSISTANT');
  });

  it('refuses a blank draft and one that is too long', async () => {
    const { handlers } = setup({ connected: true });
    const agreed = context(organization(ORG_A, { documentAnalysisAt: 50 }));
    expect((await refusal(() => handlers.guides.requestFeedback(agreed, GUIDE, 'context', '   '))).code).toBe('INVALID_INPUT');
    expect((await refusal(() => handlers.guides.requestFeedback(agreed, GUIDE, 'context', 'x'.repeat(20_001)))).code).toBe(
      'INVALID_INPUT',
    );
  });

  it('keeps the feedback and never the draft', async () => {
    const { handlers, guides, pipelines, finished } = setup({ connected: true });
    const agreed = context(organization(ORG_A, { documentAnalysisAt: 50 }));
    const draft = 'We have served the East Ward for more than a decade.';
    const { jobId } = await handlers.guides.requestFeedback(agreed, GUIDE, 'context', draft);
    expect((await finished(jobId))?.state).toBe('completed');
    expect(pipelines.reviewDraft).toHaveBeenCalledWith(expect.objectContaining({ draft, sectionId: 'context' }));
    const stored = guides.save.mock.calls[0]?.[1];
    expect(stored?.feedback).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toContain(draft);
  });
});

describe('keeping organizations apart', () => {
  it('works only on the organization the door resolved, whatever the arguments say', async () => {
    const { handlers, knowledge, rfps, guides, saved } = setup();
    const active = context(organization(ORG_B));
    await handlers.knowledge.listDocuments(active);
    await handlers.knowledge.getProfile(active);
    await handlers.knowledge.search(active, 'mission');
    await handlers.rfps.list(active);
    await handlers.guides.list(active);
    await handlers.opportunities.listSaved(active);
    for (const call of [knowledge.listDocuments, knowledge.getProfile, knowledge.search, rfps.list, guides.list, saved.list]) {
      expect(call.mock.calls[0]?.[0]).toBe(ORG_B);
    }
  });

  it('refuses work that needs an organization when none is active', async () => {
    const { handlers } = setup();
    expect((await refusal(() => handlers.knowledge.listDocuments(context(null)))).code).toBe('ORGANIZATION_NOT_FOUND');
    expect(await handlers.jobs.list(context(null))).toEqual([]);
  });

  it("cannot stop another organization's job", async () => {
    const { handlers, pipelines, jobs } = setup();
    pipelines.analyzeRfp.mockImplementationOnce(() => new Promise(() => {}));
    const { jobId } = await handlers.rfps.analyze(context(organization(ORG_A)), RFP);
    await handlers.jobs.cancel(context(organization(ORG_B)), jobId);
    expect(jobs.list(ORG_A).find((job) => job.id === jobId)?.state).toBe('running');
    await handlers.jobs.cancel(context(organization(ORG_A)), jobId);
    await vi.waitFor(() => expect(jobs.list(ORG_A).find((job) => job.id === jobId)?.state).toBe('cancelled'));
  });

  it('stops an organization\'s work and forgets it when it is deleted', async () => {
    const { handlers, jobs, identity, knowledge, forgetOrganization } = setup();
    const cancelAll = vi.spyOn(jobs, 'cancelAll');
    await handlers.identity.deleteOrganization(context(organization(ORG_B)), ORG_A);
    expect(cancelAll).toHaveBeenCalledWith(ORG_A);
    expect(identity.deleteOrganization).toHaveBeenCalledWith(ORG_A);
    expect(knowledge.forget).toHaveBeenCalledWith(ORG_A);
    expect(forgetOrganization).toHaveBeenCalledWith(ORG_A);
  });
});
