// The identity file: who the local user is, which organizations are on this
// device, who belongs to them and which one is active.
//
//   <userData>/identity.json
//
// The rules for what a stored record may hold live here too, because the same
// rules decide what the service accepts from a person and what a read repairs.
//
// Reading never fails on what the file contains. A record the app cannot stand
// behind (a bad id, an unknown kind or role, a membership for an organization
// that is gone) is dropped; a field that is merely malformed is reset. Before
// a repair is saved, the file as it was found is kept beside it, so a repair
// is never what loses data. Repairing a repaired file changes nothing.

import { app } from 'electron';
import { constants } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ORGANIZATION_KIND_LABELS,
  ROLE_PERMISSIONS,
  type LocalProfile,
  type Membership,
  type MembershipStatus,
  type Organization,
  type OrganizationKind,
  type OrgConsents,
  type OrgLocation,
  type OrgRole,
} from '../../shared/funding.js';
import { FundingError } from '../funding/errors.js';
import { isUuid, readJson, writeJson } from '../funding/org-store.js';

const SCHEMA_VERSION = 1;

export interface IdentityFile {
  schemaVersion: 1;
  /** Null until the app is first used. */
  profile: LocalProfile | null;
  organizations: Organization[];
  /** Kept for every user, although in local mode there is only one. */
  memberships: Membership[];
  activeOrganizationId: string | null;
}

/** Field lengths, counted in characters once the text is trimmed. */
export const LIMITS = {
  displayName: { min: 1, max: 80 },
  email: { min: 0, max: 254 },
  organizationName: { min: 2, max: 120 },
  region: { min: 0, max: 60 },
  county: { min: 0, max: 80 },
  city: { min: 0, max: 80 },
} as const;

export const DEFAULT_COUNTRY = 'US';
/** Stands in for a name that was lost, so the gap is visible and can be fixed. */
const UNNAMED_ORGANIZATION = 'Unnamed organization';
export const UNNAMED_USER = 'Local user';

// Nothing valid is anywhere near this long, so longer text is not examined.
const SCAN_LIMIT = 2000;

// Controls, line breaks, broken halves of a character and the invisible
// direction overrides used to disguise text. None belongs in a name or in a
// one-line label. Joiners that some scripts and emoji need are left alone.
const UNSAFE_RE = /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}\u202A-\u202E\u2066-\u2069]+/gu;

const COUNTRY_RE = /^[A-Za-z]{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/u;

type Fields = Record<string, unknown>;

/** The value as a plain record of fields, or null when it is anything else. */
export function asRecord(value: unknown): Fields | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Fields) : null;
}

/**
 * An id exactly as randomUUID() writes it. Other spellings of the same id are
 * refused: on a volume that ignores case they would name the same directory.
 */
export function isRecordId(value: unknown): value is string {
  return isUuid(value) && value === value.toLowerCase();
}

export function isOrganizationKind(value: unknown): value is OrganizationKind {
  return typeof value === 'string' && Object.hasOwn(ORGANIZATION_KIND_LABELS, value);
}

function isRole(value: unknown): value is OrgRole {
  return typeof value === 'string' && Object.hasOwn(ROLE_PERMISSIONS, value);
}

function isStatus(value: unknown): value is MembershipStatus {
  return value === 'active' || value === 'suspended';
}

/** A two-letter country code in capitals, or null. */
export function countryCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return COUNTRY_RE.test(text) ? text.toUpperCase() : null;
}

/** Loose on purpose: enough to catch a slip, not a verdict on the address. */
export function isPlausibleEmail(value: string): boolean {
  if (value.length > LIMITS.email.max || value.search(UNSAFE_RE) >= 0) return false;
  // The part before the @ may be 64 characters at most.
  return EMAIL_RE.test(value) && value.indexOf('@') <= 64;
}

/** Text on one line: unsafe characters and runs of white space become single spaces. */
export function oneLine(text: string): string {
  return text.replace(UNSAFE_RE, ' ').normalize('NFC').replace(/\s+/g, ' ').trim();
}

/**
 * Whatever can be kept of a stored text field: one line, cut to the field's
 * length. Used on what is already on disk, where dropping the whole record
 * over one bad field would lose more than it protects.
 */
export function tidy(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const text = oneLine(value.slice(0, SCAN_LIMIT));
  const characters = Array.from(text);
  return characters.length <= max ? text : characters.slice(0, max).join('').trimEnd();
}

/**
 * A new value for a text field exactly as it will be stored, or the rule it
 * breaks. Stricter than `tidy`: a person entering a value is told what is
 * wrong with it rather than having it quietly altered.
 */
export function checkText(
  value: unknown,
  limit: { min: number; max: number },
): { text: string } | { problem: 'length' | 'characters' } {
  if (typeof value !== 'string' || value.length > SCAN_LIMIT) return { problem: 'length' };
  const trimmed = value.normalize('NFC').trim();
  if (trimmed.search(UNSAFE_RE) >= 0) return { problem: 'characters' };
  const text = trimmed.replace(/\s+/g, ' ');
  const count = Array.from(text).length;
  return count < limit.min || count > limit.max ? { problem: 'length' } : { text };
}

function emptyIdentity(): IdentityFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    profile: null,
    organizations: [],
    memberships: [],
    activeOrganizationId: null,
  };
}

// Version 1 is the only one there has been, so a record with no version is a
// damaged version 1. A record that names another version was written by a
// build this one cannot second-guess.
const understood = (version: unknown) => version === undefined || version === SCHEMA_VERSION;

function timestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

// A missing time is taken from the other one. Zero means it is not known:
// stamping the record with today's date would be making a date up.
function times(record: Fields): { createdAt: number; updatedAt: number } {
  const updated = timestamp(record.updatedAt);
  const createdAt = timestamp(record.createdAt) ?? updated ?? 0;
  return { createdAt, updatedAt: updated ?? createdAt };
}

function repairProfile(value: unknown): LocalProfile | null {
  const record = asRecord(value);
  // Memberships point at this id, so a profile without a usable one is no profile.
  if (!record || !understood(record.schemaVersion) || !isRecordId(record.id)) return null;
  const email = typeof record.email === 'string' ? record.email.trim() : '';
  return {
    schemaVersion: SCHEMA_VERSION,
    id: record.id,
    displayName: tidy(record.displayName, LIMITS.displayName.max) || UNNAMED_USER,
    email: isPlausibleEmail(email) ? email : '',
    ...times(record),
  };
}

function repairLocation(value: unknown): OrgLocation {
  const record = asRecord(value) ?? {};
  return {
    country: countryCode(record.country) ?? DEFAULT_COUNTRY,
    region: tidy(record.region, LIMITS.region.max),
    county: tidy(record.county, LIMITS.county.max),
    city: tidy(record.city, LIMITS.city.max),
  };
}

// A consent time that cannot be read counts as not given, so it is asked for again.
function repairConsents(value: unknown): OrgConsents {
  const record = asRecord(value) ?? {};
  const given = (time: unknown) =>
    typeof time === 'number' && Number.isFinite(time) && time > 0 ? time : null;
  return {
    documentAnalysisAt: given(record.documentAnalysisAt),
    liveFundingSearchAt: given(record.liveFundingSearchAt),
  };
}

function repairOrganization(value: unknown): Organization | null {
  const record = asRecord(value);
  if (!record || !understood(record.schemaVersion)) return null;
  // The id names its directory and the kind shapes the guidance it is given.
  // Neither can be guessed.
  if (!isRecordId(record.id) || !isOrganizationKind(record.kind)) return null;
  const name = tidy(record.name, LIMITS.organizationName.max);
  return {
    schemaVersion: SCHEMA_VERSION,
    id: record.id,
    name: Array.from(name).length >= LIMITS.organizationName.min ? name : UNNAMED_ORGANIZATION,
    kind: record.kind,
    location: repairLocation(record.location),
    consents: repairConsents(record.consents),
    ...times(record),
  };
}

// A role or a status that cannot be read is never guessed: the membership is
// dropped, which denies access rather than granting some.
function repairMembership(value: unknown, organizationIds: Set<string>): Membership | null {
  const record = asRecord(value);
  if (!record || !isRecordId(record.userId) || !isRole(record.role) || !isStatus(record.status)) return null;
  if (!isRecordId(record.organizationId) || !organizationIds.has(record.organizationId)) return null;
  return {
    organizationId: record.organizationId,
    userId: record.userId,
    role: record.role,
    status: record.status,
    ...times(record),
  };
}

/** The state a stored value stands for. Pure, total, and stable on its own output. */
export function repairIdentity(raw: unknown): IdentityFile {
  const record = asRecord(raw);
  if (!record || !understood(record.schemaVersion)) return emptyIdentity();

  const organizations: Organization[] = [];
  const organizationIds = new Set<string>();
  for (const entry of Array.isArray(record.organizations) ? record.organizations : []) {
    const organization = repairOrganization(entry);
    if (!organization || organizationIds.has(organization.id)) continue;
    organizationIds.add(organization.id);
    organizations.push(organization);
  }

  const memberships: Membership[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(record.memberships) ? record.memberships : []) {
    const membership = repairMembership(entry, organizationIds);
    const key = membership ? `${membership.organizationId} ${membership.userId}` : '';
    if (!membership || seen.has(key)) continue;
    seen.add(key);
    memberships.push(membership);
  }

  const active = record.activeOrganizationId;
  return {
    schemaVersion: SCHEMA_VERSION,
    profile: repairProfile(record.profile),
    organizations,
    memberships,
    activeOrganizationId: typeof active === 'string' && organizationIds.has(active) ? active : null,
  };
}

/** Resolved on every call: the data directory is not settled while main is still loading. */
function identityPath(): string {
  return join(app.getPath('userData'), 'identity.json');
}

// The last state read or saved, with the file it belongs to. Nothing else
// writes this file, so after the first read the copy in memory is the truth.
let cache: { path: string; file: IdentityFile } | null = null;

// First reads and saves take turns, so a slow first read can never replace
// the result of a save that finished while it was running.
let turn: Promise<unknown> = Promise.resolve();

function inOrder<T>(task: () => Promise<T>): Promise<T> {
  const run = turn.then(task);
  turn = run.catch(() => {});
  return run;
}

async function saveRepair(path: string, file: IdentityFile): Promise<void> {
  try {
    await copyFile(path, `${path}.before-repair-${Date.now()}`, constants.COPYFILE_EXCL);
    await writeJson(path, file);
  } catch (error) {
    // The repaired state is still used; the file is repaired again next time.
    console.error('[identity] a repaired identity file could not be saved', error);
  }
}

async function load(path: string): Promise<IdentityFile> {
  let raw: unknown;
  try {
    raw = await readJson<unknown>(path, null);
  } catch (error) {
    // Not the same as a missing file: starting afresh here would save an empty
    // state on top of a file that may be perfectly good.
    console.error('[identity] the identity file could not be read', error);
    throw new FundingError(
      'MIGRATION_FAILED',
      'Your profile and organizations could not be read from this device. ' +
        'Quit BulleBrowser, open it again and try once more.',
    );
  }
  const file = repairIdentity(raw);
  if (raw !== null && JSON.stringify(raw) !== JSON.stringify(file)) await saveRepair(path, file);
  return file;
}

/** The stored state, repaired. The result is the caller's own copy. */
export async function readIdentity(): Promise<IdentityFile> {
  const path = identityPath();
  if (cache?.path === path) return structuredClone(cache.file);
  return inOrder(async () => {
    if (cache?.path !== path) cache = { path, file: await load(path) };
    return structuredClone(cache.file);
  });
}

/**
 * Saves the state. It is saved in repaired form, so the file never needs
 * repairing because of something the app itself wrote. When it cannot be
 * saved, the state in memory stays as it was, in step with the file.
 */
export async function writeIdentity(next: IdentityFile): Promise<void> {
  const path = identityPath();
  const file = repairIdentity({ ...next, schemaVersion: SCHEMA_VERSION });
  await inOrder(async () => {
    try {
      await writeJson(path, file);
    } catch (error) {
      console.error('[identity] the identity file could not be saved', error);
      throw new FundingError(
        'INTERNAL',
        'Your profile and organizations could not be saved on this device. ' +
          'Check that the disk is not full, then try again.',
      );
    }
    cache = { path, file };
  });
}
