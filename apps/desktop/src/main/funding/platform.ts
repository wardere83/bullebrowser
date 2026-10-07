// Puts the funding platform together for the running app: one set of stores,
// one job manager, one assistant and one list of official sources, joined to
// the renderer through the single door in rpc.ts.
//
// Everything here is made once and lives as long as the app. The window may be
// closed and opened again (macOS), so it is looked up each time it is needed.

import { app, type BrowserWindow, session } from 'electron';
import type { FundingEvent } from '../../shared/funding.js';
import { extractDocumentFile } from '../documents/host.js';
import { GuideStore } from '../guide/store.js';
import { reviewDraft } from '../guide/feedback.js';
import { buildGuide } from '../guide/guide.js';
import { listActivity, recordActivity } from '../identity/activity.js';
import { identityService } from '../identity/service.js';
import { KnowledgeHub } from '../knowledge/hub.js';
import { extractProfile } from '../knowledge/profile-extraction.js';
import { createHttpClient } from '../opportunities/http.js';
import { SavedOpportunityStore } from '../opportunities/saved-store.js';
import { OpportunityService } from '../opportunities/service.js';
import { caGrantsPortalAdapter } from '../opportunities/sources/ca-grants-portal.js';
import { euFundingTendersAdapter } from '../opportunities/sources/eu-funding-tenders.js';
import { grantsGovAdapter } from '../opportunities/sources/grants-gov.js';
import { laRampAdapter } from '../opportunities/sources/la-ramp.js';
import { montgomeryMdAdapter } from '../opportunities/sources/montgomery-md.js';
import { nycCityRecordAdapter } from '../opportunities/sources/nyc-city-record.js';
import { assessAlignment } from '../rfp/alignment.js';
import { analyzeRfp } from '../rfp/analysis.js';
import { RfpStore } from '../rfp/store.js';
import { conversationStore } from '../storage/conversations.js';
import { projectStore } from '../storage/projects.js';
import { getApiKey } from '../storage/secrets.js';
import { getSettings } from '../storage/settings.js';
import { type Assistant, createAssistant } from './assistant.js';
import type { ExtractFile } from './document-library.js';
import { answerFileDialogForTests, chooseDocuments } from './files.js';
import { createFundingHandlers } from './handlers.js';
import { JobManager } from './jobs.js';
import { removeOrganizationData } from './org-store.js';
import { registerFundingRpc, sendFundingEvent } from './rpc.js';
import type { GuideStoreApi, KnowledgeHubApi, RfpStoreApi } from './services.js';

export interface FundingPlatform {
  assistant: Assistant;
  jobs: JobManager;
  knowledge: KnowledgeHubApi;
  rfps: RfpStoreApi;
  guides: GuideStoreApi;
  opportunities: OpportunityService;
  saved: SavedOpportunityStore;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

let platform: FundingPlatform | null = null;
let currentWindow: () => BrowserWindow | null = () => null;
// Only the end-to-end suite sets these: to stand in for the network, and to
// hold the date still so recorded listings keep the status they had that day.
let sourceFetchStandIn: FetchLike | null = null;
let clockStandIn: number | null = null;
const listingClock = (): number => clockStandIn ?? Date.now();

const testHooksOn = (): boolean => !app.isPackaged && process.env.BULLEBROWSER_TEST_HOOKS === '1';

/**
 * Requests to official sources go through a session of their own, kept in
 * memory: they use the system's network settings, and they never carry the
 * cookies or sign-ins of the sites the user browses.
 */
const sourceFetch: FetchLike = (input, init) => {
  if (sourceFetchStandIn) return sourceFetchStandIn(input, init);
  return session.fromPartition('funding-sources').fetch(input, init);
};

function build(): FundingPlatform {
  const emit = (event: FundingEvent) => sendFundingEvent(currentWindow(), event);
  const extract: ExtractFile = (filePath, fileName, options) => extractDocumentFile(filePath, fileName, options);

  const assistant = createAssistant({
    selectedModel: () => getSettings().defaultModel,
    apiKey: (provider) => getApiKey(provider),
    baseUrl: () => (testHooksOn() ? process.env.BULLEBROWSER_ASSISTANT_URL || undefined : undefined),
  });
  const jobs = new JobManager(emit);
  const knowledge = new KnowledgeHub({ extract, emit });
  const rfps = new RfpStore({ extract, emit });
  const guides = new GuideStore();
  const opportunities = new OpportunityService({
    adapters: [
      grantsGovAdapter,
      caGrantsPortalAdapter,
      nycCityRecordAdapter,
      laRampAdapter,
      montgomeryMdAdapter,
      euFundingTendersAdapter,
    ],
    http: createHttpClient(sourceFetch),
    now: listingClock,
  });
  const saved = new SavedOpportunityStore((opportunity) => opportunities.timeZoneFor(opportunity), listingClock);

  const forgetOrganization = async (organizationId: string): Promise<void> => {
    conversationStore.deleteForOrganization(organizationId);
    projectStore.deleteForOrganization(organizationId);
    // A document that was being read when the organization was deleted may
    // still write its result. Once reading has settled, clear the directory
    // again so nothing of a deleted organization is left on the device.
    void Promise.allSettled([knowledge.whenIdle(organizationId), rfps.whenIdle(organizationId)])
      .then(() => removeOrganizationData(organizationId))
      .catch((error: unknown) => console.error('[funding] could not finish removing an organization', error));
  };

  const handlers = createFundingHandlers({
    identity: identityService,
    assistant,
    jobs,
    knowledge,
    rfps,
    guides,
    opportunities,
    saved,
    pipelines: { extractProfile, analyzeRfp, assessAlignment, buildGuide, reviewDraft },
    chooseFiles: chooseDocuments,
    activity: { record: recordActivity, list: listActivity },
    emit,
    forgetOrganization,
    now: () => Date.now(),
  });

  registerFundingRpc({ getWindow: () => currentWindow(), handlers, identity: identityService });
  identityService.onChange(() => emit({ kind: 'identity_changed' }));

  if (testHooksOn()) {
    const hooks = ((globalThis as Record<string, unknown>).__bbTest ??= {}) as Record<string, unknown>;
    hooks.funding = {
      answerFileDialog: answerFileDialogForTests,
      setSourceFetch: (stand: FetchLike | null) => {
        sourceFetchStandIn = stand;
      },
      setListingClock: (time: number | null) => {
        clockStandIn = time;
      },
      whenIdle: async () => {
        const state = await identityService.getState();
        await Promise.all(
          state.organizations.flatMap((organization) => [
            knowledge.whenIdle(organization.id),
            rfps.whenIdle(organization.id),
          ]),
        );
      },
    };
  }

  return { assistant, jobs, knowledge, rfps, guides, opportunities, saved };
}

/**
 * Starts the platform, or points the running one at a new window. Call it each
 * time a window is created.
 */
export function startFundingPlatform(getWindow: () => BrowserWindow | null): FundingPlatform {
  currentWindow = getWindow;
  platform ??= build();
  return platform;
}

/** The running platform, for the parts of the app that ground chat in it. */
export function fundingPlatform(): FundingPlatform | null {
  return platform;
}
