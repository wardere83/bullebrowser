// What each funding call does once the door (rpc.ts) has let it through.
//
// By the time a handler runs, the caller is the app's own window, the method is
// one the shared table lists, and the user's role in the active organization
// allows it. A handler's work is to check what was sent, ask before anything
// leaves the device, hand the work to a store or a pipeline, and note it in
// the organization's activity record. The organization is always the one in
// the context; no handler takes one from its arguments except the two that
// manage organizations, which the door authorizes against the id they name.

import { randomUUID } from 'node:crypto';
import {
  KNOWLEDGE_CATEGORY_LABELS,
  PROFILE_FIELDS,
  ROLE_PERMISSIONS,
  type GeoLevel,
  type JobKind,
  type KnowledgeCategory,
  type NewClaimInput,
  type NewOrganizationInput,
  type OrgActivity,
  type OrgConsents,
  type Organization,
  type Permission,
  type ProfileFieldId,
} from '../../shared/funding.js';
import type { IdentityService } from '../identity/service.js';
import { listPortals } from '../opportunities/portals.js';
import { readOpportunity } from '../opportunities/read-opportunity.js';
import { assertOpportunityId, type SavedOpportunityStore } from '../opportunities/saved-store.js';
import type { OpportunityService } from '../opportunities/service.js';
import type { Assistant } from './assistant.js';
import { FundingError, consentRequired, isCancellation, toPublicError } from './errors.js';
import type { ChooseFiles } from './files.js';
import type { JobContext, JobManager } from './jobs.js';
import { assertUuid } from './org-store.js';
import type { Complete } from './pipeline.js';
import { organizationOf, type CallContext, type FundingHandlers } from './rpc.js';
import type {
  Actor,
  AnalyzeRfp,
  AssessAlignment,
  BuildGuide,
  ExtractProfile,
  GuideStoreApi,
  KnowledgeHubApi,
  PassageSearch,
  ReviewDraft,
  RfpStoreApi,
} from './services.js';

export interface HandlerParts {
  identity: IdentityService;
  assistant: Assistant;
  jobs: JobManager;
  knowledge: KnowledgeHubApi;
  rfps: RfpStoreApi;
  guides: GuideStoreApi;
  opportunities: OpportunityService;
  saved: SavedOpportunityStore;
  pipelines: {
    extractProfile: ExtractProfile;
    analyzeRfp: AnalyzeRfp;
    assessAlignment: AssessAlignment;
    buildGuide: BuildGuide;
    reviewDraft: ReviewDraft;
  };
  chooseFiles: ChooseFiles;
  activity: {
    record(organizationId: string, actorId: string, action: OrgActivity['action'], detail: string): Promise<void>;
    list(organizationId: string, limit?: number): Promise<OrgActivity[]>;
  };
  /** Tells the renderer that an organization's saved listings or guides changed. */
  emit(event: { kind: 'saved_changed' | 'guides_changed'; organizationId: string }): void;
  /** Removes what other parts of the app keep for an organization that is being deleted. */
  forgetOrganization(organizationId: string): Promise<void>;
  now(): number;
}

const MAX_DRAFT_CHARS = 20_000;
const MAX_QUERY_CHARS = 500;
const MAX_CLAIM_IDS = 200;
const MAX_FEEDBACK_KEPT = 40;
const RECHECKS_AT_ONCE = 4;

const invalid = (message: string) => new FundingError('INVALID_INPUT', message);

function text(value: unknown, max: number, what: string): string {
  if (typeof value !== 'string') throw invalid(`${what} is not valid.`);
  if (value.length > max) throw invalid(`${what} is too long.`);
  return value;
}

function ids(value: unknown, what: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CLAIM_IDS) {
    throw invalid(`Choose at least one ${what}.`);
  }
  return [...new Set(value.map((id) => assertUuid(id, what)))];
}

function category(value: unknown): KnowledgeCategory | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !Object.hasOwn(KNOWLEDGE_CATEGORY_LABELS, value)) {
    throw invalid('That document category is not one the app uses.');
  }
  return value as KnowledgeCategory;
}

function field(value: unknown): ProfileFieldId {
  if (typeof value !== 'string' || !(PROFILE_FIELDS as readonly string[]).includes(value)) {
    throw invalid('That part of the profile is not one the app uses.');
  }
  return value as ProfileFieldId;
}

function consentKind(value: unknown): keyof OrgConsents {
  if (value !== 'documentAnalysisAt' && value !== 'liveFundingSearchAt') {
    throw invalid('That acknowledgement is not one the app records.');
  }
  return value;
}

function permission(value: unknown): Permission {
  if (typeof value !== 'string' || !(ROLE_PERMISSIONS.owner as readonly string[]).includes(value)) {
    throw invalid('That permission is not one the app uses.');
  }
  return value as Permission;
}

/** File names for the activity record: a few names, then a count. */
function names(items: { name: string }[]): string {
  const shown = items.slice(0, 3).map((item) => item.name);
  const rest = items.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.join(', ');
}

async function inTurns<T>(items: T[], atOnce: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(atOnce, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      if (item !== undefined) await work(item);
    }
  });
  await Promise.all(lanes);
}

export function createFundingHandlers(parts: HandlerParts): FundingHandlers {
  const { identity, assistant, jobs, knowledge, rfps, guides, opportunities, saved, pipelines, activity } = parts;

  const actorOf = async (context: CallContext, organization: Organization): Promise<Actor> => ({
    userId: context.session.userId,
    canApprove: await identity.can('profile.approve', organization.id),
  });

  /**
   * The assistant for work on an organization's documents: null when none is
   * connected (the local method then runs), and a refusal when one is
   * connected but nobody has agreed to excerpts being sent to it.
   */
  const assistantFor = (organization: Organization): Complete | null => {
    if (!assistant.connected()) return null;
    if (!organization.consents.documentAnalysisAt) throw consentRequired('documentAnalysisAt');
    return assistant.complete;
  };

  const requireSourceConsent = (organization: Organization): void => {
    if (!organization.consents.liveFundingSearchAt) throw consentRequired('liveFundingSearchAt');
  };

  const searchIn =
    (organizationId: string): PassageSearch =>
    (query, limit) =>
      knowledge.search(organizationId, query, limit);

  const note = (context: CallContext, organization: Organization, action: OrgActivity['action'], detail: string) =>
    activity.record(organization.id, context.session.userId, action, detail);

  const startJob = (
    organization: Organization,
    kind: JobKind,
    subjectId: string,
    message: string,
    run: (job: JobContext) => Promise<void>,
  ): { jobId: string } => {
    const { jobId } = jobs.start({ kind, organizationId: organization.id, subjectId, message }, run);
    return { jobId };
  };

  // One search at a time for an organization: a new one replaces the one still running.
  const searches = new Map<string, AbortController>();
  const beginSearch = (organizationId: string): AbortSignal => {
    searches.get(organizationId)?.abort();
    const controller = new AbortController();
    searches.set(organizationId, controller);
    return controller.signal;
  };

  /** The analysis of a funding document, made now if there is none yet. */
  const analysisFor = async (
    organization: Organization,
    rfpId: string,
    complete: Complete | null,
    job: JobContext,
  ) => {
    const existing = await rfps.analysis(organization.id, rfpId);
    if (existing) return existing;
    job.progress('Reading the funding document first', 5);
    const document = await rfps.source(organization.id, rfpId);
    const analysis = await pipelines.analyzeRfp({
      organizationId: organization.id,
      document,
      complete,
      signal: job.signal,
      progress: (message, percent) => job.progress(message, percent === null || percent === undefined ? null : percent / 2),
      now: parts.now(),
    });
    await rfps.saveAnalysis(organization.id, analysis);
    return analysis;
  };

  return {
    identity: {
      get: () => identity.getState(),
      updateProfile: (_context, patch) => identity.updateProfile(patch ?? {}),
      createOrganization: (_context, input: NewOrganizationInput) => identity.createOrganization(input),
      updateOrganization: (_context, organizationId, patch) => identity.updateOrganization(organizationId, patch ?? {}),
      switchOrganization: (_context, organizationId) => identity.switchOrganization(assertUuid(organizationId, 'organization')),
      deleteOrganization: async (_context, organizationId) => {
        const id = assertUuid(organizationId, 'organization');
        // Stop its work first, so nothing is written for an organization that is gone.
        jobs.cancelAll(id);
        searches.get(id)?.abort();
        searches.delete(id);
        const state = await identity.deleteOrganization(id);
        knowledge.forget(id);
        await parts.forgetOrganization(id);
        return state;
      },
      recordConsent: (context, consent) => identity.recordConsent(organizationOf(context).id, consentKind(consent)),
      can: (_context, wanted) => identity.can(permission(wanted)),
      activity: (context, limit) => activity.list(organizationOf(context).id, typeof limit === 'number' ? limit : undefined),
      assistant: () => assistant.availability(),
    },

    knowledge: {
      listDocuments: (context) => knowledge.listDocuments(organizationOf(context).id),
      addDocuments: async (context, chosenCategory) => {
        const organization = organizationOf(context);
        const wanted = category(chosenCategory);
        const paths = await parts.chooseFiles(context.window, { title: 'Upload documents', multiple: true });
        if (paths.length === 0) return [];
        const before = new Set((await knowledge.listDocuments(organization.id)).map((document) => document.id));
        try {
          return await knowledge.addDocuments(organization.id, {
            paths,
            ...(wanted ? { category: wanted } : {}),
            userId: context.session.userId,
          });
        } finally {
          // Some files may have been added even when others were refused.
          const added = (await knowledge.listDocuments(organization.id).catch(() => [])).filter(
            (document) => !before.has(document.id),
          );
          if (added.length > 0) await note(context, organization, 'document_added', names(added));
        }
      },
      replaceDocument: async (context, documentId) => {
        const organization = organizationOf(context);
        const id = assertUuid(documentId, 'document');
        const [path] = await parts.chooseFiles(context.window, { title: 'Choose the new version', multiple: false });
        if (!path) return null;
        const document = await knowledge.replaceDocument(organization.id, id, path);
        await note(context, organization, 'document_replaced', document.name);
        return document;
      },
      setCategory: (context, documentId, chosenCategory) => {
        const wanted = category(chosenCategory);
        if (!wanted) throw invalid('Choose a category.');
        return knowledge.setCategory(organizationOf(context).id, assertUuid(documentId, 'document'), wanted);
      },
      retryDocument: (context, documentId) =>
        knowledge.retryDocument(organizationOf(context).id, assertUuid(documentId, 'document')),
      deleteDocument: async (context, documentId) => {
        const organization = organizationOf(context);
        const id = assertUuid(documentId, 'document');
        const document = (await knowledge.listDocuments(organization.id)).find((item) => item.id === id);
        await knowledge.deleteDocument(organization.id, id);
        await note(context, organization, 'document_deleted', document?.name ?? 'A document');
        return null;
      },
      search: (context, query, limit) =>
        knowledge.search(
          organizationOf(context).id,
          text(query, MAX_QUERY_CHARS, 'That search'),
          typeof limit === 'number' ? limit : undefined,
        ),
      setupStatus: (context) => knowledge.setupStatus(organizationOf(context)),
      getProfile: (context) => knowledge.getProfile(organizationOf(context).id),
      extractProfile: async (context) => {
        const organization = organizationOf(context);
        const documents = await knowledge.sourceDocuments(organization.id);
        if (documents.length === 0) {
          throw invalid('Upload at least one document and wait for it to be read first.');
        }
        const complete = assistantFor(organization);
        const profile = await knowledge.getProfile(organization.id);
        const approved = profile.claims
          .filter((claim) => claim.status === 'approved')
          .map(({ id, field: claimField, text: claimText }) => ({ id, field: claimField, text: claimText }));
        return startJob(organization, 'profile_extraction', '', 'Reading your documents', async (job) => {
          await knowledge.beginExtraction(organization.id);
          try {
            const outcome = await pipelines.extractProfile({
              organization: { name: organization.name, kind: organization.kind },
              documents,
              approved,
              complete,
              search: searchIn(organization.id),
              signal: job.signal,
              progress: job.progress,
            });
            if (job.signal.aborted) throw new FundingError('CANCELLED', 'Cancelled.');
            await knowledge.applyExtraction(organization.id, outcome);
            const count = outcome.claims.length;
            await note(
              context,
              organization,
              'profile_extracted',
              `${count} ${count === 1 ? 'statement' : 'statements'} proposed for review`,
            );
          } catch (error) {
            const stopped = job.signal.aborted || isCancellation(error);
            await knowledge.endExtraction(organization.id, stopped ? '' : toPublicError(error).message);
            throw error;
          }
        });
      },
      suggestPassages: (context, wanted) => knowledge.suggestPassages(organizationOf(context).id, field(wanted)),
      approveClaims: async (context, claimIds) => {
        const organization = organizationOf(context);
        const chosen = ids(claimIds, 'statement');
        const profile = await knowledge.approveClaims(organization.id, chosen, await actorOf(context, organization));
        await note(context, organization, 'claims_approved', `${chosen.length} approved`);
        return profile;
      },
      rejectClaims: async (context, claimIds) => {
        const organization = organizationOf(context);
        const chosen = ids(claimIds, 'statement');
        const profile = await knowledge.rejectClaims(organization.id, chosen, await actorOf(context, organization));
        await note(context, organization, 'claims_rejected', `${chosen.length} rejected`);
        return profile;
      },
      addClaim: async (context, input: NewClaimInput) => {
        const organization = organizationOf(context);
        if (typeof input !== 'object' || input === null || !Array.isArray(input.evidence)) {
          throw invalid('That statement is not valid.');
        }
        const claim: NewClaimInput = {
          field: field(input.field),
          text: text(input.text, 2_000, 'That statement'),
          evidence: input.evidence.slice(0, 10).map((item) => ({
            documentId: assertUuid(item?.documentId, 'document'),
            blockId: text(item?.blockId, 20, 'That passage'),
            quote: text(item?.quote, 4_000, 'That passage'),
          })),
        };
        const profile = await knowledge.addClaim(organization.id, claim, await actorOf(context, organization));
        await note(context, organization, 'claim_added', claim.field);
        return profile;
      },
      updateClaim: async (context, claimId, newText) => {
        const organization = organizationOf(context);
        const profile = await knowledge.updateClaim(
          organization.id,
          assertUuid(claimId, 'statement'),
          text(newText, 2_000, 'That statement'),
          await actorOf(context, organization),
        );
        await note(context, organization, 'claim_edited', '1 statement');
        return profile;
      },
      deleteClaim: async (context, claimId) => {
        const organization = organizationOf(context);
        const profile = await knowledge.deleteClaim(
          organization.id,
          assertUuid(claimId, 'statement'),
          await actorOf(context, organization),
        );
        await note(context, organization, 'claim_deleted', '1 statement');
        return profile;
      },
      resolveConflict: async (context, conflictId, keepClaimIds) => {
        const organization = organizationOf(context);
        const profile = await knowledge.resolveConflict(
          organization.id,
          assertUuid(conflictId, 'conflict'),
          ids(keepClaimIds, 'statement to keep'),
          await actorOf(context, organization),
        );
        await note(context, organization, 'conflict_resolved', '1 conflict');
        return profile;
      },
    },

    opportunities: {
      sources: () => opportunities.sources(),
      portals: (_context, filter) =>
        listPortals({
          ...(typeof filter?.level === 'string' ? { level: filter.level as GeoLevel } : {}),
          ...(typeof filter?.country === 'string' ? { country: filter.country.slice(0, 2) } : {}),
          ...(typeof filter?.region === 'string' ? { region: filter.region.slice(0, 80) } : {}),
        }),
      suggestFilters: (context) => knowledge.suggestFilters(organizationOf(context)),
      search: async (context, filters) => {
        const organization = organizationOf(context);
        requireSourceConsent(organization);
        const signal = beginSearch(organization.id);
        return opportunities.search({
          filters,
          organization: organization.location,
          profileTerms: await knowledge.profileTerms(organization.id),
          signal,
        });
      },
      detail: (context, opportunityId) => {
        requireSourceConsent(organizationOf(context));
        return opportunities.detail(assertOpportunityId(opportunityId), new AbortController().signal);
      },
      listSaved: (context) => saved.list(organizationOf(context).id),
      save: async (context, opportunity) => {
        const organization = organizationOf(context);
        requireSourceConsent(organization);
        // What is kept is the source's own copy, read now. If the source cannot
        // be read, the listing is kept as it was shown but never as active.
        const fresh = await opportunities.recheck(readOpportunity(opportunity), new AbortController().signal);
        const list = await saved.save(organization.id, fresh);
        await note(context, organization, 'opportunity_saved', fresh.title.slice(0, 120));
        parts.emit({ kind: 'saved_changed', organizationId: organization.id });
        return list;
      },
      unsave: async (context, opportunityId) => {
        const organization = organizationOf(context);
        const id = assertOpportunityId(opportunityId);
        const existing = await saved.get(organization.id, id);
        const list = await saved.unsave(organization.id, id);
        if (existing) await note(context, organization, 'opportunity_removed', existing.opportunity.title.slice(0, 120));
        parts.emit({ kind: 'saved_changed', organizationId: organization.id });
        return list;
      },
      setNote: async (context, opportunityId, newNote) => {
        const organization = organizationOf(context);
        const list = await saved.setNote(organization.id, assertOpportunityId(opportunityId), text(newNote, 4_000, 'That note'));
        parts.emit({ kind: 'saved_changed', organizationId: organization.id });
        return list;
      },
      recheckSaved: async (context) => {
        const organization = organizationOf(context);
        requireSourceConsent(organization);
        const signal = new AbortController().signal;
        const current = await saved.list(organization.id);
        await inTurns(current, RECHECKS_AT_ONCE, async (entry) => {
          await saved.replace(organization.id, await opportunities.recheck(entry.opportunity, signal));
        });
        parts.emit({ kind: 'saved_changed', organizationId: organization.id });
        return saved.list(organization.id);
      },
    },

    rfps: {
      list: (context) => rfps.list(organizationOf(context).id),
      add: async (context) => {
        const organization = organizationOf(context);
        const paths = await parts.chooseFiles(context.window, { title: 'Upload a funding document', multiple: true });
        if (paths.length === 0) return [];
        const before = new Set((await rfps.list(organization.id)).map((document) => document.id));
        try {
          return await rfps.addFiles(organization.id, { paths, userId: context.session.userId });
        } finally {
          const added = (await rfps.list(organization.id).catch(() => [])).filter((document) => !before.has(document.id));
          if (added.length > 0) await note(context, organization, 'rfp_added', names(added));
        }
      },
      addFromOpportunity: async (context, opportunityId) => {
        const organization = organizationOf(context);
        requireSourceConsent(organization);
        const detail = await opportunities.detail(assertOpportunityId(opportunityId), new AbortController().signal);
        const document = await rfps.addListing(organization.id, { detail, userId: context.session.userId });
        await note(context, organization, 'rfp_added', document.name);
        return document;
      },
      remove: async (context, rfpId) => {
        const organization = organizationOf(context);
        const id = assertUuid(rfpId, 'funding document');
        const document = await rfps.get(organization.id, id);
        if (!document) throw new FundingError('NOT_FOUND', 'That funding document is no longer here.');
        jobs.cancelSubject(organization.id, id);
        await guides.removeForRfp(organization.id, id);
        await rfps.remove(organization.id, id);
        await note(context, organization, 'rfp_deleted', document.name);
        parts.emit({ kind: 'guides_changed', organizationId: organization.id });
        return null;
      },
      analysis: (context, rfpId) => rfps.analysis(organizationOf(context).id, assertUuid(rfpId, 'funding document')),
      analyze: async (context, rfpId) => {
        const organization = organizationOf(context);
        const id = assertUuid(rfpId, 'funding document');
        const document = await rfps.source(organization.id, id);
        const complete = assistantFor(organization);
        return startJob(organization, 'rfp_analysis', id, 'Reading the funding document', async (job) => {
          const previous = await rfps.analysis(organization.id, id);
          await rfps.setAnalysisStatus(organization.id, id, { state: 'running', updatedAt: parts.now(), error: '' });
          try {
            const analysis = await pipelines.analyzeRfp({
              organizationId: organization.id,
              document,
              complete,
              signal: job.signal,
              progress: job.progress,
              now: parts.now(),
            });
            if (job.signal.aborted) throw new FundingError('CANCELLED', 'Cancelled.');
            await rfps.saveAnalysis(organization.id, analysis);
            await note(context, organization, 'rfp_analyzed', document.name);
          } catch (error) {
            const stopped = job.signal.aborted || isCancellation(error);
            // A stopped run leaves things as they were; a failed one says why.
            await rfps
              .setAnalysisStatus(
                organization.id,
                id,
                stopped
                  ? { state: previous ? 'ready' : 'none', updatedAt: previous?.createdAt ?? null, error: '' }
                  : { state: 'failed', updatedAt: parts.now(), error: toPublicError(error).message },
              )
              .catch(() => {});
            throw error;
          }
        });
      },
      alignment: (context, rfpId) => rfps.alignment(organizationOf(context).id, assertUuid(rfpId, 'funding document')),
      assessAlignment: async (context, rfpId) => {
        const organization = organizationOf(context);
        const id = assertUuid(rfpId, 'funding document');
        const document = await rfps.source(organization.id, id);
        const baseline = await knowledge.baseline(organization);
        if (baseline.claims.length === 0) {
          throw invalid(
            'Approve at least one statement in your organization profile first. Alignment compares what a funder asks for with what you have confirmed.',
          );
        }
        const complete = assistantFor(organization);
        return startJob(organization, 'alignment', id, 'Comparing the funding document with your profile', async (job) => {
          const previous = await rfps.alignment(organization.id, id);
          await rfps.setAlignmentStatus(organization.id, id, { state: 'running', updatedAt: parts.now(), error: '' });
          try {
            const analysis = await analysisFor(organization, id, complete, job);
            const report = await pipelines.assessAlignment({
              organizationId: organization.id,
              rfp: document,
              analysis,
              baseline,
              knowledge: await knowledge.sourceDocuments(organization.id),
              search: searchIn(organization.id),
              complete,
              signal: job.signal,
              progress: job.progress,
              now: parts.now(),
            });
            if (job.signal.aborted) throw new FundingError('CANCELLED', 'Cancelled.');
            await rfps.saveAlignment(organization.id, report);
            await note(context, organization, 'alignment_assessed', document.name);
          } catch (error) {
            const stopped = job.signal.aborted || isCancellation(error);
            await rfps
              .setAlignmentStatus(
                organization.id,
                id,
                stopped
                  ? { state: previous ? 'ready' : 'none', updatedAt: previous?.createdAt ?? null, error: '' }
                  : { state: 'failed', updatedAt: parts.now(), error: toPublicError(error).message },
              )
              .catch(() => {});
            throw error;
          }
        });
      },
    },

    guides: {
      list: (context) => guides.list(organizationOf(context).id),
      get: (context, guideId) => guides.get(organizationOf(context).id, assertUuid(guideId, 'guide')),
      start: async (context, rfpId) => {
        const organization = organizationOf(context);
        const forRfp = rfpId === '' || rfpId === undefined || rfpId === null ? '' : assertUuid(rfpId, 'funding document');
        // Checked now, so a document that cannot be used is refused before the work starts.
        if (forRfp) await rfps.source(organization.id, forRfp);
        const complete = assistantFor(organization);
        const guideId = randomUUID();
        // The job is filed under the funding document, which is what the screen
        // knows before the guide exists; a general guide has no subject.
        return startJob(organization, 'guide', forRfp, 'Preparing your guide', async (job) => {
          const rfp = forRfp ? await rfps.source(organization.id, forRfp) : null;
          const analysis = forRfp ? await analysisFor(organization, forRfp, complete, job) : null;
          const guide = await pipelines.buildGuide({
            id: guideId,
            organizationId: organization.id,
            rfp,
            analysis,
            baseline: await knowledge.baseline(organization),
            knowledge: await knowledge.sourceDocuments(organization.id),
            search: searchIn(organization.id),
            complete,
            signal: job.signal,
            progress: job.progress,
            now: parts.now(),
          });
          if (job.signal.aborted) throw new FundingError('CANCELLED', 'Cancelled.');
          await guides.save(organization.id, guide);
          await note(context, organization, 'guide_started', guide.title.slice(0, 120));
          parts.emit({ kind: 'guides_changed', organizationId: organization.id });
        });
      },
      requestFeedback: async (context, guideId, sectionId, draft) => {
        const organization = organizationOf(context);
        const id = assertUuid(guideId, 'guide');
        const guide = await guides.get(organization.id, id);
        if (!guide) throw new FundingError('NOT_FOUND', 'That guide is no longer here.');
        const section = text(sectionId, 100, 'That section');
        const words = text(draft, MAX_DRAFT_CHARS, 'That draft');
        if (!words.trim()) throw invalid('Write or paste your own draft of this section first.');
        const complete = assistantFor(organization);
        if (!complete) {
          throw new FundingError(
            'NO_ASSISTANT',
            'Feedback on a draft needs a connected assistant. Add a key in Settings to turn it on.',
          );
        }
        return startJob(organization, 'guide_feedback', id, 'Reading your draft', async (job) => {
          // The funding document may have been removed since the guide was made.
          const rfp = guide.rfpId ? await rfps.source(organization.id, guide.rfpId).catch(() => null) : null;
          const feedback = await pipelines.reviewDraft({
            id: randomUUID(),
            guide,
            sectionId: section,
            draft: words,
            rfp,
            baseline: await knowledge.baseline(organization),
            knowledge: await knowledge.sourceDocuments(organization.id),
            search: searchIn(organization.id),
            complete,
            signal: job.signal,
            progress: job.progress,
            now: parts.now(),
          });
          if (job.signal.aborted) throw new FundingError('CANCELLED', 'Cancelled.');
          const latest = await guides.get(organization.id, id);
          if (!latest) return;
          await guides.save(organization.id, {
            ...latest,
            feedback: [feedback, ...latest.feedback].slice(0, MAX_FEEDBACK_KEPT),
            updatedAt: parts.now(),
          });
          parts.emit({ kind: 'guides_changed', organizationId: organization.id });
        });
      },
      remove: async (context, guideId) => {
        const organization = organizationOf(context);
        const id = assertUuid(guideId, 'guide');
        jobs.cancelSubject(organization.id, id);
        await guides.remove(organization.id, id);
        parts.emit({ kind: 'guides_changed', organizationId: organization.id });
        return null;
      },
    },

    jobs: {
      list: (context) => (context.organization ? jobs.list(context.organization.id) : []),
      cancel: (context, jobId) => {
        if (context.organization && typeof jobId === 'string') jobs.cancel(jobId, context.organization.id);
        return null;
      },
    },
  };
}
