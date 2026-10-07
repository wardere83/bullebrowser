// Renderer-side state for the funding workspace: where the user is, who they
// are working as, and the few things every screen needs about the active
// organization. The main process is the source of truth; this store mirrors it
// and is brought up to date by the events main pushes.
//
// One rule shapes this file: nothing that belongs to one organization may stay
// on screen after another becomes active. Everything held for an organization
// is cleared in `applyIdentity` the moment the active one changes, the route
// goes back to the Knowledge Hub, and events about any other organization are
// dropped before a screen can see them.

import { useCallback, useEffect, useRef } from 'react';
import { create } from 'zustand';
import type { TabState } from '../../shared/ipc.js';
import type {
  AssistantAvailability,
  FundingEvent,
  IdentityState,
  JobKind,
  JobProgress,
  NewOrganizationInput,
  Organization,
  OrgConsents,
  Permission,
  ProfileFieldId,
  SetupStatus,
} from '../../shared/funding.js';
import {
  CALL_FAILED_MESSAGE,
  FundingCallError,
  fundingBridge,
  toCallError,
  unwrap,
} from '../lib/funding-client.js';
import { useBrowserStore } from './browser-store.js';

// ─────────────────────────────────── routes ───────────────────────────────────

export type WorkspaceRoute = 'knowledge' | 'opportunities' | 'rfp' | 'guide';

export type KnowledgeTab = 'documents' | 'profile' | 'priorities' | 'search';
export type RfpView = 'analysis' | 'alignment' | 'priorities';

/**
 * What a route can be opened with. Every key is optional: a screen must work
 * when opened with none. A screen that needs another deep link adds an optional
 * key to its own entry here and nowhere else.
 */
export interface WorkspaceParams {
  opportunities: { view?: 'search' | 'saved' | 'portals'; opportunityId?: string };
  knowledge: { tab?: KnowledgeTab; documentId?: string; field?: ProfileFieldId };
  rfp: { rfpId?: string; view?: RfpView };
  guide: { guideId?: string; rfpId?: string; sectionId?: string };
}

/** A route together with the parameters that belong to it. */
export type WorkspaceLocation = {
  [R in WorkspaceRoute]: { route: R; params: WorkspaceParams[R] };
}[WorkspaceRoute];

const NO_PARAMS: Record<string, never> = Object.freeze({});

// ─────────────────────────────────── helpers ──────────────────────────────────

/** The organization the session is working in, or null when there is none. */
export function activeOrganization(identity: IdentityState | null): Organization | null {
  const id = identity?.session.organizationId;
  if (!id) return null;
  return identity.organizations.find((organization) => organization.id === id) ?? null;
}

function activeOrganizationId(identity: IdentityState | null): string | null {
  return activeOrganization(identity)?.id ?? null;
}

/** Whether the session may do something in the active organization. */
export function hasPermission(identity: IdentityState | null, permission: Permission): boolean {
  return identity?.session.permissions.includes(permission) ?? false;
}

/** Finished jobs are kept this long, matching how long main keeps them. */
const KEEP_FINISHED_JOBS_MS = 10 * 60 * 1000;
const MAX_JOBS = 100;

/** Adds a job or replaces the one with the same id. Newest first. */
export function upsertJob(
  jobs: readonly JobProgress[],
  job: JobProgress,
  now: number = Date.now(),
): JobProgress[] {
  const cutoff = now - KEEP_FINISHED_JOBS_MS;
  const others = jobs.filter(
    (other) => other.id !== job.id && (other.finishedAt === null || other.finishedAt >= cutoff),
  );
  return [job, ...others].sort((a, b) => b.startedAt - a.startedAt).slice(0, MAX_JOBS);
}

/**
 * The job to show for a piece of work: the one that is running, or else the
 * most recent one that finished. `subjectId` is the document, RFP or guide the
 * work belongs to, and is empty for work on the organization as a whole.
 */
export function findJob(
  jobs: readonly JobProgress[],
  kind: JobKind,
  subjectId = '',
): JobProgress | undefined {
  const matching = jobs.filter((job) => job.kind === kind && job.subjectId === subjectId);
  return matching.find((job) => job.state === 'running') ?? matching[0];
}

/**
 * The funding document the user has open in the workspace, if any: the one the
 * RFP Analysis screen was opened with. The assistant panel sends it with each
 * message so answers can be about that document.
 */
export function focusedRfpId(
  state: Pick<WorkspaceData, 'identity' | 'route' | 'params'>,
): string | undefined {
  if (state.route !== 'rfp' || !activeOrganization(state.identity)) return undefined;
  return (state.params as WorkspaceParams['rfp']).rfpId || undefined;
}

/** Must agree with isStartPage() in the tab manager and the check in App. */
export function isStartPageUrl(url: string | null | undefined): boolean {
  return !url || url === 'about:blank';
}

export type StartPagePlan =
  | { kind: 'already' }
  | { kind: 'switch'; tabId: string }
  | { kind: 'create' };

/** How to bring a start-page tab to the front: the workspace is painted there. */
export function planStartPageTab(
  tabs: readonly Pick<TabState, 'id' | 'url' | 'active'>[],
): StartPagePlan {
  const active = tabs.find((tab) => tab.active);
  if (active && isStartPageUrl(active.url)) return { kind: 'already' };
  const existing = tabs.find((tab) => isStartPageUrl(tab.url));
  return existing ? { kind: 'switch', tabId: existing.id } : { kind: 'create' };
}

// ──────────────────────────────────── store ───────────────────────────────────

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface WorkspaceData {
  /** The screen that is showing, and what it was opened with. */
  route: WorkspaceRoute;
  params: WorkspaceParams[WorkspaceRoute];
  /** Goes up on every navigate(), including one to the route already showing. */
  visit: number;

  /** The local profile, its organizations and the session. Null until loaded. */
  identity: IdentityState | null;
  identityStatus: 'loading' | 'ready' | 'error';
  identityError: FundingCallError | null;
  /** Set while the first-run steps continue for an organization just created. */
  onboardingOrganizationId: string | null;

  // Held for the active organization only; cleared when it changes.
  setup: SetupStatus | null;
  setupStatus: LoadStatus;
  setupError: FundingCallError | null;
  jobs: JobProgress[];
  /** What screens chose to remember; see useScreenState. */
  screenState: Record<string, unknown>;

  /** Whether an assistant is connected. Not tied to an organization. */
  assistant: AssistantAvailability | null;
}

export interface WorkspaceActions {
  /** Shows a screen. Parameters replace, never merge with, the previous ones. */
  navigate<R extends WorkspaceRoute>(route: R, params?: WorkspaceParams[R]): void;
  /** Reads identity from main. A failure leaves no organization on screen. */
  refreshIdentity(): Promise<void>;
  /** Takes an identity main returned from a change, without another read. */
  applyIdentity(identity: IdentityState): void;
  refreshSetup(): Promise<void>;
  refreshAssistant(): Promise<void>;
  refreshJobs(): Promise<void>;
  /**
   * The organization calls below resolve when the store is up to date, and
   * reject with a FundingCallError whose message can be shown.
   */
  createOrganization(
    input: NewOrganizationInput,
    options?: { onboarding?: boolean },
  ): Promise<void>;
  updateOrganization(organizationId: string, patch: Partial<NewOrganizationInput>): Promise<void>;
  switchOrganization(organizationId: string): Promise<void>;
  deleteOrganization(organizationId: string): Promise<void>;
  recordConsent(consent: keyof OrgConsents): Promise<void>;
  /** Leaves the first-run steps; the Knowledge Hub carries the setup status from here. */
  finishOnboarding(): void;
  /** Asks main to stop a running job. The job's final state arrives as an event. */
  stopJob(jobId: string): Promise<void>;
  setScreenState(key: string, value: unknown): void;
}

export type WorkspaceState = WorkspaceData & WorkspaceActions;

export const INITIAL_WORKSPACE_DATA: WorkspaceData = {
  route: 'knowledge',
  params: NO_PARAMS,
  visit: 0,
  identity: null,
  identityStatus: 'loading',
  identityError: null,
  onboardingOrganizationId: null,
  setup: null,
  setupStatus: 'idle',
  setupError: null,
  jobs: [],
  screenState: {},
  assistant: null,
};

// Each read is numbered so that an answer which arrives after a newer request,
// or after the organization changed, is dropped instead of overwriting it.
let identityRequest = 0;
let setupRequest = 0;
let jobsRequest = 0;
let assistantRequest = 0;
// The organization the store last confirmed. `undefined` until the first
// successful read, which is not a switch and must not reset the route.
let confirmedOrganizationId: string | null | undefined;
// True while the first-run steps are creating their organization. Main's
// "identity changed" event can reach the store before the answer to the create
// call does; the organization that turns up meanwhile is the one being set up,
// and the steps must carry on rather than give way to the Knowledge Hub.
let creatingForOnboarding = false;

type EventKind = FundingEvent['kind'];
type EventOf<K extends EventKind> = Extract<FundingEvent, { kind: K }>;

interface FundingEventListener {
  kinds: ReadonlySet<EventKind>;
  handler: (event: FundingEvent) => void;
}

/** Screens that asked to hear about funding events; see subscribeToFundingEvents. */
const eventListeners = new Set<FundingEventListener>();

/** Jobs whose end changes the setup status. */
const SETUP_JOB_KINDS: readonly JobKind[] = ['document_processing', 'profile_extraction'];

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  ...INITIAL_WORKSPACE_DATA,

  navigate: (route, params) =>
    set((state) => ({ route, params: params ?? NO_PARAMS, visit: state.visit + 1 })),

  refreshIdentity: async () => {
    identityRequest += 1;
    const request = identityRequest;
    if (!get().identity) set({ identityStatus: 'loading', identityError: null });
    try {
      const identity = await unwrap(() => fundingBridge().identity.get());
      if (request !== identityRequest) return;
      get().applyIdentity(identity);
    } catch (error) {
      if (request !== identityRequest) return;
      // Without a confirmed identity the app cannot know which organization is
      // active, so none is shown until a read succeeds.
      set({ identity: null, identityStatus: 'error', identityError: toCallError(error) });
    }
  },

  applyIdentity: (identity) => {
    identityRequest += 1;
    const state = get();
    const next = activeOrganizationId(identity);
    const first = confirmedOrganizationId === undefined;
    const switched = !first && confirmedOrganizationId !== next;
    const recovered = state.identityStatus !== 'ready';
    const setUpHere = creatingForOnboarding && switched && next !== null;
    confirmedOrganizationId = next;
    if (switched || first) {
      // Answers still on their way belong to the previous organization.
      setupRequest += 1;
      jobsRequest += 1;
    }
    set({
      identity,
      identityStatus: 'ready',
      identityError: null,
      onboardingOrganizationId:
        setUpHere ||
        (state.onboardingOrganizationId !== null && state.onboardingOrganizationId === next)
          ? next
          : null,
      ...(switched ? { route: 'knowledge', params: NO_PARAMS, visit: state.visit + 1 } : {}),
      ...(switched || first
        ? {
            setup: null,
            setupStatus: next ? 'loading' : 'idle',
            setupError: null,
            jobs: [],
            screenState: {},
          }
        : {}),
    });
    if (next && (switched || first || recovered)) {
      void get().refreshSetup();
      void get().refreshJobs();
    }
  },

  refreshSetup: async () => {
    const organizationId = activeOrganizationId(get().identity);
    setupRequest += 1;
    const request = setupRequest;
    if (!organizationId) {
      set({ setup: null, setupStatus: 'idle', setupError: null });
      return;
    }
    if (!get().setup) set({ setupStatus: 'loading', setupError: null });
    try {
      const setup = await unwrap(() => fundingBridge().knowledge.setupStatus());
      if (request !== setupRequest) return;
      set({ setup, setupStatus: 'ready', setupError: null });
    } catch (error) {
      if (request !== setupRequest) return;
      set({ setup: null, setupStatus: 'error', setupError: toCallError(error) });
    }
  },

  refreshAssistant: async () => {
    assistantRequest += 1;
    const request = assistantRequest;
    try {
      const assistant = await unwrap(() => fundingBridge().identity.assistant());
      if (request === assistantRequest) set({ assistant });
    } catch {
      // Unknown is shown as unknown: no note is better than a wrong one.
      if (request === assistantRequest) set({ assistant: null });
    }
  },

  refreshJobs: async () => {
    const organizationId = activeOrganizationId(get().identity);
    jobsRequest += 1;
    const request = jobsRequest;
    if (!organizationId) return;
    try {
      const listed = await unwrap(() => fundingBridge().jobs.list());
      if (request !== jobsRequest) return;
      set((state) => {
        // A job that changed while the list was on its way is already newer here.
        const known = new Set(state.jobs.map((job) => job.id));
        const added = listed.filter(
          (job) => job.organizationId === organizationId && !known.has(job.id),
        );
        return added.length === 0
          ? state
          : { jobs: added.reduce<JobProgress[]>((jobs, job) => upsertJob(jobs, job), state.jobs) };
      });
    } catch {
      // Progress still arrives through events; the list only fills in the past.
    }
  },

  createOrganization: async (input, options) => {
    const before = new Set((get().identity?.organizations ?? []).map((o) => o.id));
    creatingForOnboarding = Boolean(options?.onboarding);
    try {
      let identity = await unwrap(() => fundingBridge().identity.createOrganization(input));
      const created = identity.organizations.find((organization) => !before.has(organization.id));
      if (!created) {
        get().applyIdentity(identity);
        throw new FundingCallError('INTERNAL', CALL_FAILED_MESSAGE);
      }
      if (identity.session.organizationId !== created.id) {
        const afterCreate = identity;
        try {
          identity = await unwrap(() => fundingBridge().identity.switchOrganization(created.id));
        } catch (error) {
          get().applyIdentity(afterCreate);
          throw toCallError(error);
        }
      }
      if (options?.onboarding) set({ onboardingOrganizationId: created.id });
      get().applyIdentity(identity);
    } finally {
      creatingForOnboarding = false;
    }
  },

  updateOrganization: async (organizationId, patch) => {
    get().applyIdentity(
      await unwrap(() => fundingBridge().identity.updateOrganization(organizationId, patch)),
    );
  },

  switchOrganization: async (organizationId) => {
    get().applyIdentity(
      await unwrap(() => fundingBridge().identity.switchOrganization(organizationId)),
    );
  },

  deleteOrganization: async (organizationId) => {
    get().applyIdentity(
      await unwrap(() => fundingBridge().identity.deleteOrganization(organizationId)),
    );
  },

  recordConsent: async (consent) => {
    get().applyIdentity(await unwrap(() => fundingBridge().identity.recordConsent(consent)));
  },

  finishOnboarding: () => set({ onboardingOrganizationId: null }),

  stopJob: async (jobId) => {
    await unwrap(() => fundingBridge().jobs.cancel(jobId));
  },

  setScreenState: (key, value) =>
    set((state) => ({ screenState: { ...state.screenState, [key]: value } })),
}));

/** For tests: puts the store and its bookkeeping back to how the app starts. */
export function resetWorkspaceStore(): void {
  identityRequest += 1;
  setupRequest += 1;
  jobsRequest += 1;
  assistantRequest += 1;
  confirmedOrganizationId = undefined;
  creatingForOnboarding = false;
  eventListeners.clear();
  useWorkspaceStore.setState(INITIAL_WORKSPACE_DATA);
}

// ──────────────────────────────────── events ──────────────────────────────────

function notify(event: FundingEvent): void {
  for (const listener of [...eventListeners]) {
    if (!listener.kinds.has(event.kind)) continue;
    try {
      listener.handler(event);
    } catch (error) {
      // One screen's handler must not stop the others from hearing the event.
      console.error('[workspace] event handler failed', error);
    }
  }
}

/**
 * Listens for funding events of the given kinds. Only events about the active
 * organization are delivered (and `identity_changed`, which is about none).
 * Returns the function that stops listening.
 */
export function subscribeToFundingEvents<K extends EventKind>(
  kinds: readonly K[],
  handler: (event: EventOf<K>) => void,
): () => void {
  const listener: FundingEventListener = {
    kinds: new Set<EventKind>(kinds),
    handler: handler as (event: FundingEvent) => void,
  };
  eventListeners.add(listener);
  return () => {
    eventListeners.delete(listener);
  };
}

/**
 * The single place funding events enter the renderer. It keeps the store up to
 * date first, then tells the screens that asked. Exported for tests.
 */
export function handleFundingEvent(event: FundingEvent): void {
  const store = useWorkspaceStore.getState();
  if (event.kind === 'identity_changed') {
    // Listeners hear about it once the store holds the new identity.
    void store.refreshIdentity().then(() => notify(event));
    return;
  }

  const active = activeOrganizationId(store.identity);
  const organizationId = event.kind === 'job' ? event.job.organizationId : event.organizationId;
  if (!active || organizationId !== active) return;

  if (event.kind === 'job') {
    useWorkspaceStore.setState((state) => ({ jobs: upsertJob(state.jobs, event.job) }));
    if (event.job.state !== 'running' && SETUP_JOB_KINDS.includes(event.job.kind)) {
      void store.refreshSetup();
    }
  } else if (event.kind === 'documents_changed' || event.kind === 'profile_changed') {
    void store.refreshSetup();
  }
  notify(event);
}

let connections = 0;
let disconnect: (() => void) | null = null;

/**
 * Starts the store: one subscription to main's funding events, and the first
 * read of identity and of the assistant. Safe to call more than once; the
 * subscription ends when every caller has released it.
 */
export function connectWorkspace(): () => void {
  connections += 1;
  if (connections === 1) {
    let stopEvents = () => {};
    try {
      stopEvents = fundingBridge().onEvent(handleFundingEvent);
    } catch {
      // No bridge: the identity read below reports it and offers a retry.
    }
    // Connecting or removing an assistant happens in Settings.
    const stopSettings = useBrowserStore.subscribe((state, previous) => {
      if (previous.showSettings && !state.showSettings) {
        void useWorkspaceStore.getState().refreshAssistant();
      }
    });
    disconnect = () => {
      stopEvents();
      stopSettings();
    };
    const store = useWorkspaceStore.getState();
    void store.refreshIdentity();
    void store.refreshAssistant();
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    connections -= 1;
    if (connections === 0) {
      disconnect?.();
      disconnect = null;
    }
  };
}

// ──────────────────────────────────── hooks ───────────────────────────────────

/** Mount once, at the top of the app, to keep the store connected to main. */
export function useWorkspaceConnection(): void {
  useEffect(() => connectWorkspace(), []);
}

/**
 * Runs `handler` when main reports one of the given kinds of change for the
 * active organization. The usual handler is a reload:
 *
 *   useFundingEvent(['saved_changed'], saved.reload);
 */
export function useFundingEvent<K extends EventKind>(
  kinds: readonly K[],
  handler: (event: EventOf<K>) => void,
): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  const key = [...kinds].sort().join('|');
  useEffect(() => {
    const wanted = key.split('|').filter(Boolean) as K[];
    return subscribeToFundingEvents(wanted, (event) => latest.current(event));
  }, [key]);
}

export function useActiveOrganization(): Organization | null {
  return useWorkspaceStore((state) => activeOrganization(state.identity));
}

/** Whether the session holds a permission in the active organization. */
export function useCan(permission: Permission): boolean {
  return useWorkspaceStore((state) => hasPermission(state.identity, permission));
}

/** The parameters the given route was opened with; empty when another route is showing. */
export function useRouteParams<R extends WorkspaceRoute>(route: R): WorkspaceParams[R] {
  return useWorkspaceStore((state) =>
    state.route === route
      ? (state.params as WorkspaceParams[R])
      : (NO_PARAMS as WorkspaceParams[R]),
  );
}

/** The running (or most recently finished) job of a kind for a subject, if any. */
export function useJob(kind: JobKind, subjectId = ''): JobProgress | undefined {
  return useWorkspaceStore((state) => findJob(state.jobs, kind, subjectId));
}

/**
 * Like useState, but the value outlives the screen: it is still there when the
 * user comes back from another route, and it is cleared when the active
 * organization changes. Use it for what would be tiresome to lose, such as
 * search filters and results. `key` should start with the screen's route, and
 * `initial` should be a constant so the value keeps its identity between renders.
 */
export function useScreenState<T>(key: string, initial: T): [T, (value: T) => void] {
  const stored = useWorkspaceStore((state) => state.screenState[key]);
  const setScreenState = useWorkspaceStore((state) => state.setScreenState);
  const setValue = useCallback((value: T) => setScreenState(key, value), [key, setScreenState]);
  return [stored === undefined ? initial : (stored as T), setValue];
}

// ─────────────────────────────── opening the workspace ─────────────────────────

/**
 * Explicitly opens funding tools in a blank tab. Ordinary blank tabs do not
 * display them. Inside an already open funding screen, use `navigate`.
 */
export async function openWorkspace<R extends WorkspaceRoute = 'knowledge'>(
  route?: R,
  params?: WorkspaceParams[R],
): Promise<void> {
  const store = useWorkspaceStore.getState();
  // Asking for a screen by name is a way of leaving the first-run steps, which
  // can be left at any point once the organization exists.
  if (store.onboardingOrganizationId) store.finishOnboarding();
  if (route === undefined) store.navigate('knowledge');
  else store.navigate(route, params);
  try {
    const tabs = await window.bullebrowser.tabs.list();
    const plan = planStartPageTab(tabs);
    let tabId: string;
    if (plan.kind === 'switch') {
      await window.bullebrowser.tabs.switch(plan.tabId);
      tabId = plan.tabId;
    } else if (plan.kind === 'create') {
      tabId = (await window.bullebrowser.tabs.create()).id;
    } else {
      tabId = tabs.find((tab) => tab.active)!.id;
    }
    useBrowserStore.getState().setWorkspaceTab(tabId);
  } catch {
    // Leave browsing untouched if the tab could not be opened.
  }
}
