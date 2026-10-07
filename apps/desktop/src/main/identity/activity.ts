// Each organization's record of who did what. It lives inside the
// organization's own directory, so it is deleted with the organization and
// cannot be read from another one. An entry carries a short label, such as a
// file name or a count, and never document text.

import { randomUUID } from 'node:crypto';
import { rename } from 'node:fs/promises';
import type { OrgActivity } from '../../shared/funding.js';
import { FundingError } from '../funding/errors.js';
import { orgPath, readJson, writeJson } from '../funding/org-store.js';
import { asRecord, isRecordId, oneLine } from './store.js';

/** The most entries kept for one organization. Older ones fall off the end. */
export const ACTIVITY_LIMIT = 500;

const DEFAULT_LIST_LENGTH = 50;
const DETAIL_MAX = 200;
const ACTOR_MAX = 64;
const FILE_NAME = 'activity.json';
const SCHEMA_VERSION = 1;

type ActivityAction = OrgActivity['action'];

// Written as a record so that an action added to the contract and not listed
// here fails the type check.
const ACTIONS: Record<ActivityAction, true> = {
  organization_created: true,
  organization_updated: true,
  document_added: true,
  document_replaced: true,
  document_deleted: true,
  profile_extracted: true,
  claims_approved: true,
  claims_rejected: true,
  claim_edited: true,
  claim_added: true,
  claim_deleted: true,
  conflict_resolved: true,
  rfp_added: true,
  rfp_deleted: true,
  rfp_analyzed: true,
  alignment_assessed: true,
  guide_started: true,
  opportunity_saved: true,
  opportunity_removed: true,
  consent_recorded: true,
};

function isAction(value: unknown): value is ActivityAction {
  return typeof value === 'string' && Object.hasOwn(ACTIONS, value);
}

/** One line of at most `max` characters. A longer one ends in an ellipsis. */
function label(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const text = oneLine(value.slice(0, max * 8));
  const characters = Array.from(text);
  if (characters.length <= max) return text;
  return `${characters.slice(0, max - 1).join('').trimEnd()}…`;
}

// Entries are checked again on the way out, so a file that was edited by hand
// cannot put another organization's entries, or a wall of text, on screen.
function entryFrom(value: unknown, organizationId: string): OrgActivity | null {
  const record = asRecord(value);
  if (!record || !isRecordId(record.id) || record.organizationId !== organizationId) return null;
  if (typeof record.at !== 'number' || !Number.isFinite(record.at) || record.at < 0) return null;
  if (!isAction(record.action)) return null;
  return {
    id: record.id,
    organizationId,
    at: record.at,
    actorId: label(record.actorId, ACTOR_MAX),
    action: record.action,
    detail: label(record.detail, DETAIL_MAX),
  };
}

interface Stored {
  entries: OrgActivity[];
  /** False when a file is there that this version cannot make sense of. */
  understood: boolean;
}

async function readStored(file: string, organizationId: string): Promise<Stored> {
  const raw = await readJson<unknown>(file, null);
  if (raw === null) return { entries: [], understood: true };
  const record = asRecord(raw);
  if (!record || record.schemaVersion !== SCHEMA_VERSION || !Array.isArray(record.entries)) {
    return { entries: [], understood: false };
  }
  const entries: OrgActivity[] = [];
  for (const value of record.entries) {
    const entry = entryFrom(value, organizationId);
    if (entry) entries.push(entry);
    if (entries.length === ACTIVITY_LIMIT) break;
  }
  return { entries, understood: true };
}

// Adding an entry is read, change, write. Each file gets a queue so two
// additions made at the same moment cannot both start from the same list.
const queues = new Map<string, Promise<void>>();

function inTurn(file: string, task: () => Promise<void>): Promise<void> {
  const run = (queues.get(file) ?? Promise.resolve()).then(task);
  const settled = run.catch(() => {});
  queues.set(file, settled);
  void settled.then(() => {
    if (queues.get(file) === settled) queues.delete(file);
  });
  return run;
}

// Organizations whose record has been closed because they are being deleted.
const closed = new Set<string>();

/**
 * Adds an entry, newest first. Never rejects: the action being recorded has
 * already happened, and failing to note it must not fail or undo it.
 */
export async function recordActivity(
  organizationId: string,
  actorId: string,
  action: OrgActivity['action'],
  detail: string,
): Promise<void> {
  try {
    if (!isRecordId(organizationId)) throw new Error('the organization id is not valid');
    if (!isAction(action)) throw new Error('the action is not one the app records');
    const file = orgPath(organizationId, FILE_NAME);
    const entry: OrgActivity = {
      id: randomUUID(),
      organizationId,
      at: Date.now(),
      actorId: label(actorId, ACTOR_MAX),
      action,
      detail: label(detail, DETAIL_MAX),
    };
    await inTurn(file, async () => {
      // Checked when its turn comes, not when it was asked for: the record may
      // have been closed while this entry waited.
      if (closed.has(organizationId)) return;
      const stored = await readStored(file, organizationId);
      // A record this version cannot read is set aside, not written over.
      if (!stored.understood) await rename(file, `${file}.unreadable-${Date.now()}`);
      const entries = [entry, ...stored.entries].slice(0, ACTIVITY_LIMIT);
      await writeJson(file, { schemaVersion: SCHEMA_VERSION, entries });
    });
  } catch (error) {
    console.error('[identity] an activity entry could not be recorded', error);
  }
}

function listLength(limit: unknown): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 1) return DEFAULT_LIST_LENGTH;
  return Math.min(Math.floor(limit), ACTIVITY_LIMIT);
}

/** The most recent entries for one organization, newest first. */
export async function listActivity(
  organizationId: string,
  limit: number = DEFAULT_LIST_LENGTH,
): Promise<OrgActivity[]> {
  const file = orgPath(organizationId, FILE_NAME);
  // Entries still being written are part of the answer.
  await queues.get(file);
  let stored: Stored;
  try {
    stored = await readStored(file, organizationId);
  } catch (error) {
    console.error('[identity] an activity record could not be read', error);
    throw new FundingError('INTERNAL', "This organization's activity could not be read. Try again in a moment.");
  }
  return stored.entries.slice(0, listLength(limit));
}

/**
 * Called when an organization is being deleted. Waits for entries that are
 * being written and refuses later ones, so work that finishes late cannot
 * bring the organization's directory back.
 */
export async function closeActivity(organizationId: string): Promise<void> {
  if (!isRecordId(organizationId)) return;
  closed.add(organizationId);
  await queues.get(orgPath(organizationId, FILE_NAME));
}

/** Undoes closeActivity for an organization that turned out not to be deleted. */
export function reopenActivity(organizationId: string): void {
  closed.delete(organizationId);
}
