// Who is using the app and which organization they are working in.
//
// There is no sign-in. The person at the device is the user: a profile is
// created for them the first time anything asks, and they own every
// organization they create. Roles and permissions are checked all the same, on
// every action that touches an organization, so that a sign-in provider added
// later can assign them without anything else changing.
//
// An organization is a business or a CBO whose documents and funding work are
// kept apart from every other organization on the device. One is active at a
// time, and that choice is restored after a restart.

import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';
import type {
  FundingErrorCode,
  IdentityState,
  LocalProfile,
  Membership,
  NewOrganizationInput,
  Organization,
  OrganizationKind,
  OrgActivity,
  OrgConsents,
  OrgLocation,
  OrgRole,
  Permission,
  SessionInfo,
} from '../../shared/funding.js';
import { FundingError } from '../funding/errors.js';
import { assertUuid, isUuid, removeOrganizationData } from '../funding/org-store.js';
import { closeActivity, recordActivity, reopenActivity } from './activity.js';
import { permissionsFor, roleAllows } from './authorization.js';
import { LocalAuthProvider, type AuthProvider } from './providers.js';
import {
  DEFAULT_COUNTRY,
  LIMITS,
  UNNAMED_USER,
  asRecord,
  checkText,
  countryCode,
  isOrganizationKind,
  isPlausibleEmail,
  readIdentity,
  tidy,
  writeIdentity,
  type IdentityFile,
} from './store.js';

export interface IdentityDeps {
  /** How the user is identified. Local mode unless another provider is given. */
  provider?: AuthProvider;
  /** The operating system's name for the person at the device. */
  userName?: () => string;
  /** Deletes everything an organization holds. */
  removeOrganizationData?: (organizationId: string) => Promise<void>;
}

export interface IdentityService {
  /** The profile, the user's organizations and memberships, and the session. */
  getState(): Promise<IdentityState>;
  updateProfile(patch: { displayName?: string; email?: string }): Promise<IdentityState>;
  /** The creator becomes its owner and it becomes the active organization. */
  createOrganization(input: NewOrganizationInput): Promise<IdentityState>;
  updateOrganization(organizationId: string, patch: Partial<NewOrganizationInput>): Promise<IdentityState>;
  switchOrganization(organizationId: string): Promise<IdentityState>;
  /** Removes the organization and every file it holds. */
  deleteOrganization(organizationId: string): Promise<IdentityState>;
  /** Stores the time of the first acknowledgement. Later calls leave it as it is. */
  recordConsent(organizationId: string, consent: keyof OrgConsents): Promise<IdentityState>;
  currentSession(): Promise<SessionInfo>;
  /** The active organization, or a FundingError when there is none to work in. */
  requireOrganization(): Promise<{ session: SessionInfo; organization: Organization }>;
  /** Whether the user holds a permission, in the active organization unless one is named. */
  can(permission: Permission, organizationId?: string): Promise<boolean>;
  /** Like `can`, but throws a FundingError that says why. */
  authorize(permission: Permission, organizationId?: string): Promise<void>;
  /** Calls the listener after every change that was saved. Returns how to stop. */
  onChange(listener: () => void): () => void;
}

type Loaded = IdentityFile & { profile: LocalProfile };

interface Granted {
  organization: Organization;
  membership: Membership;
}

interface Refused {
  code: FundingErrorCode;
  message: string;
}

interface Change {
  next: Loaded;
  /** What to note in the organization's activity record. */
  activity?: { organizationId: string; action: OrgActivity['action']; detail: string };
}

interface TextField {
  limit: Limit;
  /** Shown when the entry is too short, too long or not text. */
  length: string;
  /** Shown when the entry holds characters no name has. */
  characters: string;
}

type Limit = { min: number; max: number };

const between = (what: string, limit: Limit) =>
  `Enter ${what} between ${limit.min} and ${limit.max} characters long.`;
const atMost = (what: string, limit: Limit) => `Keep ${what} to ${limit.max} characters or fewer.`;
const unusable = (what: string) =>
  `${what} contains characters that cannot be used, such as line breaks. Type it again without them.`;

const DISPLAY_NAME: TextField = {
  limit: LIMITS.displayName,
  length: between('a name', LIMITS.displayName),
  characters: unusable('Your name'),
};
const ORGANIZATION_NAME: TextField = {
  limit: LIMITS.organizationName,
  length: between('an organization name', LIMITS.organizationName),
  characters: unusable('The organization name'),
};
const REGION: TextField = {
  limit: LIMITS.region,
  length: atMost('the state or region', LIMITS.region),
  characters: unusable('The state or region'),
};
const COUNTY: TextField = {
  limit: LIMITS.county,
  length: atMost('the county', LIMITS.county),
  characters: unusable('The county'),
};
const CITY: TextField = {
  limit: LIMITS.city,
  length: atMost('the city', LIMITS.city),
  characters: unusable('The city'),
};

const NO_LOCATION: OrgLocation = { country: '', region: '', county: '', city: '' };

// The acknowledgements the app asks for, as they are worded in the activity record.
const CONSENT_LABELS: Record<keyof OrgConsents, string> = {
  documentAnalysisAt: 'Document analysis',
  liveFundingSearchAt: 'Live funding search',
};

const invalid = (message: string) => new FundingError('INVALID_INPUT', message);

function textFrom(value: unknown, field: TextField): string {
  const result = checkText(value, field.limit);
  if ('problem' in result) throw invalid(result.problem === 'length' ? field.length : field.characters);
  return result.text;
}

function emailFrom(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : null;
  if (text === null || (text !== '' && !isPlausibleEmail(text))) {
    throw invalid('Enter an email address such as name@example.org, or leave it empty.');
  }
  return text;
}

function kindFrom(value: unknown): OrganizationKind {
  if (!isOrganizationKind(value)) throw invalid('Choose whether this organization is a business or a CBO.');
  return value;
}

function countryFrom(value: unknown): string {
  if (typeof value === 'string' && value.trim() === '') return DEFAULT_COUNTRY;
  const code = countryCode(value);
  if (!code) throw invalid('Enter the country as its two-letter code, such as US or CA.');
  return code;
}

// A part that is not given keeps its present value, so changing the city alone
// cannot blank the county.
function locationFrom(value: unknown, present: OrgLocation): OrgLocation {
  const given = asRecord(value);
  if (!given) throw invalid('Enter the location as a country, state or region, county and city.');
  const part = (key: keyof OrgLocation) => (given[key] === undefined ? present[key] : given[key]);
  return {
    country: countryFrom(part('country')),
    region: textFrom(part('region'), REGION),
    county: textFrom(part('county'), COUNTY),
    city: textFrom(part('city'), CITY),
  };
}

const sameLocation = (a: OrgLocation, b: OrgLocation) =>
  a.country === b.country && a.region === b.region && a.county === b.county && a.city === b.city;

const hasProfile = (file: IdentityFile): file is Loaded => file.profile !== null;

const isRefused = (access: Granted | Refused): access is Refused => 'code' in access;

const refuse = (refused: Refused) => new FundingError(refused.code, refused.message);

function membershipOf(file: Loaded, organizationId: string): Membership | undefined {
  return file.memberships.find((m) => m.organizationId === organizationId && m.userId === file.profile.id);
}

// The organization the user is working in. One they do not belong to is not
// theirs to work in, whatever was chosen before.
function activeIdOf(file: Loaded): string | null {
  const id = file.activeOrganizationId;
  return id !== null && membershipOf(file, id) ? id : null;
}

// There is one identity file, so there is one queue. Each change reads the
// latest state, applies itself and is saved before the next one starts, which
// is what stops two calls made at the same moment from undoing each other.
let tail: Promise<unknown> = Promise.resolve();

function inTurn<T>(task: () => Promise<T>): Promise<T> {
  const run = tail.then(task);
  tail = run.catch(() => {});
  return run;
}

// Organizations whose files are being removed. Nothing is authorized against
// one, so no new work starts in a directory that is on its way out.
const deleting = new Set<string>();

function accessTo(file: Loaded, organizationId: string | null): Granted | Refused {
  if (organizationId === null) {
    return { code: 'ORGANIZATION_NOT_FOUND', message: 'Create or choose an organization first.' };
  }
  const organization = file.organizations.find((o) => o.id === organizationId);
  if (!organization || deleting.has(organizationId)) {
    return {
      code: 'ORGANIZATION_NOT_FOUND',
      message: 'That organization could not be found. It may have been deleted.',
    };
  }
  const membership = membershipOf(file, organizationId);
  if (!membership) {
    return { code: 'MEMBERSHIP_NOT_FOUND', message: 'You are not a member of that organization.' };
  }
  if (membership.status !== 'active') {
    return {
      code: 'FORBIDDEN',
      message: 'Your access to this organization is suspended. Ask one of its owners to restore it.',
    };
  }
  return { organization, membership };
}

function decide(file: Loaded, permission: Permission, organizationId: string | null): Granted | Refused {
  const access = accessTo(file, organizationId);
  if (isRefused(access) || roleAllows(access.membership.role, permission)) return access;
  return {
    code: 'FORBIDDEN',
    message:
      `Your role in this organization, ${access.membership.role}, does not allow that. ` +
      'Ask one of its owners if you need more access.',
  };
}

function grant(file: Loaded, permission: Permission, organizationId: string): Granted {
  const decision = decide(file, permission, organizationId);
  if (isRefused(decision)) throw refuse(decision);
  return decision;
}

// The organization to fall back on when the active one is deleted: the one
// worked on most recently among those the user can still open.
function latestUsable(file: Loaded): Organization | null {
  let latest: Organization | null = null;
  for (const organization of file.organizations) {
    if (membershipOf(file, organization.id)?.status !== 'active') continue;
    if (!latest || organization.updatedAt >= latest.updatedAt) latest = organization;
  }
  return latest;
}

function without(file: Loaded, organizationId: string): Loaded {
  const next: Loaded = {
    ...file,
    organizations: file.organizations.filter((o) => o.id !== organizationId),
    memberships: file.memberships.filter((m) => m.organizationId !== organizationId),
  };
  // Deleting some other organization leaves the user where they are.
  if (file.activeOrganizationId !== organizationId) return next;
  return { ...next, activeOrganizationId: latestUsable(next)?.id ?? null };
}

const replaced = (file: Loaded, organization: Organization): Loaded => ({
  ...file,
  organizations: file.organizations.map((o) => (o.id === organization.id ? organization : o)),
});

export function createIdentityService(deps: IdentityDeps = {}): IdentityService {
  const provider = deps.provider ?? new LocalAuthProvider();
  const userName = deps.userName ?? (() => userInfo().username);
  const removeData = deps.removeOrganizationData ?? removeOrganizationData;

  const listeners = new Set<{ call: () => void }>();
  // One session for each run of the app, started the first time it is needed.
  let started: { id: string; userId: string; issuedAt: number } | null = null;

  function newProfile(): LocalProfile {
    let name = '';
    try {
      name = userName();
    } catch {
      // Some systems have no name for the account. The stand-in below covers it.
    }
    const now = Date.now();
    return {
      schemaVersion: 1,
      id: randomUUID(),
      displayName: tidy(name, LIMITS.displayName.max) || UNNAMED_USER,
      email: '',
      createdAt: now,
      updatedAt: now,
    };
  }

  // The stored state, with the profile created on first use. Only called from
  // inside the queue, so two first callers cannot each create a profile.
  async function stored(): Promise<Loaded> {
    const file = await readIdentity();
    if (hasProfile(file)) return file;
    const created: Loaded = { ...file, profile: newProfile() };
    await writeIdentity(created);
    return created;
  }

  async function current(): Promise<Loaded> {
    const file = await readIdentity();
    return hasProfile(file) ? file : inTurn(stored);
  }

  function sessionFor(file: Loaded): SessionInfo {
    // A session belongs to one user, so a different profile starts a new one.
    if (!started || started.userId !== file.profile.id) {
      started = { id: randomUUID(), userId: file.profile.id, issuedAt: Date.now() };
    }
    const organizationId = activeIdOf(file);
    const access = accessTo(file, organizationId);
    const role: OrgRole | null = isRefused(access) ? null : access.membership.role;
    return {
      id: started.id,
      userId: started.userId,
      organizationId,
      authMode: provider.mode,
      issuedAt: started.issuedAt,
      expiresAt: null,
      role,
      permissions: role ? permissionsFor(role) : [],
    };
  }

  // Only the user's own memberships, and only organizations they belong to.
  function stateOf(file: Loaded): IdentityState {
    const memberships = file.memberships.filter((m) => m.userId === file.profile.id);
    const mine = new Set(memberships.map((m) => m.organizationId));
    return {
      profile: file.profile,
      organizations: file.organizations.filter((o) => mine.has(o.id)),
      memberships,
      session: sessionFor(file),
    };
  }

  function notify(): void {
    for (const { call } of [...listeners]) {
      try {
        call();
      } catch (error) {
        console.error('[identity] a change listener failed', error);
      }
    }
  }

  // Runs one change against the latest stored state. `change` returns null
  // when there is nothing to do, and then nothing is saved or announced.
  function mutate(change: (file: Loaded) => Change | null): Promise<IdentityState> {
    return inTurn(async () => {
      const file = await stored();
      const result = change(file);
      if (!result) return stateOf(file);
      await writeIdentity(result.next);
      if (result.activity) {
        const { organizationId, action, detail } = result.activity;
        await recordActivity(organizationId, file.profile.id, action, detail);
      }
      notify();
      return stateOf(await stored());
    });
  }

  return {
    async getState() {
      return stateOf(await current());
    },

    async updateProfile(patch) {
      const given = asRecord(patch);
      if (!given) throw invalid('Enter a name or an email address to save.');
      const displayName = given.displayName === undefined ? null : textFrom(given.displayName, DISPLAY_NAME);
      const email = given.email === undefined ? null : emailFrom(given.email);
      return mutate((file) => {
        const profile: LocalProfile = {
          ...file.profile,
          displayName: displayName ?? file.profile.displayName,
          email: email ?? file.profile.email,
        };
        if (profile.displayName === file.profile.displayName && profile.email === file.profile.email) {
          return null;
        }
        return { next: { ...file, profile: { ...profile, updatedAt: Date.now() } } };
      });
    },

    async createOrganization(input) {
      const given = asRecord(input);
      if (!given) throw invalid('Enter a name for the organization and choose whether it is a business or a CBO.');
      const name = textFrom(given.name, ORGANIZATION_NAME);
      const kind = kindFrom(given.kind);
      const location = locationFrom(given.location ?? {}, NO_LOCATION);
      return mutate((file) => {
        const now = Date.now();
        const organization: Organization = {
          schemaVersion: 1,
          id: randomUUID(),
          name,
          kind,
          location,
          consents: { documentAnalysisAt: null, liveFundingSearchAt: null },
          createdAt: now,
          updatedAt: now,
        };
        const membership: Membership = {
          organizationId: organization.id,
          userId: file.profile.id,
          role: 'owner',
          status: 'active',
          createdAt: now,
          updatedAt: now,
        };
        return {
          next: {
            ...file,
            organizations: [...file.organizations, organization],
            memberships: [...file.memberships, membership],
            activeOrganizationId: organization.id,
          },
          activity: { organizationId: organization.id, action: 'organization_created', detail: name },
        };
      });
    },

    async updateOrganization(organizationId, patch) {
      const id = assertUuid(organizationId, 'organization');
      return mutate((file) => {
        // Checked here as well as by the caller, and against the organization
        // being changed rather than the active one. Permission comes before
        // the entry is looked at, so a refusal says nothing about the entry.
        const { organization } = grant(file, 'organization.manage', id);
        const given = asRecord(patch);
        if (!given) throw invalid('Choose what to change about the organization, then save again.');
        const next: Organization = {
          ...organization,
          name: given.name === undefined ? organization.name : textFrom(given.name, ORGANIZATION_NAME),
          kind: given.kind === undefined ? organization.kind : kindFrom(given.kind),
          location:
            given.location === undefined
              ? organization.location
              : locationFrom(given.location, organization.location),
        };
        const changed = [
          next.name !== organization.name ? 'name' : '',
          next.kind !== organization.kind ? 'type' : '',
          sameLocation(next.location, organization.location) ? '' : 'location',
        ].filter(Boolean);
        if (changed.length === 0) return null;
        const detail = changed.join(', ');
        return {
          next: replaced(file, { ...next, updatedAt: Date.now() }),
          activity: {
            organizationId: id,
            action: 'organization_updated',
            detail: detail.charAt(0).toUpperCase() + detail.slice(1),
          },
        };
      });
    },

    async switchOrganization(organizationId) {
      const id = assertUuid(organizationId, 'organization');
      return mutate((file) => {
        const access = accessTo(file, id);
        if (isRefused(access)) throw refuse(access);
        return file.activeOrganizationId === id ? null : { next: { ...file, activeOrganizationId: id } };
      });
    },

    async deleteOrganization(organizationId) {
      const id = assertUuid(organizationId, 'organization');
      return inTurn(async () => {
        const file = await stored();
        grant(file, 'organization.manage', id);
        // The files go first and the record of the organization last. If the
        // files cannot all be removed, the organization is still listed and
        // can be deleted again, rather than left on disk with no way to reach it.
        deleting.add(id);
        try {
          await closeActivity(id);
          try {
            await removeData(id);
          } catch (error) {
            console.error('[identity] the files of an organization could not be removed', error);
            throw new FundingError(
              'INTERNAL',
              "Some of this organization's files could not be removed, so it has not been deleted. " +
                'Close any of its documents that are open, then delete it again.',
            );
          }
          await writeIdentity(without(file, id));
        } catch (error) {
          reopenActivity(id);
          throw error;
        } finally {
          deleting.delete(id);
        }
        notify();
        return stateOf(await stored());
      });
    },

    async recordConsent(organizationId, consent) {
      const id = assertUuid(organizationId, 'organization');
      return mutate((file) => {
        const { organization } = grant(file, 'settings.manage', id);
        if (typeof consent !== 'string' || !Object.hasOwn(CONSENT_LABELS, consent)) {
          throw invalid('That is not a consent the app asks for.');
        }
        // The time someone first agreed is the fact worth keeping.
        if (organization.consents[consent] !== null) return null;
        const now = Date.now();
        return {
          next: replaced(file, {
            ...organization,
            consents: { ...organization.consents, [consent]: now },
            updatedAt: now,
          }),
          activity: { organizationId: id, action: 'consent_recorded', detail: CONSENT_LABELS[consent] },
        };
      });
    },

    async currentSession() {
      return sessionFor(await current());
    },

    async requireOrganization() {
      const file = await current();
      const access = accessTo(file, activeIdOf(file));
      if (isRefused(access)) throw refuse(access);
      return { session: sessionFor(file), organization: access.organization };
    },

    async can(permission, organizationId) {
      // A question, so an id that is not valid is answered with "no".
      if (organizationId !== undefined && !isUuid(organizationId)) return false;
      const file = await current();
      return !isRefused(decide(file, permission, organizationId ?? activeIdOf(file)));
    },

    async authorize(permission, organizationId) {
      const id = organizationId === undefined ? null : assertUuid(organizationId, 'organization');
      const file = await current();
      const decision = decide(file, permission, id ?? activeIdOf(file));
      if (isRefused(decision)) throw refuse(decision);
    },

    onChange(listener) {
      const entry = { call: listener };
      listeners.add(entry);
      return () => {
        listeners.delete(entry);
      };
    },
  };
}

export const identityService = createIdentityService();
