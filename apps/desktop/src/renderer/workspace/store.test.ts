import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ROLE_PERMISSIONS,
  type FundingEvent,
  type IdentityState,
  type JobProgress,
  type OrgRole,
  type Organization,
  type Outcome,
  type SetupStatus,
} from '../../shared/funding.js';
import type { TabState } from '../../shared/ipc.js';
import { CALL_FAILED_MESSAGE } from '../lib/funding-client.js';
import { useBrowserStore } from '../state/browser-store.js';
import {
  activeOrganization,
  connectWorkspace,
  findJob,
  focusedRfpId,
  handleFundingEvent,
  hasPermission,
  isStartPageUrl,
  openWorkspace,
  planStartPageTab,
  resetWorkspaceStore,
  subscribeToFundingEvents,
  upsertJob,
  useWorkspaceStore,
} from '../state/workspace-store.js';

// ─────────────────────────────────── fixtures ──────────────────────────────────

const RIVERBEND = 'a1111111-1111-4111-8111-111111111111';
const HARBOR = 'b2222222-2222-4222-8222-222222222222';

function organization(id: string, name: string, kind: Organization['kind'] = 'cbo'): Organization {
  return {
    schemaVersion: 1,
    id,
    name,
    kind,
    location: { country: 'US', region: 'NJ', county: 'Essex', city: 'Newark' },
    consents: { documentAnalysisAt: null, liveFundingSearchAt: null },
    createdAt: 1,
    updatedAt: 1,
  };
}

function identityWith(
  organizations: Organization[],
  activeId: string | null,
  role: OrgRole = 'owner',
): IdentityState {
  return {
    profile: {
      schemaVersion: 1,
      id: 'user-1',
      displayName: 'Sam',
      email: '',
      createdAt: 1,
      updatedAt: 1,
    },
    organizations,
    memberships: organizations.map((entry) => ({
      organizationId: entry.id,
      userId: 'user-1',
      role,
      status: 'active' as const,
      createdAt: 1,
      updatedAt: 1,
    })),
    session: {
      id: 'session-1',
      userId: 'user-1',
      organizationId: activeId,
      authMode: 'local',
      issuedAt: 1,
      expiresAt: null,
      role: activeId ? role : null,
      permissions: activeId ? [...ROLE_PERMISSIONS[role]] : [],
    },
  };
}

function setupStatus(completed: number, ready = false): SetupStatus {
  return {
    steps: [],
    completed,
    total: 5,
    readyForTailoredGuidance: ready,
    nextAction: 'Add your documents.',
    counts: {
      documents: 0,
      documentsReady: 0,
      documentsFailed: 0,
      claimsProposed: 0,
      claimsApproved: 0,
      claimsNeedingReview: 0,
      openConflicts: 0,
    },
  };
}

function job(overrides: Partial<JobProgress> = {}): JobProgress {
  return {
    id: 'job-1',
    kind: 'document_processing',
    organizationId: RIVERBEND,
    subjectId: 'doc-1',
    state: 'running',
    message: 'Reading the document',
    percent: 10,
    startedAt: 1_000,
    finishedAt: null,
    error: null,
    ...overrides,
  };
}

const ok = <T>(value: T): Promise<Outcome<T>> => Promise.resolve({ ok: true, value });
const refuse = <T>(
  code: 'FORBIDDEN' | 'INVALID_INPUT' | 'INTERNAL',
  message: string,
): Promise<Outcome<T>> => Promise.resolve({ ok: false, error: { code, message } });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Lets every pending promise callback run. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const riverbend = organization(RIVERBEND, 'Riverbend Kitchen');
const harbor = organization(HARBOR, 'Harbor Works', 'business');

/** A stand-in for window.bullebrowser with only what the store calls. */
function installBridge(initial: IdentityState) {
  const listeners = new Set<(event: FundingEvent) => void>();
  const state = { identity: initial };
  const funding = {
    identity: {
      get: vi.fn(() => ok(state.identity)),
      createOrganization: vi.fn(() => ok(state.identity)),
      updateOrganization: vi.fn(() => ok(state.identity)),
      switchOrganization: vi.fn((id: string) => {
        state.identity = identityWith(state.identity.organizations, id);
        return ok(state.identity);
      }),
      deleteOrganization: vi.fn(() => ok(state.identity)),
      recordConsent: vi.fn(() => ok(state.identity)),
      assistant: vi.fn(() => ok({ connected: false, note: '' })),
    },
    knowledge: { setupStatus: vi.fn(() => ok(setupStatus(2))) },
    jobs: { list: vi.fn(() => ok<JobProgress[]>([])), cancel: vi.fn(() => ok(null)) },
    onEvent: vi.fn((callback: (event: FundingEvent) => void) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    }),
  };
  const tabs = {
    list: vi.fn(async (): Promise<Pick<TabState, 'id' | 'url' | 'active'>[]> => []),
    switch: vi.fn(async () => {}),
    create: vi.fn(async () => ({})),
  };
  vi.stubGlobal('window', { bullebrowser: { funding, tabs } });
  return {
    funding,
    tabs,
    state,
    listenerCount: () => listeners.size,
    emit: (event: FundingEvent) => {
      for (const listener of [...listeners]) listener(event);
    },
  };
}

const store = () => useWorkspaceStore.getState();

beforeEach(() => {
  resetWorkspaceStore();
  useBrowserStore.setState({ showSettings: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ──────────────────────────────────── routes ───────────────────────────────────

describe('navigate', () => {
  it('sets the route and its parameters, and counts the visit', () => {
    store().navigate('rfp', { rfpId: 'rfp-1', view: 'alignment' });
    expect(store()).toMatchObject({
      route: 'rfp',
      params: { rfpId: 'rfp-1', view: 'alignment' },
      visit: 1,
    });
  });

  it('replaces the previous parameters instead of merging them', () => {
    store().navigate('rfp', { rfpId: 'rfp-1', view: 'alignment' });
    store().navigate('rfp', { view: 'priorities' });
    expect(store().params).toEqual({ view: 'priorities' });
    store().navigate('knowledge');
    expect(store().params).toEqual({});
    expect(store().visit).toBe(3);
  });
});

describe('focusedRfpId', () => {
  it('is the funding document the RFP Analysis screen was opened with', async () => {
    installBridge(identityWith([riverbend], RIVERBEND));
    await store().refreshIdentity();
    expect(focusedRfpId(store())).toBeUndefined();
    store().navigate('rfp', { rfpId: 'rfp-7', view: 'analysis' });
    expect(focusedRfpId(store())).toBe('rfp-7');
    store().navigate('rfp', { view: 'priorities' });
    expect(focusedRfpId(store())).toBeUndefined();
    store().navigate('guide', { rfpId: 'rfp-7' });
    expect(focusedRfpId(store())).toBeUndefined();
  });

  it('is nothing once that organization is no longer the active one', async () => {
    installBridge(identityWith([riverbend, harbor], RIVERBEND));
    await store().refreshIdentity();
    store().navigate('rfp', { rfpId: 'rfp-7' });
    await store().switchOrganization(HARBOR);
    expect(focusedRfpId(store())).toBeUndefined();
    expect(
      focusedRfpId({ identity: null, route: 'rfp', params: { rfpId: 'rfp-7' } }),
    ).toBeUndefined();
  });
});

// ─────────────────────────────────── identity ──────────────────────────────────

describe('identity', () => {
  it('loads identity, then the setup status and jobs of the active organization', async () => {
    const bridge = installBridge(identityWith([riverbend], RIVERBEND));
    await store().refreshIdentity();
    await settle();
    expect(store().identityStatus).toBe('ready');
    expect(activeOrganization(store().identity)?.name).toBe('Riverbend Kitchen');
    expect(store()).toMatchObject({ setupStatus: 'ready', setup: { completed: 2 } });
    expect(bridge.funding.knowledge.setupStatus).toHaveBeenCalledTimes(1);
    expect(bridge.funding.jobs.list).toHaveBeenCalledTimes(1);
  });

  it('keeps a route chosen before the first load: the first load is not a switch', async () => {
    installBridge(identityWith([riverbend], RIVERBEND));
    store().navigate('opportunities');
    await store().refreshIdentity();
    expect(store().route).toBe('opportunities');
  });

  it('asks for nothing organization-specific when there is no organization', async () => {
    const bridge = installBridge(identityWith([], null));
    await store().refreshIdentity();
    await settle();
    expect(store()).toMatchObject({ identityStatus: 'ready', setup: null, setupStatus: 'idle' });
    expect(bridge.funding.knowledge.setupStatus).not.toHaveBeenCalled();
    expect(bridge.funding.jobs.list).not.toHaveBeenCalled();
  });

  it('shows an error that is safe to show when main does not answer', async () => {
    const bridge = installBridge(identityWith([riverbend], RIVERBEND));
    bridge.funding.identity.get.mockImplementation(() =>
      Promise.reject(new Error("No handler registered for 'funding:call'")),
    );
    await store().refreshIdentity();
    expect(store()).toMatchObject({ identity: null, identityStatus: 'error' });
    expect(store().identityError).toMatchObject({ code: 'INTERNAL', message: CALL_FAILED_MESSAGE });
  });

  it('names no organization once identity can no longer be confirmed', async () => {
    const bridge = installBridge(identityWith([riverbend], RIVERBEND));
    await store().refreshIdentity();
    bridge.funding.identity.get.mockImplementation(() =>
      refuse('INTERNAL', 'Something went wrong.'),
    );
    await store().refreshIdentity();
    expect(store().identity).toBeNull();
    expect(activeOrganization(store().identity)).toBeNull();
    expect(store().identityError?.message).toBe('Something went wrong.');
  });

  it('carries on in the same place when the same organization comes back after an error', async () => {
    const bridge = installBridge(identityWith([riverbend], RIVERBEND));
    await store().refreshIdentity();
    store().navigate('guide');
    bridge.funding.identity.get.mockImplementationOnce(() =>
      refuse('INTERNAL', 'Something went wrong.'),
    );
    await store().refreshIdentity();
    await store().refreshIdentity();
    await settle();
    expect(store()).toMatchObject({
      identityStatus: 'ready',
      route: 'guide',
      setupStatus: 'ready',
    });
  });

  it('lets only the most recent read win', async () => {
    const bridge = installBridge(identityWith([riverbend, harbor], RIVERBEND));
    const slow = deferred<Outcome<IdentityState>>();
    bridge.funding.identity.get.mockImplementationOnce(() => slow.promise);
    const first = store().refreshIdentity();
    await store().switchOrganization(HARBOR);
    slow.resolve({ ok: true, value: identityWith([riverbend, harbor], RIVERBEND) });
    await first;
    expect(activeOrganization(store().identity)?.id).toBe(HARBOR);
  });

  it('answers permission questions from the session', async () => {
    installBridge(identityWith([riverbend], RIVERBEND, 'viewer'));
    await store().refreshIdentity();
    expect(hasPermission(store().identity, 'knowledge.read')).toBe(true);
    expect(hasPermission(store().identity, 'knowledge.manage')).toBe(false);
    expect(hasPermission(null, 'knowledge.read')).toBe(false);
  });
});

// ───────────────────────────── switching organization ──────────────────────────

describe('switching organization', () => {
  async function workingInRiverbend() {
    const bridge = installBridge(identityWith([riverbend, harbor], RIVERBEND));
    await store().refreshIdentity();
    await settle();
    store().navigate('rfp', { rfpId: 'rfp-1', view: 'analysis' });
    handleFundingEvent({ kind: 'job', job: job() });
    store().setScreenState('opportunities.results', ['a listing found for Riverbend']);
    return bridge;
  }

  it('goes back to the dashboard and clears everything held for the previous one', async () => {
    const bridge = await workingInRiverbend();
    expect(store().jobs).toHaveLength(1);
    const pendingSetup = deferred<Outcome<SetupStatus>>();
    bridge.funding.knowledge.setupStatus.mockImplementationOnce(() => pendingSetup.promise);

    await store().switchOrganization(HARBOR);

    // At once, before anything for the new organization has arrived.
    expect(activeOrganization(store().identity)?.name).toBe('Harbor Works');
    expect(store()).toMatchObject({
      route: 'dashboard',
      params: {},
      setup: null,
      setupStatus: 'loading',
      jobs: [],
      screenState: {},
    });

    pendingSetup.resolve({ ok: true, value: setupStatus(4, true) });
    await settle();
    expect(store().setup).toMatchObject({ completed: 4, readyForTailoredGuidance: true });
  });

  it('drops an answer that was on its way for the previous organization', async () => {
    const bridge = await workingInRiverbend();
    const stale = deferred<Outcome<SetupStatus>>();
    bridge.funding.knowledge.setupStatus.mockImplementationOnce(() => stale.promise);
    const reading = store().refreshSetup();

    bridge.funding.knowledge.setupStatus.mockImplementation(() => ok(setupStatus(1)));
    await store().switchOrganization(HARBOR);
    await settle();
    stale.resolve({ ok: true, value: setupStatus(5, true) });
    await reading;

    expect(store().setup).toMatchObject({ completed: 1, readyForTailoredGuidance: false });
  });

  it('reports a refused switch and changes nothing', async () => {
    const bridge = await workingInRiverbend();
    bridge.funding.identity.switchOrganization.mockImplementationOnce(() =>
      refuse('FORBIDDEN', 'You are not a member of that organization.'),
    );
    await expect(store().switchOrganization(HARBOR)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'You are not a member of that organization.',
    });
    expect(activeOrganization(store().identity)?.id).toBe(RIVERBEND);
    expect(store().route).toBe('rfp');
    expect(store().jobs).toHaveLength(1);
  });

  it('treats a change of organization reported by main the same way', async () => {
    const bridge = await workingInRiverbend();
    bridge.state.identity = identityWith([riverbend, harbor], HARBOR);
    handleFundingEvent({ kind: 'identity_changed' });
    await settle();
    expect(activeOrganization(store().identity)?.id).toBe(HARBOR);
    expect(store()).toMatchObject({ route: 'dashboard', jobs: [], screenState: {} });
  });

  it('does not reset anything when the organization is only edited', async () => {
    const bridge = await workingInRiverbend();
    const renamed = { ...riverbend, name: 'Riverbend Community Kitchen' };
    bridge.funding.identity.updateOrganization.mockImplementationOnce(() =>
      ok(identityWith([renamed, harbor], RIVERBEND)),
    );
    await store().updateOrganization(RIVERBEND, { name: renamed.name });
    expect(activeOrganization(store().identity)?.name).toBe('Riverbend Community Kitchen');
    expect(store()).toMatchObject({ route: 'rfp', params: { rfpId: 'rfp-1' } });
    expect(store().jobs).toHaveLength(1);
  });

  it('leaves no organization behind when the last one is deleted', async () => {
    const bridge = installBridge(identityWith([riverbend], RIVERBEND));
    await store().refreshIdentity();
    await settle();
    store().navigate('knowledge', { tab: 'profile' });
    bridge.funding.identity.deleteOrganization.mockImplementationOnce(() =>
      ok(identityWith([], null)),
    );
    await store().deleteOrganization(RIVERBEND);
    expect(activeOrganization(store().identity)).toBeNull();
    expect(store()).toMatchObject({
      route: 'dashboard',
      setup: null,
      setupStatus: 'idle',
      jobs: [],
    });
  });
});

// ─────────────────────────────── creating one ──────────────────────────────────

describe('creating an organization', () => {
  const input = {
    name: 'Riverbend Kitchen',
    kind: 'cbo' as const,
    location: { country: 'US', region: 'NJ', county: 'Essex', city: 'Newark' },
  };

  it('continues the first-run steps for the new organization until they are finished', async () => {
    const bridge = installBridge(identityWith([], null));
    await store().refreshIdentity();
    bridge.funding.identity.createOrganization.mockImplementationOnce(() =>
      ok(identityWith([riverbend], RIVERBEND)),
    );
    await store().createOrganization(input, { onboarding: true });
    expect(bridge.funding.identity.createOrganization).toHaveBeenCalledWith(input);
    expect(activeOrganization(store().identity)?.id).toBe(RIVERBEND);
    expect(store().onboardingOrganizationId).toBe(RIVERBEND);
    store().finishOnboarding();
    expect(store().onboardingOrganizationId).toBeNull();
  });

  it('carries on with the first-run steps when main\u2019s event arrives before its answer', async () => {
    const bridge = installBridge(identityWith([], null));
    await store().refreshIdentity();
    const answer = deferred<Outcome<IdentityState>>();
    bridge.funding.identity.createOrganization.mockImplementationOnce(() => answer.promise);
    const creating = store().createOrganization(input, { onboarding: true });

    // Main has made the organization and says so; the answer is still on its way.
    bridge.state.identity = identityWith([riverbend], RIVERBEND);
    handleFundingEvent({ kind: 'identity_changed' });
    await settle();
    expect(activeOrganization(store().identity)?.id).toBe(RIVERBEND);
    expect(store().onboardingOrganizationId).toBe(RIVERBEND);

    answer.resolve({ ok: true, value: bridge.state.identity });
    await creating;
    expect(store().onboardingOrganizationId).toBe(RIVERBEND);
  });

  it('does not mistake a later switch for the first-run steps', async () => {
    const bridge = installBridge(identityWith([riverbend, harbor], RIVERBEND));
    await store().refreshIdentity();
    bridge.funding.identity.createOrganization.mockImplementationOnce(() =>
      refuse('INVALID_INPUT', 'Enter an organization name between 2 and 120 characters long.'),
    );
    await expect(
      store().createOrganization({ ...input, name: 'x' }, { onboarding: true }),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await store().switchOrganization(HARBOR);
    expect(store().onboardingOrganizationId).toBeNull();
  });

  it('makes the new organization the active one when main has not', async () => {
    const bridge = installBridge(identityWith([], null));
    await store().refreshIdentity();
    bridge.funding.identity.createOrganization.mockImplementationOnce(() => {
      bridge.state.identity = identityWith([riverbend], null);
      return ok(bridge.state.identity);
    });
    await store().createOrganization(input, { onboarding: true });
    expect(bridge.funding.identity.switchOrganization).toHaveBeenCalledWith(RIVERBEND);
    expect(activeOrganization(store().identity)?.id).toBe(RIVERBEND);
    expect(store().onboardingOrganizationId).toBe(RIVERBEND);
  });

  it('does not start the first-run steps for an organization added later', async () => {
    const bridge = installBridge(identityWith([riverbend], RIVERBEND));
    await store().refreshIdentity();
    store().navigate('guide');
    bridge.funding.identity.createOrganization.mockImplementationOnce(() =>
      ok(identityWith([riverbend, harbor], HARBOR)),
    );
    await store().createOrganization({ ...input, name: 'Harbor Works', kind: 'business' });
    expect(store().onboardingOrganizationId).toBeNull();
    expect(activeOrganization(store().identity)?.id).toBe(HARBOR);
    expect(store().route).toBe('dashboard');
  });

  it('passes on what main says is wrong with the input', async () => {
    const bridge = installBridge(identityWith([], null));
    await store().refreshIdentity();
    bridge.funding.identity.createOrganization.mockImplementationOnce(() =>
      refuse('INVALID_INPUT', 'Enter the organization’s name.'),
    );
    await expect(store().createOrganization({ ...input, name: '' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'Enter the organization’s name.',
    });
    expect(store().onboardingOrganizationId).toBeNull();
  });

  it('keeps what main created when making it active fails', async () => {
    const bridge = installBridge(identityWith([], null));
    await store().refreshIdentity();
    bridge.funding.identity.createOrganization.mockImplementationOnce(() =>
      ok(identityWith([riverbend], null)),
    );
    bridge.funding.identity.switchOrganization.mockImplementationOnce(() =>
      refuse('INTERNAL', 'Something went wrong. Please try again.'),
    );
    await expect(store().createOrganization(input, { onboarding: true })).rejects.toMatchObject({
      code: 'INTERNAL',
    });
    expect(store().identity?.organizations).toHaveLength(1);
    expect(activeOrganization(store().identity)).toBeNull();
    expect(store().onboardingOrganizationId).toBeNull();
  });
});

// ──────────────────────────────────── events ───────────────────────────────────

describe('funding events', () => {
  async function connected() {
    const bridge = installBridge(identityWith([riverbend, harbor], RIVERBEND));
    await store().refreshIdentity();
    await settle();
    bridge.funding.knowledge.setupStatus.mockClear();
    return bridge;
  }

  it('re-reads the setup status when documents or the profile change', async () => {
    const bridge = await connected();
    bridge.funding.knowledge.setupStatus.mockImplementation(() => ok(setupStatus(3, true)));
    handleFundingEvent({ kind: 'documents_changed', organizationId: RIVERBEND });
    handleFundingEvent({ kind: 'profile_changed', organizationId: RIVERBEND });
    await settle();
    expect(bridge.funding.knowledge.setupStatus).toHaveBeenCalledTimes(2);
    expect(store().setup).toMatchObject({ completed: 3, readyForTailoredGuidance: true });
  });

  it('ignores events about an organization that is not the active one', async () => {
    const bridge = await connected();
    const heard = vi.fn();
    subscribeToFundingEvents(['documents_changed', 'job', 'saved_changed'], heard);
    handleFundingEvent({ kind: 'documents_changed', organizationId: HARBOR });
    handleFundingEvent({ kind: 'saved_changed', organizationId: HARBOR });
    handleFundingEvent({ kind: 'job', job: job({ organizationId: HARBOR }) });
    await settle();
    expect(bridge.funding.knowledge.setupStatus).not.toHaveBeenCalled();
    expect(store().jobs).toEqual([]);
    expect(heard).not.toHaveBeenCalled();
  });

  it('keeps one entry per job and follows it to its end', async () => {
    const bridge = await connected();
    handleFundingEvent({ kind: 'job', job: job({ percent: 10 }) });
    handleFundingEvent({ kind: 'job', job: job({ percent: 60, message: 'Indexing' }) });
    expect(store().jobs).toHaveLength(1);
    expect(store().jobs[0]).toMatchObject({ percent: 60, message: 'Indexing' });
    expect(bridge.funding.knowledge.setupStatus).not.toHaveBeenCalled();

    handleFundingEvent({
      kind: 'job',
      job: job({ state: 'completed', percent: 100, finishedAt: Date.now() }),
    });
    await settle();
    expect(store().jobs[0]?.state).toBe('completed');
    // A document that has been read changes how far setup has got.
    expect(bridge.funding.knowledge.setupStatus).toHaveBeenCalledTimes(1);
  });

  it('does not re-read setup for jobs that cannot change it', async () => {
    const bridge = await connected();
    handleFundingEvent({
      kind: 'job',
      job: job({
        id: 'job-2',
        kind: 'rfp_analysis',
        subjectId: 'rfp-1',
        state: 'completed',
        finishedAt: Date.now(),
      }),
    });
    await settle();
    expect(bridge.funding.knowledge.setupStatus).not.toHaveBeenCalled();
  });

  it('tells screens only about the kinds they asked for', async () => {
    await connected();
    const saved = vi.fn();
    const documents = vi.fn();
    const stopSaved = subscribeToFundingEvents(['saved_changed'], saved);
    subscribeToFundingEvents(['documents_changed', 'rfps_changed'], documents);

    handleFundingEvent({ kind: 'saved_changed', organizationId: RIVERBEND });
    handleFundingEvent({ kind: 'rfps_changed', organizationId: RIVERBEND });
    expect(saved).toHaveBeenCalledTimes(1);
    expect(saved).toHaveBeenCalledWith({ kind: 'saved_changed', organizationId: RIVERBEND });
    expect(documents).toHaveBeenCalledTimes(1);

    stopSaved();
    handleFundingEvent({ kind: 'saved_changed', organizationId: RIVERBEND });
    expect(saved).toHaveBeenCalledTimes(1);
  });

  it('keeps telling the others when one handler throws', async () => {
    await connected();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const heard = vi.fn();
    subscribeToFundingEvents(['guides_changed'], () => {
      throw new Error('a screen bug');
    });
    subscribeToFundingEvents(['guides_changed'], heard);
    expect(() =>
      handleFundingEvent({ kind: 'guides_changed', organizationId: RIVERBEND }),
    ).not.toThrow();
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('tells screens about an identity change once the store holds the new identity', async () => {
    const bridge = await connected();
    const seen: (string | undefined)[] = [];
    subscribeToFundingEvents(['identity_changed'], () => {
      seen.push(activeOrganization(store().identity)?.name);
    });
    bridge.state.identity = identityWith([riverbend, harbor], HARBOR);
    handleFundingEvent({ kind: 'identity_changed' });
    expect(seen).toEqual([]);
    await settle();
    expect(seen).toEqual(['Harbor Works']);
  });

  it('fills in jobs that were already running, without overwriting newer news', async () => {
    const bridge = installBridge(identityWith([riverbend], RIVERBEND));
    const listed = deferred<Outcome<JobProgress[]>>();
    bridge.funding.jobs.list.mockImplementationOnce(() => listed.promise);
    await store().refreshIdentity();
    handleFundingEvent({ kind: 'job', job: job({ percent: 80 }) });
    listed.resolve({
      ok: true,
      value: [
        job({ percent: 20 }),
        job({ id: 'job-9', kind: 'rfp_analysis', subjectId: 'rfp-1', startedAt: 500 }),
        job({ id: 'job-x', organizationId: HARBOR }),
      ],
    });
    await settle();
    expect(store().jobs.map((entry) => entry.id)).toEqual(['job-1', 'job-9']);
    expect(findJob(store().jobs, 'document_processing', 'doc-1')?.percent).toBe(80);
  });

  it('asks main to stop a job', async () => {
    const bridge = await connected();
    await store().stopJob('job-1');
    expect(bridge.funding.jobs.cancel).toHaveBeenCalledWith('job-1');
  });
});

// ─────────────────────────────────── connecting ────────────────────────────────

describe('connectWorkspace', () => {
  it('subscribes once, loads identity and the assistant, and lets go when released', async () => {
    const bridge = installBridge(identityWith([riverbend], RIVERBEND));
    const releaseFirst = connectWorkspace();
    const releaseSecond = connectWorkspace();
    await settle();
    expect(bridge.funding.onEvent).toHaveBeenCalledTimes(1);
    expect(bridge.funding.identity.get).toHaveBeenCalledTimes(1);
    expect(store().assistant).toEqual({ connected: false, note: '' });

    bridge.emit({ kind: 'job', job: job() });
    expect(store().jobs).toHaveLength(1);

    releaseFirst();
    releaseFirst();
    expect(bridge.listenerCount()).toBe(1);
    releaseSecond();
    expect(bridge.listenerCount()).toBe(0);
  });

  it('checks the assistant again when Settings closes', async () => {
    const bridge = installBridge(identityWith([riverbend], RIVERBEND));
    const release = connectWorkspace();
    await settle();
    bridge.funding.identity.assistant.mockImplementation(() => ok({ connected: true, note: '' }));
    useBrowserStore.getState().openSettings();
    expect(bridge.funding.identity.assistant).toHaveBeenCalledTimes(1);
    useBrowserStore.getState().closeSettings();
    await settle();
    expect(store().assistant?.connected).toBe(true);
    release();
  });

  it('shows the error state instead of failing when there is no bridge at all', async () => {
    vi.stubGlobal('window', { bullebrowser: {} });
    const release = connectWorkspace();
    await settle();
    expect(store()).toMatchObject({ identity: null, identityStatus: 'error' });
    expect(store().identityError?.message).toBe(CALL_FAILED_MESSAGE);
    release();
  });
});

// ────────────────────────────── opening the workspace ──────────────────────────

describe('openWorkspace', () => {
  const tab = (id: string, url: string, active = false) => ({ id, url, active });

  it('knows a start page when it sees one', () => {
    expect(isStartPageUrl('')).toBe(true);
    expect(isStartPageUrl('about:blank')).toBe(true);
    expect(isStartPageUrl(undefined)).toBe(true);
    expect(isStartPageUrl('https://grants.example.gov/')).toBe(false);
  });

  it('plans the least disruptive way to a start-page tab', () => {
    expect(planStartPageTab([tab('1', 'about:blank', true)])).toEqual({ kind: 'already' });
    expect(planStartPageTab([tab('1', 'https://a.example', true), tab('2', '')])).toEqual({
      kind: 'switch',
      tabId: '2',
    });
    expect(planStartPageTab([tab('1', 'https://a.example', true)])).toEqual({ kind: 'create' });
    expect(planStartPageTab([])).toEqual({ kind: 'create' });
  });

  it('does nothing to the tabs when the workspace is already in front', async () => {
    const bridge = installBridge(identityWith([riverbend], RIVERBEND));
    bridge.tabs.list.mockResolvedValue([tab('1', 'about:blank', true)]);
    await openWorkspace('opportunities');
    expect(store().route).toBe('opportunities');
    expect(bridge.tabs.switch).not.toHaveBeenCalled();
    expect(bridge.tabs.create).not.toHaveBeenCalled();
  });

  it('reuses a start-page tab that is open in the background', async () => {
    const bridge = installBridge(identityWith([riverbend], RIVERBEND));
    bridge.tabs.list.mockResolvedValue([
      tab('1', 'https://a.example', true),
      tab('2', 'about:blank'),
    ]);
    await openWorkspace('rfp', { view: 'alignment' });
    expect(bridge.tabs.switch).toHaveBeenCalledWith('2');
    expect(bridge.tabs.create).not.toHaveBeenCalled();
    expect(store()).toMatchObject({ route: 'rfp', params: { view: 'alignment' } });
  });

  it('opens a new tab when every tab is on a web page, and goes to the dashboard by default', async () => {
    const bridge = installBridge(identityWith([riverbend], RIVERBEND));
    bridge.tabs.list.mockResolvedValue([tab('1', 'https://a.example', true)]);
    store().navigate('guide');
    await openWorkspace();
    expect(bridge.tabs.create).toHaveBeenCalledWith();
    expect(store().route).toBe('dashboard');
  });

  it('leaves the first-run steps once their organization exists', async () => {
    const bridge = installBridge(identityWith([], null));
    await store().refreshIdentity();
    bridge.funding.identity.createOrganization.mockImplementationOnce(() =>
      ok(identityWith([riverbend], RIVERBEND)),
    );
    await store().createOrganization(
      { name: 'Riverbend Kitchen', kind: 'cbo', location: riverbend.location },
      { onboarding: true },
    );
    expect(store().onboardingOrganizationId).toBe(RIVERBEND);
    bridge.tabs.list.mockResolvedValue([tab('1', 'about:blank', true)]);
    await openWorkspace('opportunities');
    expect(store()).toMatchObject({ onboardingOrganizationId: null, route: 'opportunities' });
  });

  it('still sets the route when the tabs cannot be read', async () => {
    const bridge = installBridge(identityWith([riverbend], RIVERBEND));
    bridge.tabs.list.mockRejectedValue(new Error('window closed'));
    await expect(openWorkspace('knowledge', { tab: 'profile' })).resolves.toBeUndefined();
    expect(store()).toMatchObject({ route: 'knowledge', params: { tab: 'profile' } });
  });
});

// ───────────────────────────────────── jobs ────────────────────────────────────

describe('jobs', () => {
  it('replaces a job by id and keeps the newest first', () => {
    const older = job({ id: 'a', startedAt: 100 });
    const newer = job({ id: 'b', startedAt: 200 });
    const jobs = upsertJob(upsertJob([], older, 300), newer, 300);
    expect(jobs.map((entry) => entry.id)).toEqual(['b', 'a']);
    const updated = upsertJob(jobs, { ...older, percent: 90 }, 300);
    expect(updated).toHaveLength(2);
    expect(updated.find((entry) => entry.id === 'a')?.percent).toBe(90);
  });

  it('lets go of jobs that finished a while ago', () => {
    const now = 1_000_000_000;
    const longDone = job({ id: 'old', state: 'completed', finishedAt: now - 11 * 60 * 1000 });
    const justDone = job({ id: 'recent', state: 'failed', finishedAt: now - 60 * 1000 });
    const jobs = upsertJob([longDone, justDone], job({ id: 'new' }), now);
    expect(jobs.map((entry) => entry.id).sort()).toEqual(['new', 'recent']);
  });

  it('finds the running job for a subject before one that finished', () => {
    const done = job({ id: 'done', state: 'completed', startedAt: 300, finishedAt: 400 });
    const running = job({ id: 'running', startedAt: 200 });
    const other = job({ id: 'other', subjectId: 'doc-2', startedAt: 500 });
    const jobs = [other, done, running];
    expect(findJob(jobs, 'document_processing', 'doc-1')?.id).toBe('running');
    expect(findJob([other, done], 'document_processing', 'doc-1')?.id).toBe('done');
    expect(findJob(jobs, 'profile_extraction')).toBeUndefined();
  });
});
