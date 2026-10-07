// One organization's profile on disk, and every way it may change.
//
//   <organization>/knowledge/profile.json
//
// A profile is a list of statements, each in one of four states (see
// ClaimStatus in the contract). The rules that matter are all here:
//  - Only a person turns a proposal into an approved statement, and only a
//    person who may approve.
//  - A reading of the documents adds proposals. It never changes a statement
//    that is approved, awaiting review, rejected or written by a person, and it
//    never offers again what was rejected.
//  - Documents that disagree are recorded as a conflict for a person to
//    settle. The app never picks a side.
//
// Each change reads the file, applies itself and writes the file as one step,
// one organization at a time, so two changes can never overwrite each other. A
// change that is refused part-way leaves the file exactly as it was.

import { randomUUID } from 'node:crypto';
import { applyTerminology } from '@bullebrowser/agent-core';
import {
  PROFILE_FIELDS,
  type Citation,
  type ClaimOrigin,
  type ClaimStatus,
  type NewClaimInput,
  type OrganizationProfile,
  type ProfileClaim,
  type ProfileConflict,
  type ProfileExtractionState,
  type ProfileFieldId,
  type ProfileGap,
  type ReviewReason,
} from '../../shared/funding.js';
import { FundingError } from '../funding/errors.js';
import { assertUuid, orgPath, readJson, writeJson } from '../funding/org-store.js';
import type { Actor, ExtractionOutcome } from '../funding/services.js';
import { isUntouchedFinding, readCitation, settleCitations, type SourceChange } from './claim-evidence.js';

export interface ProfileStoreOptions {
  now?: () => number;
  /** Called after an organization's profile has changed on disk. */
  onChange?: (organizationId: string) => void;
}

/**
 * Turns the passages a person picked into citations, or refuses them. It is
 * called inside the change, so it sees the documents as they are at that moment.
 */
export type CiteEvidence = (evidence: NewClaimInput['evidence']) => Promise<Citation[]>;

/** A statement is 1 to this many characters once it is trimmed. */
export const MAX_STATEMENT_CHARS = 2_000;
const MAX_CLAIMS = 500;
const MAX_EVIDENCE = 20;
const MAX_IDS = 500;
const MAX_NOTE_CHARS = 500;
const TOO_LONG = 'A statement can be up to 2,000 characters. Shorten it and try again.';
const GAP_NOTE = 'The documents read so far do not cover this.';
const CONFLICT_SUMMARY = 'Your documents disagree about this.';

// Written as records so that a value added to the contract and not listed here
// fails the type check.
const STATUSES: Record<ClaimStatus, true> = { proposed: true, approved: true, needs_review: true, rejected: true };
const ORIGINS: Record<ClaimOrigin, true> = { extracted: true, verbatim: true, user: true };
const REASONS: Record<ReviewReason, true> = {
  source_deleted: true,
  source_replaced: true,
  evidence_missing: true,
  conflict: true,
};
const EXTRACTION_STATES: Record<ProfileExtractionState['status'], true> = {
  idle: true,
  running: true,
  failed: true,
  unavailable: true,
};

// Controls, broken halves of a character and the invisible direction overrides
// used to disguise text. None belongs in a statement.
const UNSAFE_RE = /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}‪-‮⁦-⁩]/gu;

type Fields = Record<string, unknown>;

const invalid = (message: string) => new FundingError('INVALID_INPUT', message);
const forbidden = (what: string) =>
  new FundingError('FORBIDDEN', `You cannot ${what} in this organization. Ask an owner or an admin.`);

const asRecord = (value: unknown): Fields | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Fields) : null;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const textOrNull = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const timeOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const isOneOf = <K extends string>(known: Record<K, true>, value: unknown): value is K =>
  typeof value === 'string' && Object.hasOwn(known, value);
/** True for one of the nine parts of a profile. */
export const isProfileField = (value: unknown): value is ProfileFieldId =>
  typeof value === 'string' && (PROFILE_FIELDS as readonly string[]).includes(value);

// ─────────────────────────────── reading the file ──────────────────────────────

export function emptyProfile(organizationId: string): OrganizationProfile {
  return {
    schemaVersion: 1,
    organizationId,
    claims: [],
    conflicts: [],
    gaps: [],
    extraction: { status: 'idle', lastRunAt: null, method: null, error: '' },
    approvedAt: null,
    approvedBy: null,
    updatedAt: 0,
  };
}

function readClaim(value: unknown): ProfileClaim | null {
  const raw = asRecord(value);
  if (!raw || !textOrNull(raw.id) || !isProfileField(raw.field) || !text(raw.text).trim()) return null;
  if (!isOneOf(STATUSES, raw.status) || !isOneOf(ORIGINS, raw.origin)) return null;
  return {
    id: text(raw.id),
    field: raw.field,
    text: text(raw.text),
    origin: raw.origin,
    status: raw.status,
    citations: list(raw.citations).flatMap((citation) => readCitation(citation) ?? []),
    reviewReason: isOneOf(REASONS, raw.reviewReason) ? raw.reviewReason : null,
    reviewNote: text(raw.reviewNote),
    supersedesClaimId: textOrNull(raw.supersedesClaimId),
    edited: raw.edited === true,
    createdAt: timeOrNull(raw.createdAt) ?? 0,
    updatedAt: timeOrNull(raw.updatedAt) ?? 0,
    approvedAt: timeOrNull(raw.approvedAt),
    approvedBy: textOrNull(raw.approvedBy),
  };
}

function readConflict(value: unknown): ProfileConflict | null {
  const raw = asRecord(value);
  if (!raw || !textOrNull(raw.id) || !isProfileField(raw.field)) return null;
  return {
    id: text(raw.id),
    field: raw.field,
    summary: text(raw.summary),
    claimIds: list(raw.claimIds).filter((id): id is string => typeof id === 'string'),
    resolvedAt: timeOrNull(raw.resolvedAt),
  };
}

/**
 * The profile a stored value stands for. Reading never fails on what the file
 * holds: a record that is not a statement, a conflict or a gap is left out, and
 * a file written for another organization is not this organization's profile.
 */
export function readProfile(organizationId: string, stored: unknown): OrganizationProfile {
  const raw = asRecord(stored);
  if (!raw || raw.organizationId !== organizationId) return emptyProfile(organizationId);

  // An id names one record. A second record under the same id is left out.
  const unique = <T extends { id: string }>(entries: (T | null)[]): T[] => {
    const byId = new Map<string, T>();
    for (const entry of entries) if (entry && !byId.has(entry.id)) byId.set(entry.id, entry);
    return [...byId.values()];
  };
  const extraction = asRecord(raw.extraction) ?? {};
  const gaps = new Map<ProfileFieldId, ProfileGap>();
  for (const entry of list(raw.gaps)) {
    const gap = asRecord(entry);
    if (gap && isProfileField(gap.field)) gaps.set(gap.field, { field: gap.field, note: text(gap.note) });
  }

  return {
    schemaVersion: 1,
    organizationId,
    claims: unique(list(raw.claims).map(readClaim)),
    conflicts: unique(list(raw.conflicts).map(readConflict)),
    gaps: [...gaps.values()],
    extraction: {
      status: isOneOf(EXTRACTION_STATES, extraction.status) ? extraction.status : 'idle',
      lastRunAt: timeOrNull(extraction.lastRunAt),
      method: extraction.method === 'assistant' || extraction.method === 'verbatim' ? extraction.method : null,
      error: text(extraction.error),
    },
    approvedAt: timeOrNull(raw.approvedAt),
    approvedBy: textOrNull(raw.approvedBy),
    updatedAt: timeOrNull(raw.updatedAt) ?? 0,
  };
}

// ──────────────────────────────── what was sent ────────────────────────────────

/** A person's own wording: hidden characters removed, spacing tidied, line breaks kept. */
function statementText(value: unknown): string {
  if (typeof value !== 'string') throw invalid('That statement is not valid.');
  // Nothing valid is anywhere near this long, so longer text is refused unread.
  if (value.length > MAX_STATEMENT_CHARS * 8) throw invalid(TOO_LONG);
  const wording = value
    .replace(/\r\n?/g, '\n')
    .replace(UNSAFE_RE, (character) => (character === '\n' ? '\n' : ' '))
    .split('\n')
    .map((line) => line.replace(/\s+/gu, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const length = Array.from(wording).length;
  if (length === 0) throw invalid('Write the statement before saving it.');
  if (length > MAX_STATEMENT_CHARS) throw invalid(TOO_LONG);
  return wording;
}

/** A note on one line, without hidden characters, short enough to sit beside a statement. */
function oneLine(value: string): string {
  const line = value.replace(UNSAFE_RE, ' ').replace(/\s+/gu, ' ').trim();
  return Array.from(line).slice(0, MAX_NOTE_CHARS).join('');
}

function idList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_IDS || !value.every((id) => typeof id === 'string')) {
    throw invalid('Those statements are not valid.');
  }
  return [...new Set(value as string[])];
}

function newClaim(input: unknown): NewClaimInput {
  const raw = asRecord(input);
  if (!raw || !isProfileField(raw.field)) throw invalid('That part of the profile is not one the app uses.');
  const evidence = raw.evidence === undefined ? [] : raw.evidence;
  if (!Array.isArray(evidence) || evidence.length > MAX_EVIDENCE) {
    throw invalid(`Choose up to ${MAX_EVIDENCE} passages as evidence.`);
  }
  return {
    field: raw.field,
    text: statementText(raw.text),
    evidence: evidence.map((entry: unknown) => {
      const piece = asRecord(entry);
      if (!piece || typeof piece.quote !== 'string' || !piece.quote.trim()) {
        throw invalid('A passage you chose is not valid. Choose it again.');
      }
      return {
        documentId: assertUuid(piece.documentId, 'document'),
        blockId: text(piece.blockId),
        quote: piece.quote,
      };
    }),
  };
}

/** What a reading found, or null when it is not something that can be proposed. */
function readFinding(
  value: unknown,
): Pick<ProfileClaim, 'field' | 'text' | 'origin' | 'citations' | 'supersedesClaimId'> | null {
  const raw = asRecord(value);
  if (!raw || !isProfileField(raw.field) || (raw.origin !== 'extracted' && raw.origin !== 'verbatim')) return null;
  // A sentence the assistant wrote is held to the product's wording. A passage
  // offered word for word stays exactly as the document has it.
  const wording = (raw.origin === 'extracted' ? applyTerminology(text(raw.text)) : text(raw.text)).trim();
  const citations = list(raw.citations).flatMap((citation) => readCitation(citation) ?? []);
  // A finding with nothing in the documents behind it is not a proposal.
  if (!wording || citations.length === 0) return null;
  return {
    field: raw.field,
    text: wording,
    origin: raw.origin,
    citations,
    supersedesClaimId: textOrNull(raw.supersedesClaimId),
  };
}

// ─────────────────────────────── rules of a profile ────────────────────────────

/** Two statements are the same when their field and wording match, whatever the capitals and spacing. */
const statementKey = (field: ProfileFieldId, wording: string): string =>
  `${field}:${wording.normalize('NFKC').toLowerCase().replace(/\s+/gu, '')}`;

/** Approved at some point and still part of the profile, in use or waiting to be confirmed again. */
const wasApproved = (claim: ProfileClaim): boolean => claim.status === 'approved' || claim.status === 'needs_review';

const sameSides = (a: string[], b: string[]): boolean => a.length === b.length && a.every((id) => b.includes(id));

function requireClaim(profile: OrganizationProfile, claimId: string): ProfileClaim {
  const claim = profile.claims.find((entry) => entry.id === claimId);
  if (!claim) throw new FundingError('NOT_FOUND', 'That statement is no longer here.');
  return claim;
}

/** True while the statement is one side of a conflict nobody has settled. */
function isContested(profile: OrganizationProfile, claimId: string): boolean {
  return profile.conflicts.some((conflict) => conflict.resolvedAt === null && conflict.claimIds.includes(claimId));
}

/**
 * Puts the parts of a profile back in step after its statements changed.
 *  - A proposal points at the statement it would replace only while that
 *    statement is there to be replaced.
 *  - An open conflict lists statements that are still in play, and needs two
 *    of them. A settled one is kept for as long as any of its statements is.
 *  - A field is a gap only while it has nothing approved or proposed.
 */
function tidy(profile: OrganizationProfile): void {
  const byId = new Map(profile.claims.map((claim) => [claim.id, claim]));
  for (const claim of profile.claims) {
    if (claim.supersedesClaimId === null) continue;
    const replaces = byId.get(claim.supersedesClaimId);
    if (claim.status !== 'proposed' || !replaces || !wasApproved(replaces)) claim.supersedesClaimId = null;
  }
  profile.conflicts = profile.conflicts.flatMap((conflict) => {
    const open = conflict.resolvedAt === null;
    const claimIds = [...new Set(conflict.claimIds)].filter((id) => {
      const claim = byId.get(id);
      return claim !== undefined && (!open || claim.status !== 'rejected');
    });
    return claimIds.length < (open ? 2 : 1) ? [] : [{ ...conflict, claimIds }];
  });
  const covered = new Set(
    profile.claims
      .filter((claim) => claim.status === 'approved' || claim.status === 'proposed')
      .map((claim) => claim.field),
  );
  profile.gaps = profile.gaps.filter((gap) => !covered.has(gap.field));
}

function approve(profile: OrganizationProfile, claim: ProfileClaim, actor: Actor, now: number): void {
  const replaces = claim.supersedesClaimId;
  claim.status = 'approved';
  claim.approvedAt = now;
  claim.approvedBy = actor.userId;
  claim.reviewReason = null;
  claim.reviewNote = '';
  claim.supersedesClaimId = null;
  claim.updatedAt = now;
  // The statement it was written to replace goes in the same step, so the
  // profile never holds both wordings as approved.
  if (replaces !== null) {
    profile.claims = profile.claims.filter(
      (other) => other === claim || other.id !== replaces || !wasApproved(other),
    );
  }
  profile.approvedAt = now;
  profile.approvedBy = actor.userId;
}

function reject(claim: ProfileClaim, now: number): void {
  claim.status = 'rejected';
  claim.reviewReason = null;
  claim.reviewNote = '';
  claim.supersedesClaimId = null;
  claim.approvedAt = null;
  claim.approvedBy = null;
  claim.updatedAt = now;
}

// ───────────────────────────────────── store ───────────────────────────────────

export class ProfileStore {
  private readonly now: () => number;
  // One organization's profile is read, changed and written as one step.
  private readonly queues = new Map<string, Promise<unknown>>();
  // Organizations whose documents are being read into a draft by this run of the app.
  private readonly reading = new Set<string>();

  constructor(private readonly options: ProfileStoreOptions = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  private file(organizationId: string): string {
    return orgPath(organizationId, 'knowledge', 'profile.json');
  }

  private async read(organizationId: string): Promise<OrganizationProfile> {
    const profile = readProfile(organizationId, await readJson<unknown>(this.file(organizationId), null));
    // A reading that an earlier run of the app left unfinished is not running now.
    if (profile.extraction.status === 'running' && !this.reading.has(organizationId)) {
      profile.extraction.status = 'idle';
    }
    return profile;
  }

  private change(
    organizationId: string,
    apply: (profile: OrganizationProfile) => void | Promise<void>,
  ): Promise<OrganizationProfile> {
    const previous = this.queues.get(organizationId) ?? Promise.resolve();
    let written = false;
    const run = previous.then(async () => {
      const profile = await this.read(organizationId);
      const before = JSON.stringify(profile);
      await apply(profile);
      tidy(profile);
      // Nothing changed: nothing to write, and nobody to tell.
      if (JSON.stringify(profile) === before) return profile;
      profile.updatedAt = this.now();
      await writeJson(this.file(organizationId), profile);
      written = true;
      return profile;
    });
    const settled = run.then(
      () => {},
      () => {},
    );
    this.queues.set(organizationId, settled);
    void settled.then(() => {
      if (this.queues.get(organizationId) === settled) this.queues.delete(organizationId);
    });
    return run.then((profile) => {
      if (written) this.options.onChange?.(organizationId);
      return profile;
    });
  }

  /** The profile as it is stored. An organization that has none yet has an empty one. */
  get(organizationId: string): Promise<OrganizationProfile> {
    return this.read(organizationId);
  }

  /** Drops what is held in memory for an organization. */
  forget(organizationId: string): void {
    this.queues.delete(organizationId);
    this.reading.delete(organizationId);
  }

  // ──────────────────────────── reading the documents ───────────────────────────

  async beginExtraction(organizationId: string): Promise<void> {
    this.reading.add(organizationId);
    try {
      await this.change(organizationId, (profile) => {
        profile.extraction = { ...profile.extraction, status: 'running', error: '' };
      });
    } catch (error) {
      this.reading.delete(organizationId);
      throw error;
    }
  }

  /** Ends a reading that did not finish. An empty message means it was stopped, not that it failed. */
  async endExtraction(organizationId: string, message: string): Promise<void> {
    const error = oneLine(text(message));
    try {
      await this.change(organizationId, (profile) => {
        profile.extraction = { ...profile.extraction, status: error ? 'failed' : 'idle', error };
      });
    } finally {
      this.reading.delete(organizationId);
    }
  }

  /** Stores what a reading found as proposals for a person to confirm. */
  async applyExtraction(organizationId: string, outcome: ExtractionOutcome): Promise<OrganizationProfile> {
    try {
      return await this.change(organizationId, (profile) => {
        const now = this.now();
        // What an earlier reading suggested and nobody has touched gives way to this one.
        profile.claims = profile.claims.filter((claim) => !isUntouchedFinding(claim));
        tidy(profile);

        const existing = new Map(profile.claims.map((claim) => [claim.id, claim]));
        const inPlay = new Map<string, ProfileClaim>();
        const declined = new Set<string>();
        for (const claim of profile.claims) {
          const key = statementKey(claim.field, claim.text);
          if (claim.status === 'rejected') declined.add(key);
          else if (!inPlay.has(key)) inPlay.set(key, claim);
        }

        // For each finding, in order, the statement that stands for it: a new
        // proposal, the statement with the same wording that is already in
        // play, or none when that wording was rejected or cannot be proposed.
        const standsFor = list(outcome.claims).map((entry): string | null => {
          const finding = readFinding(entry);
          if (!finding) return null;
          const key = statementKey(finding.field, finding.text);
          const same = inPlay.get(key);
          if (same) return same.id;
          if (declined.has(key)) return null;
          const replaces = finding.supersedesClaimId === null ? undefined : existing.get(finding.supersedesClaimId);
          const claim: ProfileClaim = {
            id: randomUUID(),
            field: finding.field,
            text: finding.text,
            origin: finding.origin,
            status: 'proposed',
            citations: finding.citations,
            reviewReason: null,
            reviewNote: '',
            supersedesClaimId:
              replaces?.status === 'approved' && replaces.field === finding.field ? replaces.id : null,
            edited: false,
            createdAt: now,
            updatedAt: now,
            approvedAt: null,
            approvedBy: null,
          };
          profile.claims.push(claim);
          inPlay.set(key, claim);
          return claim.id;
        });

        const fieldOf = new Map(profile.claims.map((claim) => [claim.id, claim.field]));
        for (const entry of list(outcome.conflicts)) {
          const reported = asRecord(entry);
          if (!reported) continue;
          const sides = new Set<string>();
          for (const position of list(reported.claimIndexes)) {
            const id = typeof position === 'number' ? standsFor[position] : null;
            if (id) sides.add(id);
          }
          for (const id of list(reported.existingClaimIds)) {
            if (typeof id === 'string' && existing.has(id) && existing.get(id)?.status !== 'rejected') sides.add(id);
          }
          const claimIds = [...sides];
          const first = claimIds[0];
          if (first === undefined || claimIds.length < 2) continue;
          // A disagreement already on record, open or settled by a person, is not raised again.
          if (profile.conflicts.some((known) => sameSides(known.claimIds, claimIds))) continue;
          profile.conflicts.push({
            id: randomUUID(),
            field: isProfileField(reported.field) ? reported.field : (fieldOf.get(first) ?? 'mission'),
            summary: oneLine(applyTerminology(text(reported.summary))) || CONFLICT_SUMMARY,
            claimIds,
            resolvedAt: null,
          });
        }

        const noted = new Map<ProfileFieldId, string>();
        for (const entry of list(outcome.gaps)) {
          const gap = asRecord(entry);
          if (gap && isProfileField(gap.field)) noted.set(gap.field, oneLine(applyTerminology(text(gap.note))));
        }
        const covered = new Set(
          profile.claims
            .filter((claim) => claim.status === 'approved' || claim.status === 'proposed')
            .map((claim) => claim.field),
        );
        profile.gaps = PROFILE_FIELDS.filter((field) => !covered.has(field)).map((field) => ({
          field,
          note: noted.get(field) || GAP_NOTE,
        }));

        profile.extraction = {
          status: 'idle',
          lastRunAt: now,
          method: outcome.method === 'assistant' || outcome.method === 'verbatim' ? outcome.method : null,
          error: '',
        };
      });
    } finally {
      this.reading.delete(organizationId);
    }
  }

  // ────────────────────────────── a person's decisions ──────────────────────────

  async approveClaims(organizationId: string, claimIds: string[], actor: Actor): Promise<OrganizationProfile> {
    if (!actor.canApprove) throw forbidden('approve profile statements');
    const ids = idList(claimIds);
    return this.change(organizationId, (profile) => {
      const waiting = ids
        .map((id) => requireClaim(profile, id))
        .filter((claim) => claim.status === 'proposed' || claim.status === 'needs_review');
      const contested = waiting.filter((claim) => isContested(profile, claim.id)).length;
      if (contested > 0) {
        throw invalid(
          ids.length === 1
            ? 'This statement is part of a conflict that has not been resolved. Resolve the conflict before approving it.'
            : `${contested} of the chosen statements ${contested === 1 ? 'is' : 'are'} part of a conflict that has not been resolved. Resolve the conflict first, then approve.`,
        );
      }
      const now = this.now();
      for (const claim of waiting) approve(profile, claim, actor, now);
    });
  }

  async rejectClaims(organizationId: string, claimIds: string[], actor: Actor): Promise<OrganizationProfile> {
    if (!actor.canApprove) throw forbidden('reject profile statements');
    const ids = idList(claimIds);
    return this.change(organizationId, (profile) => {
      const now = this.now();
      for (const claim of ids.map((id) => requireClaim(profile, id))) {
        // An approved statement is not rejected here; removing it is a separate, deliberate step.
        if (claim.status === 'proposed' || claim.status === 'needs_review') reject(claim, now);
      }
    });
  }

  /** Adds a person's own statement: approved at once when they may approve, proposed otherwise. */
  async addClaim(
    organizationId: string,
    input: NewClaimInput,
    actor: Actor,
    cite: CiteEvidence,
  ): Promise<OrganizationProfile> {
    const { field, text: wording, evidence } = newClaim(input);
    return this.change(organizationId, async (profile) => {
      if (profile.claims.length >= MAX_CLAIMS) {
        throw invalid(`A profile can hold up to ${MAX_CLAIMS} statements. Remove some before adding another.`);
      }
      const citations = evidence.length > 0 ? await cite(evidence) : [];
      const now = this.now();
      profile.claims.push({
        id: randomUUID(),
        field,
        text: wording,
        origin: 'user',
        status: actor.canApprove ? 'approved' : 'proposed',
        citations,
        reviewReason: null,
        reviewNote: '',
        supersedesClaimId: null,
        edited: false,
        createdAt: now,
        updatedAt: now,
        approvedAt: actor.canApprove ? now : null,
        approvedBy: actor.canApprove ? actor.userId : null,
      });
      if (actor.canApprove) {
        profile.approvedAt = now;
        profile.approvedBy = actor.userId;
      }
    });
  }

  async updateClaim(
    organizationId: string,
    claimId: string,
    newText: string,
    actor: Actor,
  ): Promise<OrganizationProfile> {
    const wording = statementText(newText);
    return this.change(organizationId, (profile) => {
      const claim = requireClaim(profile, claimId);
      if (claim.status === 'rejected') throw invalid('That statement was rejected, so it can no longer be changed.');
      if (claim.text === wording) return;
      const now = this.now();
      if (claim.status === 'approved' && !actor.canApprove) {
        // The approved wording stands until someone who may approve accepts the new one.
        if (profile.claims.length >= MAX_CLAIMS) {
          throw invalid(`A profile can hold up to ${MAX_CLAIMS} statements. Remove some before adding another.`);
        }
        profile.claims.push({
          ...claim,
          id: randomUUID(),
          text: wording,
          status: 'proposed',
          citations: claim.citations.map((citation) => ({ ...citation })),
          reviewReason: null,
          reviewNote: '',
          supersedesClaimId: claim.id,
          edited: true,
          createdAt: now,
          updatedAt: now,
          approvedAt: null,
          approvedBy: null,
        });
        return;
      }
      claim.text = wording;
      claim.edited = true;
      claim.updatedAt = now;
      // A statement awaiting review stays that way until someone approves it.
      if (claim.status === 'approved') {
        claim.approvedAt = now;
        claim.approvedBy = actor.userId;
        profile.approvedAt = now;
        profile.approvedBy = actor.userId;
      }
    });
  }

  async deleteClaim(organizationId: string, claimId: string, actor: Actor): Promise<OrganizationProfile> {
    return this.change(organizationId, (profile) => {
      const claim = requireClaim(profile, claimId);
      if (wasApproved(claim) && !actor.canApprove) throw forbidden('remove a statement that has been approved');
      profile.claims = profile.claims.filter((other) => other !== claim);
    });
  }

  /** Settles a conflict the way a person chose: the named statements are kept, the others go. */
  async resolveConflict(
    organizationId: string,
    conflictId: string,
    keepClaimIds: string[],
    actor: Actor,
  ): Promise<OrganizationProfile> {
    if (!actor.canApprove) throw forbidden('resolve conflicts');
    const keep = idList(keepClaimIds);
    return this.change(organizationId, (profile) => {
      const conflict = profile.conflicts.find((entry) => entry.id === conflictId);
      if (!conflict) throw new FundingError('NOT_FOUND', 'That conflict is no longer here.');
      if (conflict.resolvedAt !== null) throw invalid('That conflict has already been resolved.');
      if (keep.length === 0 || !keep.every((id) => conflict.claimIds.includes(id))) {
        throw invalid('Choose at least one of the statements in this conflict to keep.');
      }
      const now = this.now();
      conflict.resolvedAt = now;

      const dropped = conflict.claimIds
        .filter((id) => !keep.includes(id))
        .flatMap((id) => profile.claims.find((claim) => claim.id === id) ?? []);
      // An approved statement that lost is removed outright; it was never a suggestion to decline.
      const removed = new Set(dropped.filter((claim) => claim.status === 'approved'));
      for (const claim of dropped) {
        if (claim.status === 'proposed' || claim.status === 'needs_review') reject(claim, now);
      }
      profile.claims = profile.claims.filter((claim) => !removed.has(claim));
      // Other conflicts that only involved what just went are over too, which
      // decides whether a kept statement is still disputed elsewhere.
      tidy(profile);

      for (const id of keep) {
        const claim = profile.claims.find((entry) => entry.id === id);
        if (claim?.status === 'proposed' && !isContested(profile, id)) approve(profile, claim, actor, now);
      }
    });
  }

  // ─────────────────────────── when a document changes ──────────────────────────

  /** Checks every statement that cites a document which was replaced or deleted. */
  async sourcesChanged(organizationId: string, changes: SourceChange[]): Promise<OrganizationProfile> {
    return this.change(organizationId, (profile) => {
      const now = this.now();
      for (const change of changes) {
        profile.claims = settleCitations(profile.claims, change, now).claims;
      }
    });
  }
}
