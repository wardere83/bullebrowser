import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ROLE_PERMISSIONS,
  type Membership,
  type NewOrganizationInput,
  type OrgActivity,
  type OrgRole,
  type Permission,
} from '../../shared/funding.js';
import type { IdentityDeps } from './service.js';

let userData: string;
vi.mock('electron', () => ({ app: { getPath: () => userData } }));

const { createIdentityService } = await import('./service.js');
const { LocalAuthProvider } = await import('./providers.js');
const { readIdentity, repairIdentity, writeIdentity } = await import('./store.js');
const { listActivity, recordActivity } = await import('./activity.js');
const { orgPath, organizationsRoot, readJson, removeOrganizationData, writeJson } = await import(
  '../funding/org-store.js'
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Noon UTC on 6 October 2026.
const T0 = Date.UTC(2026, 9, 6, 12, 0, 0);
const ROLES: OrgRole[] = ['owner', 'admin', 'member', 'viewer'];
const ALL_PERMISSIONS: readonly Permission[] = ROLE_PERMISSIONS.owner;

const identityFile = () => join(userData, 'identity.json');
const onDisk = () => JSON.parse(readFileSync(identityFile(), 'utf8')) as Record<string, unknown>;
const keptCopies = () => readdirSync(userData).filter((name) => name.startsWith('identity.json.before-repair-'));
const silenceErrors = () => vi.spyOn(console, 'error').mockImplementation(() => {});
const details = (entries: OrgActivity[]) => entries.map((entry) => entry.detail);

/** A service whose user has a known name, whatever account runs the tests. */
const service = (deps: IdentityDeps = {}) => createIdentityService({ userName: () => 'Dana Rivera', ...deps });

// A fictional CBO and a fictional business.
const cbo = (name = 'Northside Youth Alliance'): NewOrganizationInput => ({
  name,
  kind: 'cbo',
  location: { country: 'US', region: 'NJ', county: 'Essex', city: 'Newark' },
});
const business = (name = 'Harbor Light Bakery'): NewOrganizationInput => ({
  name,
  kind: 'business',
  location: { country: 'US', region: 'CA', county: 'Los Angeles', city: 'Los Angeles' },
});

/** Someone's active membership of an organization, as the store holds it. */
const membershipOf = (organizationId: string, userId: string, role: OrgRole): Membership => ({
  organizationId,
  userId,
  role,
  status: 'active',
  createdAt: T0,
  updatedAt: T0,
});

/** Creates an organization and returns its id. */
async function create(identity: ReturnType<typeof service>, input = cbo()): Promise<string> {
  return (await identity.createOrganization(input)).session.organizationId!;
}

/** The code and message a call is refused with. Fails if the call goes through. */
async function refusal(call: Promise<unknown>): Promise<{ code: string; message: string }> {
  let outcome: unknown;
  try {
    outcome = await call;
  } catch (error) {
    const { code, message } = error as { code: string; message: string };
    return { code, message };
  }
  throw new Error(`expected a refusal, got ${JSON.stringify(outcome)}`);
}

/** A message a person will read: a sentence, with nothing from inside the app in it. */
function expectPlain(message: string): void {
  expect(message).toMatch(/^[A-Z][^\n]*\.$/);
  expect(message.length).toBeLessThan(220);
  expect(message).not.toMatch(/undefined|null|NaN|\[object|Error|ENOENT|EISDIR|EBUSY|\.json|\/|\\|uuid|schema/i);
  expect(message).not.toContain(userData);
}

/**
 * Rewrites the local user's membership of one organization through the store,
 * the way a sign-in provider one day would. Null removes it.
 */
async function setMembership(
  organizationId: string,
  change: Partial<Pick<Membership, 'role' | 'status'>> | null,
): Promise<void> {
  const file = await readIdentity();
  const userId = file.profile!.id;
  const memberships = file.memberships.flatMap((membership) => {
    if (membership.organizationId !== organizationId || membership.userId !== userId) return [membership];
    return change ? [{ ...membership, ...change }] : [];
  });
  await writeIdentity({ ...file, memberships });
}

// Every data directory a test makes is removed when the test ends.
const made: string[] = [];
function newDataDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'bb-identity-'));
  made.push(directory);
  return directory;
}

beforeEach(() => {
  userData = newDataDirectory();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const directory of made.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('first run', () => {
  it('needs no configuration and creates a profile that is saved', async () => {
    const identity = service();
    expect(readdirSync(userData)).toEqual([]);

    const state = await identity.getState();
    expect(state.profile).toEqual({
      schemaVersion: 1,
      id: expect.stringMatching(UUID),
      displayName: 'Dana Rivera',
      email: '',
      createdAt: expect.any(Number),
      updatedAt: state.profile.createdAt,
    });
    expect(state.organizations).toEqual([]);
    expect(state.memberships).toEqual([]);
    expect(state.session).toEqual({
      id: expect.stringMatching(UUID),
      userId: state.profile.id,
      organizationId: null,
      authMode: 'local',
      issuedAt: expect.any(Number),
      expiresAt: null,
      role: null,
      permissions: [],
    });
    expect(Object.keys(state).sort()).toEqual(['memberships', 'organizations', 'profile', 'session']);

    expect(readdirSync(userData)).toEqual(['identity.json']);
    expect(onDisk()).toEqual({
      schemaVersion: 1,
      profile: state.profile,
      organizations: [],
      memberships: [],
      activeOrganizationId: null,
    });
    expect((await identity.getState()).profile).toEqual(state.profile);
  });

  it('touches nothing on disk until it is used', async () => {
    vi.resetModules();
    const fresh = await import('./service.js');
    fresh.createIdentityService();
    expect(typeof fresh.identityService.getState).toBe('function');
    expect(readdirSync(userData)).toEqual([]);
  });

  it('takes the name from the operating system', async () => {
    const { displayName } = (await createIdentityService().getState()).profile;
    expect(displayName.trim()).toBe(displayName);
    expect(Array.from(displayName).length).toBeGreaterThanOrEqual(1);
    expect(Array.from(displayName).length).toBeLessThanOrEqual(80);
  });

  it.each([
    [
      'the system has no name for the account',
      () => {
        throw new Error('no entry for this account');
      },
      'Local user',
    ],
    ['the name is blank', () => '   ', 'Local user'],
    ['the name is very long', () => 'n'.repeat(500), 'n'.repeat(80)],
    ['the name holds control characters', () => 'dana\u0000\nrivera', 'dana rivera'],
  ])('copes when %s', async (_label, userName, expected) => {
    const state = await createIdentityService({ userName }).getState();
    expect(state.profile.displayName).toBe(expected);
  });

  it('gives everyone who asks at the same moment the same profile', async () => {
    const one = service();
    const two = service();
    const [first, second, session, allowed] = await Promise.all([
      one.getState(),
      two.getState(),
      one.currentSession(),
      two.can('funding.read'),
    ]);
    expect(second.profile).toEqual(first.profile);
    expect(session.userId).toBe(first.profile.id);
    expect(allowed).toBe(false);
    expect(onDisk().profile).toEqual(first.profile);
  });
});

describe('the stores that were there before', () => {
  it('are left exactly as they were', async () => {
    const others = {
      'settings.json': '{"homepage":"https://example.org","aiPanelOpen":true}',
      'conversations.json': '{"conversations":[{"id":"c1","title":"Grant search","messages":[]}]}',
      'history.json': '{"entries":[{"url":"https://example.org/grants"}]}',
      'bookmarks.json': '{"bookmarks":[]}',
      'projects.json': '{"projects":[]}',
      'session-files.json': '{"files":[]}',
      'secrets.json': '{"apiKeyEncrypted":null,"keys":{}}',
    };
    for (const [name, content] of Object.entries(others)) writeFileSync(join(userData, name), content);

    const identity = service();
    const first = await create(identity, cbo());
    const second = await create(identity, business());
    await identity.updateProfile({ displayName: 'Dana R.', email: 'dana@northside.example' });
    await identity.updateOrganization(first, { name: 'Northside Alliance' });
    await identity.recordConsent(first, 'documentAnalysisAt');
    await identity.switchOrganization(first);
    await identity.deleteOrganization(second);

    for (const [name, content] of Object.entries(others)) {
      expect(readFileSync(join(userData, name), 'utf8')).toBe(content);
    }
    expect(readdirSync(userData).sort()).toEqual([...Object.keys(others), 'identity.json', 'organizations'].sort());
    // And nothing of theirs is carried into the identity file or the state.
    expect(readFileSync(identityFile(), 'utf8')).not.toMatch(/apiKey|conversations|homepage/);
  });
});

describe('after a restart', () => {
  it('restores the profile, the organizations and the active organization', async () => {
    const before = service();
    const first = await create(before, cbo());
    await create(before, business());
    const chosen = await before.switchOrganization(first);
    expect(chosen.session.organizationId).toBe(first);

    vi.resetModules();
    const { identityService } = await import('./service.js');
    const state = await identityService.getState();

    expect(state.profile).toEqual(chosen.profile);
    expect(state.organizations).toEqual(chosen.organizations);
    expect(state.memberships).toEqual(chosen.memberships);
    expect(state.session).toMatchObject({ organizationId: first, role: 'owner', userId: chosen.profile.id });
    // A new run is a new session.
    expect(state.session.id).not.toBe(chosen.session.id);
    expect((await identityService.requireOrganization()).organization.name).toBe('Northside Youth Alliance');
  });
});

describe('the profile', () => {
  it('saves a tidied name and email and leaves the rest alone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const identity = service();
    const before = (await identity.getState()).profile;
    expect(before).toMatchObject({ createdAt: T0, updatedAt: T0 });

    vi.setSystemTime(T0 + 5_000);
    const { profile } = await identity.updateProfile({
      displayName: '  Dana   M. Rivera ',
      email: ' dana@northside.example ',
    });
    expect(profile).toEqual({
      ...before,
      displayName: 'Dana M. Rivera',
      email: 'dana@northside.example',
      updatedAt: T0 + 5_000,
    });
    expect(onDisk().profile).toEqual(profile);

    expect((await identity.updateProfile({ email: '' })).profile).toMatchObject({
      displayName: 'Dana M. Rivera',
      email: '',
    });
    expect((await identity.updateProfile({ displayName: 'Dana' })).profile).toMatchObject({
      id: before.id,
      displayName: 'Dana',
      email: '',
    });
  });

  it('saves nothing when nothing would change', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const identity = service();
    await identity.getState();
    vi.setSystemTime(T0 + 5_000);
    expect((await identity.updateProfile({})).profile.updatedAt).toBe(T0);
    expect((await identity.updateProfile({ displayName: ' Dana Rivera ', email: '' })).profile.updatedAt).toBe(T0);
  });

  it.each([
    ['a single character', 'D'],
    ['exactly 80 characters', 'n'.repeat(80)],
    ['80 characters that each take two code units', '\u{1F600}'.repeat(80)],
    ['a name that needs a joiner between its letters', '\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645'],
    ['an accented name', 'Jos\u00e9 Mu\u00f1oz'],
  ])('accepts %s as a name', async (_label, displayName) => {
    expect((await service().updateProfile({ displayName })).profile.displayName).toBe(displayName);
  });

  it('stores one spelling of an accented name however it was typed', async () => {
    const identity = service();
    const { profile } = await identity.updateProfile({ displayName: 'Jose\u0301 Mun\u0303oz' });
    expect(profile.displayName).toBe('Jos\u00e9 Mu\u00f1oz');
    // And counts each accented letter once, so 80 of them typed in two parts still fit.
    const long = await identity.updateProfile({ displayName: 'e\u0301'.repeat(80) });
    expect(long.profile.displayName).toBe('\u00e9'.repeat(80));
  });

  it.each([
    ['an empty name', { displayName: '' }],
    ['a name of spaces', { displayName: '   ' }],
    ['a name of 81 characters', { displayName: 'n'.repeat(81) }],
    ['a name with a line break in it', { displayName: 'Dana\nRivera' }],
    ['a name with a control character', { displayName: 'Dana\u0007' }],
    ['a name with a hidden direction override', { displayName: 'Dana\u202eareviR' }],
    ['a name with half of a broken character', { displayName: 'Dana\ud83d' }],
    ['a name that is not text', { displayName: 42 }],
    ['a name that is null', { displayName: null }],
    ['an address with no domain', { email: 'dana' }],
    ['an address with no dot in its domain', { email: 'dana@northside' }],
    ['an address with a space', { email: 'dana rivera@northside.example' }],
    ['an address with a control character', { email: 'dana\u0007@northside.example' }],
    ['an address with a hidden direction override', { email: 'dana@northside.\u202eelpmaxe' }],
    ['two addresses', { email: 'dana@northside.example,sam@northside.example' }],
    ['an address with an empty part in its domain', { email: 'dana@northside..example' }],
    ['an address longer than 254 characters', { email: `${'d'.repeat(60)}@${'n'.repeat(190)}.example` }],
    ['an address with more than 64 characters before the @', { email: `${'d'.repeat(65)}@northside.example` }],
    ['an address that is not text', { email: ['dana@northside.example'] }],
    ['a patch that is not an object', 'Dana'],
    ['no patch', undefined],
  ])('refuses %s with a plain message and saves nothing', async (_label, patch) => {
    const identity = service();
    const before = (await identity.getState()).profile;
    const { code, message } = await refusal(identity.updateProfile(patch as never));
    expect(code).toBe('INVALID_INPUT');
    expectPlain(message);
    expect((await identity.getState()).profile).toEqual(before);
    expect(onDisk().profile).toEqual(before);
  });

  it('says what a name or an address has to look like', async () => {
    const identity = service();
    const message = async (patch: unknown) => (await refusal(identity.updateProfile(patch as never))).message;
    expect(await message({ displayName: '' })).toBe('Enter a name between 1 and 80 characters long.');
    expect(await message({ displayName: 'Dana\nRivera' })).toBe(
      'Your name contains characters that cannot be used, such as line breaks. Type it again without them.',
    );
    expect(await message({ email: 'dana@northside' })).toBe(
      'Enter an email address such as name@example.org, or leave it empty.',
    );
  });
});

describe('creating an organization', () => {
  it('makes the creator its owner and makes it the active organization', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const identity = service();
    const state = await identity.createOrganization({
      name: '  Northside   Youth Alliance ',
      kind: 'cbo',
      location: { country: ' us ', region: ' NJ ', county: 'Essex', city: 'Newark' },
    });

    expect(state.organizations).toEqual([
      {
        schemaVersion: 1,
        id: expect.stringMatching(UUID),
        name: 'Northside Youth Alliance',
        kind: 'cbo',
        location: { country: 'US', region: 'NJ', county: 'Essex', city: 'Newark' },
        consents: { documentAnalysisAt: null, liveFundingSearchAt: null },
        createdAt: T0,
        updatedAt: T0,
      },
    ]);
    const id = state.organizations[0]!.id;
    expect(state.memberships).toEqual([
      { organizationId: id, userId: state.profile.id, role: 'owner', status: 'active', createdAt: T0, updatedAt: T0 },
    ]);
    expect(state.session).toMatchObject({ organizationId: id, role: 'owner' });
    expect([...state.session.permissions].sort()).toEqual([...ALL_PERMISSIONS].sort());
    expect(state.session.permissions).toHaveLength(12);

    expect(onDisk()).toMatchObject({ organizations: state.organizations, activeOrganizationId: id });
    expect(await listActivity(id)).toMatchObject([
      { action: 'organization_created', actorId: state.profile.id, detail: 'Northside Youth Alliance', at: T0 },
    ]);
  });

  it('assumes the United States when no country is given and leaves the rest empty', async () => {
    const identity = service();
    for (const location of [undefined, null, {}, { country: '' }, { country: '  ', city: 'Newark' }]) {
      const input = { name: 'Northside Youth Alliance', kind: 'cbo', location };
      const state = await identity.createOrganization(input as never);
      expect(state.organizations.at(-1)!.location).toEqual({
        country: 'US',
        region: '',
        county: '',
        city: location && 'city' in location ? 'Newark' : '',
      });
    }
  });

  it.each([
    ['a name of two characters', { ...cbo(), name: 'NY' }],
    ['a name of 120 characters', { ...cbo(), name: 'n'.repeat(120) }],
    [
      'the longest place names',
      { ...cbo(), location: { country: 'ca', region: 'r'.repeat(60), county: 'c'.repeat(80), city: 'c'.repeat(80) } },
    ],
    ['a business', business()],
  ])('accepts %s', async (_label, input) => {
    const state = await service().createOrganization(input);
    expect(state.organizations[0]).toMatchObject({
      name: input.name,
      kind: input.kind,
      location: { ...input.location, country: input.location.country.toUpperCase() },
    });
  });

  it.each([
    ['a one-letter name', { ...cbo(), name: 'N' }],
    ['a name of 121 characters', { ...cbo(), name: 'n'.repeat(121) }],
    ['a name with a line break in it', { ...cbo(), name: 'Northside\nYouth Alliance' }],
    ['a name with a hidden direction override', { ...cbo(), name: 'Northside\u202eecnaillA' }],
    ['a name that is not text', { ...cbo(), name: { toString: (): string => 'Northside' } }],
    ['a name a million characters long', { ...cbo(), name: 'n'.repeat(1_000_000) }],
    ['no name', { kind: 'cbo', location: cbo().location }],
    ['an unknown kind', { ...cbo(), kind: 'nonprofit' }],
    ['a kind in capitals', { ...cbo(), kind: 'CBO' }],
    ['an inherited word as the kind', { ...cbo(), kind: 'constructor' }],
    ['no kind', { name: 'Northside Youth Alliance', location: cbo().location }],
    ['a three-letter country', { ...cbo(), location: { ...cbo().location, country: 'USA' } }],
    ['a country written in digits', { ...cbo(), location: { ...cbo().location, country: '12' } }],
    ['a country with an accented letter', { ...cbo(), location: { ...cbo().location, country: '\u00dcS' } }],
    ['a country that is not text', { ...cbo(), location: { ...cbo().location, country: 840 } }],
    ['a region of 61 characters', { ...cbo(), location: { ...cbo().location, region: 'r'.repeat(61) } }],
    ['a county of 81 characters', { ...cbo(), location: { ...cbo().location, county: 'c'.repeat(81) } }],
    ['a city of 81 characters', { ...cbo(), location: { ...cbo().location, city: 'c'.repeat(81) } }],
    ['a city with a line break in it', { ...cbo(), location: { ...cbo().location, city: 'New\nark' } }],
    ['a region that is not text', { ...cbo(), location: { ...cbo().location, region: 7 } }],
    ['a location that is not an object', { ...cbo(), location: 'Newark, NJ' }],
    ['a location that is a list', { ...cbo(), location: ['US', 'NJ'] }],
    ['input that is not an object', 'Northside Youth Alliance'],
    ['no input', undefined],
  ])('refuses %s with a plain message and creates nothing', async (_label, input) => {
    const identity = service();
    const { code, message } = await refusal(identity.createOrganization(input as never));
    expect(code).toBe('INVALID_INPUT');
    expectPlain(message);
    const state = await identity.getState();
    expect(state.organizations).toEqual([]);
    expect(state.session.organizationId).toBeNull();
    expect(existsSync(organizationsRoot())).toBe(false);
  });

  it('says which entry is wrong and how to put it right', async () => {
    const identity = service();
    const message = async (input: unknown) => (await refusal(identity.createOrganization(input as never))).message;
    const at = (location: object) => ({ ...cbo(), location: { ...cbo().location, ...location } });
    expect(await message({ ...cbo(), name: 'N' })).toBe(
      'Enter an organization name between 2 and 120 characters long.',
    );
    expect(await message({ ...cbo(), name: 'North\nside' })).toBe(
      'The organization name contains characters that cannot be used, such as line breaks. Type it again without them.',
    );
    expect(await message({ ...cbo(), kind: 'charity' })).toBe(
      'Choose whether this organization is a business or a CBO.',
    );
    expect(await message(at({ country: 'USA' }))).toBe('Enter the country as its two-letter code, such as US or CA.');
    expect(await message(at({ region: 'r'.repeat(61) }))).toBe('Keep the state or region to 60 characters or fewer.');
    expect(await message(at({ county: 'c'.repeat(81) }))).toBe('Keep the county to 80 characters or fewer.');
    expect(await message(at({ city: 'c'.repeat(81) }))).toBe('Keep the city to 80 characters or fewer.');
    expect(await message(at({ city: 'New\u0000ark' }))).toBe(
      'The city contains characters that cannot be used, such as line breaks. Type it again without them.',
    );
  });

  it('keeps every organization when many are created at the same moment', async () => {
    const identity = service();
    const names = Array.from({ length: 25 }, (_, n) => `Organization ${String(n + 1).padStart(2, '0')}`);
    const results = await Promise.all(names.map((name) => identity.createOrganization(cbo(name))));

    const state = await identity.getState();
    expect(state.organizations.map((organization) => organization.name)).toEqual(names);
    expect(new Set(state.organizations.map((organization) => organization.id)).size).toBe(25);
    expect(state.memberships).toHaveLength(25);
    expect(state.memberships.every((m) => m.role === 'owner' && m.status === 'active')).toBe(true);
    // Each call saw the ones made before it, and the last one made is active.
    expect(results.map((result) => result.organizations.length)).toEqual(names.map((_, n) => n + 1));
    expect(state.session.organizationId).toBe(state.organizations.at(-1)!.id);
    expect((onDisk().organizations as unknown[]).length).toBe(25);
    for (const organization of state.organizations) {
      expect(details(await listActivity(organization.id))).toEqual([organization.name]);
    }
  });

  it('loses nothing when different changes are made at the same moment, even through two services', async () => {
    const one = service();
    const two = service();
    const id = await create(one);
    await Promise.all([
      one.updateProfile({ displayName: 'Dana R.' }),
      two.createOrganization(business()),
      one.recordConsent(id, 'documentAnalysisAt'),
      two.updateOrganization(id, { name: 'Northside Alliance' }),
      one.recordConsent(id, 'liveFundingSearchAt'),
      two.updateProfile({ email: 'dana@northside.example' }),
    ]);

    const state = await two.getState();
    expect(state.profile).toMatchObject({ displayName: 'Dana R.', email: 'dana@northside.example' });
    expect(state.organizations.map((organization) => organization.name)).toEqual([
      'Northside Alliance',
      'Harbor Light Bakery',
    ]);
    const { consents } = state.organizations[0]!;
    expect(consents.documentAnalysisAt).toEqual(expect.any(Number));
    expect(consents.liveFundingSearchAt).toEqual(expect.any(Number));
    expect(onDisk()).toMatchObject({ profile: state.profile, organizations: state.organizations });
  });
});

describe('changing an organization', () => {
  it('changes only what is given and notes what changed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const identity = service();
    const id = await create(identity);

    vi.setSystemTime(T0 + 1_000);
    const renamed = (await identity.updateOrganization(id, { name: ' Northside Alliance ' })).organizations[0]!;
    expect(renamed).toMatchObject({
      id,
      name: 'Northside Alliance',
      kind: 'cbo',
      location: cbo().location,
      createdAt: T0,
      updatedAt: T0 + 1_000,
    });

    vi.setSystemTime(T0 + 2_000);
    const moved = (
      await identity.updateOrganization(id, { kind: 'business', location: { city: 'Trenton', county: '' } } as never)
    ).organizations[0]!;
    // The country and the region were not mentioned, so they stay.
    expect(moved).toMatchObject({
      name: 'Northside Alliance',
      kind: 'business',
      location: { country: 'US', region: 'NJ', county: '', city: 'Trenton' },
      updatedAt: T0 + 2_000,
    });
    expect(onDisk().organizations).toEqual([moved]);

    expect(await listActivity(id)).toMatchObject([
      { action: 'organization_updated', detail: 'Type, location', at: T0 + 2_000 },
      { action: 'organization_updated', detail: 'Name', at: T0 + 1_000 },
      { action: 'organization_created', detail: 'Northside Youth Alliance', at: T0 },
    ]);
  });

  it('saves and notes nothing when nothing would change', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const identity = service();
    const id = await create(identity);
    vi.setSystemTime(T0 + 1_000);
    const same = [
      {},
      { name: ' Northside Youth Alliance ' },
      { name: 'Northside   Youth\u00a0 Alliance' },
      { kind: 'cbo' },
      { location: { country: 'us' } },
      { location: { city: ' Newark ' } },
      cbo(),
    ];
    for (const patch of same) {
      const state = await identity.updateOrganization(id, patch as never);
      expect(state.organizations[0]!.updatedAt).toBe(T0);
    }
    expect(await listActivity(id)).toHaveLength(1);

    // The same name typed with its accent as a separate character is the same name.
    const cafe = await create(identity, business('Caf\u00e9 de la Paix'));
    vi.setSystemTime(T0 + 2_000);
    const state = await identity.updateOrganization(cafe, { name: 'Cafe\u0301 de la Paix' });
    expect(state.organizations[1]).toMatchObject({ name: 'Caf\u00e9 de la Paix', updatedAt: T0 + 1_000 });
    expect(await listActivity(cafe)).toHaveLength(1);
  });

  it.each([
    ['a name that is too short', { name: 'N' }],
    ['a name with a line break in it', { name: 'North\nside' }],
    ['a name that is null', { name: null }],
    ['an unknown kind', { kind: 'charity' }],
    ['a country that is not a code', { location: { country: 'United States' } }],
    ['a city that is too long', { location: { city: 'c'.repeat(81) } }],
    ['a location that is not an object', { location: 'Trenton' }],
    ['a patch that is not an object', 'Northside Alliance'],
    ['no patch', undefined],
  ])('refuses %s and leaves the organization as it was', async (_label, patch) => {
    const identity = service();
    const id = await create(identity);
    const before = (await identity.getState()).organizations;
    const { code, message } = await refusal(identity.updateOrganization(id, patch as never));
    expect(code).toBe('INVALID_INPUT');
    expectPlain(message);
    expect((await identity.getState()).organizations).toEqual(before);
    expect(onDisk().organizations).toEqual(before);
    expect(await listActivity(id)).toHaveLength(1);
  });

  it('refuses an id that is not valid or that names no organization', async () => {
    const identity = service();
    const id = await create(identity);
    for (const bad of ['', '..', `../${id}`, 'not-a-uuid', `${id} `, 42, null, undefined]) {
      expect(await refusal(identity.updateOrganization(bad as never, { name: 'Renamed' }))).toEqual({
        code: 'INVALID_INPUT',
        message: 'That organization is not valid.',
      });
    }
    const missing = await refusal(identity.updateOrganization(randomUUID(), { name: 'Renamed' }));
    expect(missing.code).toBe('ORGANIZATION_NOT_FOUND');
    expectPlain(missing.message);
    expect((await identity.getState()).organizations[0]!.name).toBe('Northside Youth Alliance');
  });
});

describe('switching organization', () => {
  it('moves the session to the chosen organization and saves the choice', async () => {
    const identity = service();
    const first = await create(identity, cbo());
    const second = await create(identity, business());
    expect((await identity.currentSession()).organizationId).toBe(second);

    const state = await identity.switchOrganization(first);
    expect(state.session).toMatchObject({ organizationId: first, role: 'owner' });
    expect(onDisk().activeOrganizationId).toBe(first);
    expect((await identity.requireOrganization()).organization.id).toBe(first);

    // Choosing it again is not an error and changes nothing.
    expect((await identity.switchOrganization(first)).session.organizationId).toBe(first);
    expect((await identity.switchOrganization(second)).session.organizationId).toBe(second);
  });

  it('is refused for an id that is not valid', async () => {
    const identity = service();
    const first = await create(identity, cbo());
    const second = await create(identity, business());
    const invalid = ['', '..', `../${first}`, `${second}/../${first}`, 'not-a-uuid', `${first} `, '/etc', 42, null, {}];
    for (const bad of invalid) {
      expect(await refusal(identity.switchOrganization(bad as never))).toEqual({
        code: 'INVALID_INPUT',
        message: 'That organization is not valid.',
      });
    }
    expect((await identity.currentSession()).organizationId).toBe(second);
    expect(onDisk().activeOrganizationId).toBe(second);
  });

  it('is refused for an organization that does not exist, however its id is spelled', async () => {
    const identity = service();
    // An id with letters in it, so that spelling it in capitals changes it.
    const lettered = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    await create(identity);
    const file = await readIdentity();
    await writeIdentity({
      ...file,
      organizations: [...file.organizations, { ...file.organizations[0]!, id: lettered }],
      memberships: [...file.memberships, { ...file.memberships[0]!, organizationId: lettered }],
    });
    expect((await identity.switchOrganization(lettered)).session.organizationId).toBe(lettered);

    for (const id of [randomUUID(), lettered.toUpperCase()]) {
      const { code, message } = await refusal(identity.switchOrganization(id));
      expect(code).toBe('ORGANIZATION_NOT_FOUND');
      expectPlain(message);
    }
    expect((await identity.currentSession()).organizationId).toBe(lettered);
  });

  it('is refused without a membership', async () => {
    const identity = service();
    const mine = await create(identity);
    const file = await readIdentity();
    const theirs = { ...file.organizations[0]!, id: randomUUID(), name: 'Riverbend Housing Trust' };
    await writeIdentity({
      ...file,
      organizations: [...file.organizations, theirs],
      memberships: [...file.memberships, membershipOf(theirs.id, randomUUID(), 'owner')],
    });

    expect(await refusal(identity.switchOrganization(theirs.id))).toEqual({
      code: 'MEMBERSHIP_NOT_FOUND',
      message: 'You are not a member of that organization.',
    });
    expect((await identity.currentSession()).organizationId).toBe(mine);
    expect(onDisk().activeOrganizationId).toBe(mine);
  });

  it('is refused when the membership is suspended', async () => {
    const identity = service();
    const suspended = await create(identity, cbo());
    const open = await create(identity, business());
    await setMembership(suspended, { status: 'suspended' });

    const { code, message } = await refusal(identity.switchOrganization(suspended));
    expect(code).toBe('FORBIDDEN');
    expect(message).toMatch(/suspended/);
    expectPlain(message);
    expect((await identity.currentSession()).organizationId).toBe(open);
    expect(onDisk().activeOrganizationId).toBe(open);
  });
});

describe('roles', () => {
  it.each(ROLES)('answers every permission question for the %s role from the shared table', async (role) => {
    const identity = service();
    const id = await create(identity);
    await setMembership(id, { role });

    const session = await identity.currentSession();
    expect(session.role).toBe(role);
    expect([...session.permissions].sort()).toEqual([...ROLE_PERMISSIONS[role]].sort());

    for (const permission of ALL_PERMISSIONS) {
      const allowed = ROLE_PERMISSIONS[role].includes(permission);
      expect(await identity.can(permission)).toBe(allowed);
      expect(await identity.can(permission, id)).toBe(allowed);
      if (allowed) {
        await expect(identity.authorize(permission)).resolves.toBeUndefined();
      } else {
        const { code, message } = await refusal(identity.authorize(permission, id));
        expect(code).toBe('FORBIDDEN');
        expect(message).toContain(role);
        expectPlain(message);
      }
    }
  });

  it('draws the lines where the product says they are', async () => {
    const identity = service();
    const id = await create(identity);
    const can = async (role: OrgRole, permission: Permission) => {
      await setMembership(id, { role });
      return identity.can(permission);
    };
    expect(await can('viewer', 'knowledge.read')).toBe(true);
    expect(await can('viewer', 'knowledge.manage')).toBe(false);
    expect(await can('viewer', 'funding.manage')).toBe(false);
    expect(await can('member', 'knowledge.manage')).toBe(true);
    expect(await can('member', 'profile.approve')).toBe(false);
    expect(await can('member', 'audit.read')).toBe(false);
    expect(await can('admin', 'profile.approve')).toBe(true);
    expect(await can('admin', 'organization.manage')).toBe(false);
    expect(await can('owner', 'organization.manage')).toBe(true);
  });

  it('lets only an owner rename or delete, and only an owner or admin record a consent', async () => {
    const identity = service();
    const id = await create(identity);
    await writeJson(orgPath(id, 'knowledge', 'documents.json'), { documents: ['plan.pdf'] });

    for (const role of ['admin', 'member', 'viewer'] as const) {
      await setMembership(id, { role });
      expect((await refusal(identity.updateOrganization(id, { name: 'Renamed' }))).code).toBe('FORBIDDEN');
      expect((await refusal(identity.deleteOrganization(id))).code).toBe('FORBIDDEN');
      // Permission is checked before the entry itself, so a refusal says nothing about the entry.
      expect((await refusal(identity.updateOrganization(id, { name: '' }))).code).toBe('FORBIDDEN');
      expect((await refusal(identity.updateOrganization(id, 'Renamed' as never))).code).toBe('FORBIDDEN');
    }
    for (const role of ['member', 'viewer'] as const) {
      await setMembership(id, { role });
      expect((await refusal(identity.recordConsent(id, 'documentAnalysisAt'))).code).toBe('FORBIDDEN');
      expect((await refusal(identity.recordConsent(id, 'everythingAt' as never))).code).toBe('FORBIDDEN');
    }
    const untouched = (await identity.getState()).organizations[0]!;
    expect(untouched).toMatchObject({ name: 'Northside Youth Alliance', consents: { documentAnalysisAt: null } });
    expect(await readJson(orgPath(id, 'knowledge', 'documents.json'), null)).toEqual({ documents: ['plan.pdf'] });

    await setMembership(id, { role: 'admin' });
    const agreed = await identity.recordConsent(id, 'documentAnalysisAt');
    expect(agreed.organizations[0]!.consents.documentAnalysisAt).toEqual(expect.any(Number));
  });

  it('refuses everything while a membership is suspended', async () => {
    const identity = service();
    const id = await create(identity);
    await setMembership(id, { status: 'suspended' });

    const state = await identity.getState();
    // Still listed, so the person can be told why it will not open.
    expect(state.organizations.map((organization) => organization.id)).toEqual([id]);
    expect(state.memberships).toMatchObject([{ organizationId: id, role: 'owner', status: 'suspended' }]);
    expect(state.session).toMatchObject({ organizationId: id, role: null, permissions: [] });

    for (const permission of ALL_PERMISSIONS) {
      expect(await identity.can(permission)).toBe(false);
      expect((await refusal(identity.authorize(permission))).code).toBe('FORBIDDEN');
    }
    const calls = [
      identity.requireOrganization(),
      identity.updateOrganization(id, { name: 'Renamed' }),
      identity.recordConsent(id, 'liveFundingSearchAt'),
      identity.deleteOrganization(id),
      identity.switchOrganization(id),
    ];
    for (const call of calls) {
      const { code, message } = await refusal(call);
      expect(code).toBe('FORBIDDEN');
      expect(message).toBe('Your access to this organization is suspended. Ask one of its owners to restore it.');
    }
    expect((await identity.getState()).organizations[0]!.name).toBe('Northside Youth Alliance');
  });

  it('treats an organization the user no longer belongs to as not chosen', async () => {
    const identity = service();
    const id = await create(identity);
    await setMembership(id, null);

    const state = await identity.getState();
    expect(state.organizations).toEqual([]);
    expect(state.memberships).toEqual([]);
    expect(state.session).toMatchObject({ organizationId: null, role: null, permissions: [] });
    expect(await identity.can('organization.read')).toBe(false);
    expect(await identity.can('organization.read', id)).toBe(false);
    expect(await refusal(identity.requireOrganization())).toEqual({
      code: 'ORGANIZATION_NOT_FOUND',
      message: 'Create or choose an organization first.',
    });
    expect((await refusal(identity.authorize('organization.read'))).code).toBe('ORGANIZATION_NOT_FOUND');
    for (const call of [
      identity.authorize('organization.read', id),
      identity.updateOrganization(id, { name: 'Renamed' }),
      identity.deleteOrganization(id),
      identity.recordConsent(id, 'documentAnalysisAt'),
    ]) {
      expect((await refusal(call)).code).toBe('MEMBERSHIP_NOT_FOUND');
    }
    expect((onDisk().organizations as unknown[]).length).toBe(1);
  });

  it('checks the organization that is named, not the one that happens to be active', async () => {
    const identity = service();
    const watched = await create(identity, cbo());
    const owned = await create(identity, business());
    await setMembership(watched, { role: 'viewer' });
    await writeJson(orgPath(watched, 'knowledge', 'documents.json'), { documents: ['plan.pdf'] });

    expect((await identity.currentSession()).organizationId).toBe(owned);
    expect(await identity.can('organization.manage')).toBe(true);
    expect(await identity.can('organization.manage', watched)).toBe(false);
    expect(await identity.can('knowledge.read', watched)).toBe(true);
    await expect(identity.authorize('knowledge.read', watched)).resolves.toBeUndefined();
    expect((await refusal(identity.authorize('knowledge.manage', watched))).code).toBe('FORBIDDEN');

    // Being the owner of the active organization is no licence to change another.
    expect((await refusal(identity.updateOrganization(watched, { name: 'Renamed' }))).code).toBe('FORBIDDEN');
    expect((await refusal(identity.recordConsent(watched, 'documentAnalysisAt'))).code).toBe('FORBIDDEN');
    expect((await refusal(identity.deleteOrganization(watched))).code).toBe('FORBIDDEN');
    expect(existsSync(orgPath(watched, 'knowledge', 'documents.json'))).toBe(true);
  });

  it('answers no to a question it cannot place, and says why when asked to authorize', async () => {
    const identity = service();
    expect(await identity.can('funding.read')).toBe(false);
    expect(await refusal(identity.authorize('funding.read'))).toEqual({
      code: 'ORGANIZATION_NOT_FOUND',
      message: 'Create or choose an organization first.',
    });

    const id = await create(identity);
    for (const bad of ['', '..', `../${id}`, 'not-a-uuid', `${id} `, 42, null, {}]) {
      expect(await identity.can('funding.read', bad as never)).toBe(false);
      expect(await refusal(identity.authorize('funding.read', bad as never))).toEqual({
        code: 'INVALID_INPUT',
        message: 'That organization is not valid.',
      });
    }
    const unknown = randomUUID();
    expect(await identity.can('funding.read', unknown)).toBe(false);
    expect((await refusal(identity.authorize('funding.read', unknown))).code).toBe('ORGANIZATION_NOT_FOUND');

    for (const made of ['everything', '', 'organization.*', 'constructor', undefined, null, 7]) {
      expect(await identity.can(made as never)).toBe(false);
      expect((await refusal(identity.authorize(made as never))).code).toBe('FORBIDDEN');
    }
    expect(await identity.can('funding.read')).toBe(true);
  });
});

describe('the organization to work in', () => {
  it('has to be created or chosen first', async () => {
    expect(await refusal(service().requireOrganization())).toEqual({
      code: 'ORGANIZATION_NOT_FOUND',
      message: 'Create or choose an organization first.',
    });
  });

  it('comes with the session it belongs to', async () => {
    const identity = service();
    const id = await create(identity);
    const { session, organization } = await identity.requireOrganization();
    expect(organization).toMatchObject({ id, name: 'Northside Youth Alliance', kind: 'cbo' });
    expect(session).toEqual(await identity.currentSession());
    expect(session).toMatchObject({ organizationId: id, role: 'owner' });
  });
});

describe('the session', () => {
  it('is one for each run of the app, whichever organization is active', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const identity = service();
    const first = await identity.currentSession();
    expect(first).toMatchObject({ issuedAt: T0, expiresAt: null, authMode: 'local', organizationId: null });

    vi.setSystemTime(T0 + 60_000);
    const one = await create(identity, cbo());
    const two = await create(identity, business());
    const switched = (await identity.switchOrganization(one)).session;
    expect(switched).toMatchObject({ id: first.id, userId: first.userId, issuedAt: T0, organizationId: one });
    expect((await identity.switchOrganization(two)).session.id).toBe(first.id);
    expect((await identity.getState()).session.id).toBe(first.id);

    const another = await service().currentSession();
    expect(another.id).not.toBe(first.id);
    expect(another).toMatchObject({ userId: first.userId, issuedAt: T0 + 60_000, organizationId: two });
  });

  it('is local, with no account behind it and nothing to sign out of', async () => {
    const provider = new LocalAuthProvider();
    expect(provider.describe()).toEqual({
      id: 'local',
      mode: 'local',
      label: 'This device',
      detail: expect.any(String),
      canSignOut: false,
    });
    expectPlain(provider.describe().detail);

    const identity = service({ provider });
    const id = await create(identity);
    const before = readFileSync(identityFile(), 'utf8');
    await expect(provider.signOut()).resolves.toBeUndefined();
    expect(readFileSync(identityFile(), 'utf8')).toBe(before);
    expect(await identity.currentSession()).toMatchObject({ authMode: 'local', expiresAt: null, organizationId: id });
  });

  it('belongs to one person: a different profile gets a session of its own', async () => {
    const identity = service();
    const first = await identity.currentSession();
    // Another data directory stands in for another person at the same service.
    userData = newDataDirectory();
    const second = await identity.currentSession();
    expect(second.userId).not.toBe(first.userId);
    expect(second.id).not.toBe(first.id);
    expect((await identity.currentSession()).id).toBe(second.id);
  });

  it('takes its mode from whichever provider it is given', async () => {
    const identity = service({
      provider: {
        id: 'directory',
        mode: 'oidc',
        describe: () => ({ id: 'directory', mode: 'oidc', label: 'Work account', detail: '', canSignOut: true }),
        signOut: async () => {},
      },
    });
    expect((await identity.currentSession()).authMode).toBe('oidc');
    // Whoever identifies the user, the roles are enforced the same way.
    const id = await create(identity);
    await setMembership(id, { role: 'viewer' });
    expect(await identity.can('knowledge.manage')).toBe(false);
  });
});

describe('consents', () => {
  it('are recorded once, with the time of the first acknowledgement', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const identity = service();
    const id = await create(identity);

    vi.setSystemTime(T0 + 1_000);
    const first = (await identity.recordConsent(id, 'documentAnalysisAt')).organizations[0]!;
    expect(first).toMatchObject({
      consents: { documentAnalysisAt: T0 + 1_000, liveFundingSearchAt: null },
      updatedAt: T0 + 1_000,
    });

    vi.setSystemTime(T0 + 2_000);
    const again = (await identity.recordConsent(id, 'documentAnalysisAt')).organizations[0]!;
    expect(again).toEqual(first);

    vi.setSystemTime(T0 + 3_000);
    const both = (await identity.recordConsent(id, 'liveFundingSearchAt')).organizations[0]!;
    expect(both.consents).toEqual({ documentAnalysisAt: T0 + 1_000, liveFundingSearchAt: T0 + 3_000 });
    expect(onDisk().organizations).toEqual([both]);

    expect(await listActivity(id)).toMatchObject([
      { action: 'consent_recorded', detail: 'Live funding search', at: T0 + 3_000 },
      { action: 'consent_recorded', detail: 'Document analysis', at: T0 + 1_000 },
      { action: 'organization_created' },
    ]);
  });

  it('belong to one organization and are not carried to another', async () => {
    const identity = service();
    const agreed = await create(identity, cbo());
    const other = await create(identity, business());
    const state = await identity.recordConsent(agreed, 'liveFundingSearchAt');
    const consentsOf = (id: string) => state.organizations.find((organization) => organization.id === id)!.consents;
    expect(consentsOf(agreed).liveFundingSearchAt).toEqual(expect.any(Number));
    expect(consentsOf(other)).toEqual({ documentAnalysisAt: null, liveFundingSearchAt: null });
  });

  it('refuses a consent the app does not ask for', async () => {
    const identity = service();
    const id = await create(identity);
    for (const consent of ['everythingAt', '', 'documentAnalysis', '__proto__', 'constructor', undefined, null, 3]) {
      const { code, message } = await refusal(identity.recordConsent(id, consent as never));
      expect(code).toBe('INVALID_INPUT');
      expectPlain(message);
    }
    expect((await identity.getState()).organizations[0]!.consents).toEqual({
      documentAnalysisAt: null,
      liveFundingSearchAt: null,
    });
    expect((await refusal(identity.recordConsent('nope', 'documentAnalysisAt'))).code).toBe('INVALID_INPUT');
    expect((await refusal(identity.recordConsent(randomUUID(), 'documentAnalysisAt'))).code).toBe(
      'ORGANIZATION_NOT_FOUND',
    );
  });
});

describe('deleting an organization', () => {
  it('removes exactly its directory and leaves every other file intact', async () => {
    const identity = service();
    const doomed = await create(identity, cbo());
    const kept = await create(identity, business());
    await writeJson(orgPath(doomed, 'knowledge', 'documents.json'), { documents: ['plan.pdf'] });
    writeFileSync(join(orgPath(doomed, 'knowledge'), 'plan.pdf'), 'bytes of the plan');
    await writeJson(orgPath(kept, 'knowledge', 'documents.json'), { documents: ['menu.pdf'] });
    writeFileSync(join(orgPath(kept, 'knowledge'), 'menu.pdf'), 'bytes of the menu');
    writeFileSync(join(userData, 'conversations.json'), '{"conversations":[]}');
    const keptActivity = readFileSync(orgPath(kept, 'activity.json'), 'utf8');

    const state = await identity.deleteOrganization(doomed);

    expect(existsSync(orgPath(doomed))).toBe(false);
    expect(readdirSync(organizationsRoot())).toEqual([kept]);
    expect(await readJson(orgPath(kept, 'knowledge', 'documents.json'), null)).toEqual({ documents: ['menu.pdf'] });
    expect(readFileSync(join(orgPath(kept, 'knowledge'), 'menu.pdf'), 'utf8')).toBe('bytes of the menu');
    expect(readFileSync(orgPath(kept, 'activity.json'), 'utf8')).toBe(keptActivity);
    expect(readFileSync(join(userData, 'conversations.json'), 'utf8')).toBe('{"conversations":[]}');
    expect(readdirSync(userData).sort()).toEqual(['conversations.json', 'identity.json', 'organizations']);

    expect(state.organizations.map((organization) => organization.id)).toEqual([kept]);
    expect(state.memberships.map((membership) => membership.organizationId)).toEqual([kept]);
    expect(state.session.organizationId).toBe(kept);
    expect(onDisk()).toMatchObject({
      organizations: [{ id: kept }],
      memberships: [{ organizationId: kept }],
      activeOrganizationId: kept,
    });
    expect((await refusal(identity.switchOrganization(doomed))).code).toBe('ORGANIZATION_NOT_FOUND');
  });

  it('removes the memberships of everyone, not only of the person deleting', async () => {
    const identity = service();
    const doomed = await create(identity);
    const file = await readIdentity();
    await writeIdentity({
      ...file,
      memberships: [...file.memberships, membershipOf(doomed, randomUUID(), 'viewer')],
    });
    await identity.deleteOrganization(doomed);
    expect(onDisk()).toMatchObject({ organizations: [], memberships: [], activeOrganizationId: null });
  });

  it('moves to the organization worked on most recently when the active one is deleted', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const identity = service();
    const oldest = await create(identity, cbo('Northside Youth Alliance'));
    vi.setSystemTime(T0 + 1_000);
    const middle = await create(identity, business('Harbor Light Bakery'));
    vi.setSystemTime(T0 + 2_000);
    const newest = await create(identity, cbo('Riverbend Housing Trust'));
    vi.setSystemTime(T0 + 3_000);
    await identity.updateOrganization(oldest, { name: 'Northside Alliance' });
    expect((await identity.currentSession()).organizationId).toBe(newest);

    expect((await identity.deleteOrganization(newest)).session.organizationId).toBe(oldest);
    expect((await identity.deleteOrganization(oldest)).session.organizationId).toBe(middle);

    // Two that were last changed at the same moment: the one created later.
    const earlier = await create(identity, cbo('Eastgate Arts Collective'));
    const later = await create(identity, cbo('Riverbend Housing Trust'));
    await identity.switchOrganization(middle);
    expect((await identity.deleteOrganization(middle)).session.organizationId).toBe(later);
    await identity.deleteOrganization(later);
    expect((await identity.currentSession()).organizationId).toBe(earlier);
    const empty = await identity.deleteOrganization(earlier);
    expect(empty).toMatchObject({ organizations: [], memberships: [], session: { organizationId: null, role: null } });
    expect(onDisk().activeOrganizationId).toBeNull();
    expect((await refusal(identity.requireOrganization())).code).toBe('ORGANIZATION_NOT_FOUND');
  });

  it('leaves the person where they are when some other organization is deleted', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const identity = service();
    const other = await create(identity, cbo());
    const recent = await create(identity, business());
    const active = await create(identity, cbo('Riverbend Housing Trust'));
    // Something else was worked on more recently than the active organization.
    vi.setSystemTime(T0 + 1_000);
    await identity.updateOrganization(recent, { name: 'Harbor Light Bakery and Cafe' });
    expect((await identity.deleteOrganization(other)).session.organizationId).toBe(active);
    expect(onDisk().activeOrganizationId).toBe(active);
  });

  it('never falls back to an organization the person cannot open', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const identity = service();
    const open = await create(identity, cbo());
    vi.setSystemTime(T0 + 1_000);
    const suspended = await create(identity, business());
    vi.setSystemTime(T0 + 2_000);
    const active = await create(identity, cbo('Riverbend Housing Trust'));
    await setMembership(suspended, { status: 'suspended' });

    expect((await identity.deleteOrganization(active)).session.organizationId).toBe(open);
  });

  it('keeps the organization, and says so, when its files cannot be removed', async () => {
    const stuck = join(userData, 'organizations', 'plan.pdf');
    const identity = service({
      removeOrganizationData: async () => {
        throw Object.assign(new Error(`EBUSY: resource busy or locked, unlink '${stuck}'`), { code: 'EBUSY' });
      },
    });
    const id = await create(identity);
    const before = await identity.getState();
    const changes = vi.fn();
    identity.onChange(changes);
    const errors = silenceErrors();

    const { code, message } = await refusal(identity.deleteOrganization(id));
    expect(code).toBe('INTERNAL');
    expect(message).toMatch(/has not been deleted/);
    expectPlain(message);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(changes).not.toHaveBeenCalled();

    expect(await identity.getState()).toEqual(before);
    expect(onDisk()).toMatchObject({
      organizations: [{ id }],
      memberships: [{ organizationId: id }],
      activeOrganizationId: id,
    });
    // It is still a working organization: access is back and its record still grows.
    expect(await identity.can('knowledge.manage')).toBe(true);
    await recordActivity(id, before.profile.id, 'document_added', 'after the failure');
    expect(details(await listActivity(id))).toContain('after the failure');

    // Once the files can be removed, deleting it again finishes the job.
    const state = await service().deleteOrganization(id);
    expect(state.organizations).toEqual([]);
    expect(existsSync(orgPath(id))).toBe(false);
  });

  it('can be deleted again when its files went but the change could not be saved', async () => {
    const identity = service();
    const id = await create(identity);
    const userId = (await identity.getState()).profile.id;
    rmSync(identityFile());
    mkdirSync(identityFile());
    silenceErrors();

    const { code, message } = await refusal(identity.deleteOrganization(id));
    expect(code).toBe('INTERNAL');
    expectPlain(message);
    // Its files are gone, but it is still listed and still works like any other.
    expect(existsSync(orgPath(id))).toBe(false);
    expect((await identity.getState()).organizations.map((organization) => organization.id)).toEqual([id]);
    expect(await identity.can('knowledge.manage')).toBe(true);
    await recordActivity(id, userId, 'document_added', 'plan.pdf');
    expect(details(await listActivity(id))).toEqual(['plan.pdf']);

    rmSync(identityFile(), { recursive: true });
    expect((await identity.deleteOrganization(id)).organizations).toEqual([]);
    expect(existsSync(orgPath(id))).toBe(false);
    expect(onDisk()).toMatchObject({ organizations: [], memberships: [], activeOrganizationId: null });
  });

  it('refuses new work in an organization while its files are being removed', async () => {
    let begun!: () => void;
    const removing = new Promise<void>((resolve) => {
      begun = resolve;
    });
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const identity = service({
      removeOrganizationData: async (organizationId) => {
        begun();
        await gate;
        await removeOrganizationData(organizationId);
      },
    });
    const id = await create(identity);
    const userId = (await identity.getState()).profile.id;

    const deletion = identity.deleteOrganization(id);
    await removing;
    expect(await identity.can('knowledge.manage')).toBe(false);
    expect(await identity.can('knowledge.read', id)).toBe(false);
    expect((await refusal(identity.authorize('knowledge.read', id))).code).toBe('ORGANIZATION_NOT_FOUND');
    expect((await refusal(identity.requireOrganization())).code).toBe('ORGANIZATION_NOT_FOUND');
    expect((await identity.currentSession()).role).toBeNull();
    const rename = refusal(identity.updateOrganization(id, { name: 'Renamed' }));
    await recordActivity(id, userId, 'document_added', 'finished late');

    finish();
    const state = await deletion;
    expect(state.organizations).toEqual([]);
    expect((await rename).code).toBe('ORGANIZATION_NOT_FOUND');
    expect(existsSync(orgPath(id))).toBe(false);
  });

  it('cannot be undone by activity that is noted afterwards', async () => {
    const identity = service();
    const id = await create(identity);
    const userId = (await identity.getState()).profile.id;
    await identity.deleteOrganization(id);
    await recordActivity(id, userId, 'document_added', 'finished late');
    expect(existsSync(orgPath(id))).toBe(false);
    expect(await listActivity(id)).toEqual([]);
    expect(existsSync(organizationsRoot()) ? readdirSync(organizationsRoot()) : []).toEqual([]);
  });

  it('refuses an id that is not valid and removes nothing', async () => {
    const identity = service();
    const one = await create(identity, cbo());
    const two = await create(identity, business());
    await writeJson(orgPath(one, 'knowledge', 'documents.json'), { documents: ['plan.pdf'] });
    await writeJson(orgPath(two, 'knowledge', 'documents.json'), { documents: ['menu.pdf'] });
    writeFileSync(join(userData, 'conversations.json'), '{"conversations":[]}');

    const paths = ['', '.', '..', `../${one}`, `${two}/../${one}`, `${one}/`, '/', 'organizations', '../identity.json'];
    for (const bad of [...paths, `${one}\u0000`, `${one}\n`, 42, null, [one]]) {
      expect(await refusal(identity.deleteOrganization(bad as never))).toEqual({
        code: 'INVALID_INPUT',
        message: 'That organization is not valid.',
      });
    }
    expect((await refusal(identity.deleteOrganization(randomUUID()))).code).toBe('ORGANIZATION_NOT_FOUND');

    expect(readdirSync(organizationsRoot()).sort()).toEqual([one, two].sort());
    expect(await readJson(orgPath(one, 'knowledge', 'documents.json'), null)).toEqual({ documents: ['plan.pdf'] });
    expect(await readJson(orgPath(two, 'knowledge', 'documents.json'), null)).toEqual({ documents: ['menu.pdf'] });
    expect(readFileSync(join(userData, 'conversations.json'), 'utf8')).toBe('{"conversations":[]}');
    expect((await identity.getState()).organizations).toHaveLength(2);
  });
});

describe('change notifications', () => {
  it('follow every saved change, and nothing else', async () => {
    const identity = service();
    const changes = vi.fn();
    const stop = identity.onChange(changes);

    // Reading is not a change, and neither is the profile appearing on first use.
    await identity.getState();
    await identity.currentSession();
    await identity.can('funding.read');
    expect(changes).toHaveBeenCalledTimes(0);

    const id = await create(identity, cbo());
    expect(changes).toHaveBeenCalledTimes(1);
    await identity.updateProfile({ displayName: 'Dana R.' });
    expect(changes).toHaveBeenCalledTimes(2);
    await identity.updateOrganization(id, { name: 'Northside Alliance' });
    expect(changes).toHaveBeenCalledTimes(3);
    await identity.recordConsent(id, 'documentAnalysisAt');
    expect(changes).toHaveBeenCalledTimes(4);
    const other = await create(identity, business());
    expect(changes).toHaveBeenCalledTimes(5);
    await identity.switchOrganization(id);
    expect(changes).toHaveBeenCalledTimes(6);

    // Calls that change nothing.
    await identity.switchOrganization(id);
    await identity.updateProfile({ displayName: 'Dana R.' });
    await identity.updateOrganization(id, { name: 'Northside Alliance' });
    await identity.recordConsent(id, 'documentAnalysisAt');
    await identity.requireOrganization();
    await identity.authorize('funding.read');
    // Calls that are refused.
    await refusal(identity.createOrganization({ ...cbo(), name: '' }));
    await refusal(identity.updateOrganization(id, { kind: 'charity' } as never));
    await refusal(identity.switchOrganization(randomUUID()));
    await refusal(identity.deleteOrganization('nope'));
    await refusal(identity.recordConsent(id, 'nope' as never));
    expect(changes).toHaveBeenCalledTimes(6);

    await identity.deleteOrganization(other);
    expect(changes).toHaveBeenCalledTimes(7);
    expect(changes).toHaveBeenLastCalledWith();

    stop();
    await identity.deleteOrganization(id);
    expect(changes).toHaveBeenCalledTimes(7);
  });

  it('arrive after the change is saved, so a listener reads the new state', async () => {
    const identity = service();
    const seen: Promise<number>[] = [];
    const saved: number[] = [];
    identity.onChange(() => {
      saved.push((onDisk().organizations as unknown[]).length);
      seen.push(identity.getState().then((state) => state.organizations.length));
    });
    await create(identity, cbo());
    await create(identity, business());
    expect(saved).toEqual([1, 2]);
    expect(await Promise.all(seen)).toEqual([1, 2]);
  });

  it('keep reaching other listeners when one of them throws', async () => {
    const identity = service();
    const errors = silenceErrors();
    const reached = vi.fn();
    identity.onChange(() => {
      throw new Error('listener bug');
    });
    identity.onChange(reached);
    const state = await identity.createOrganization(cbo());
    expect(state.organizations).toHaveLength(1);
    expect(reached).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it('count each subscription on its own, even for the same function', async () => {
    const identity = service();
    const changes = vi.fn();
    const stopFirst = identity.onChange(changes);
    identity.onChange(changes);
    await identity.updateProfile({ displayName: 'Dana R.' });
    expect(changes).toHaveBeenCalledTimes(2);
    stopFirst();
    stopFirst();
    await identity.updateProfile({ displayName: 'Dana' });
    expect(changes).toHaveBeenCalledTimes(3);
  });
});

describe('what the state shows', () => {
  it('lists only organizations the person belongs to, with only their own memberships', async () => {
    const identity = service();
    const mine = await create(identity);
    const file = await readIdentity();
    const theirs = { ...file.organizations[0]!, id: randomUUID(), name: 'Riverbend Housing Trust' };
    const someoneElse = randomUUID();
    await writeIdentity({
      ...file,
      organizations: [...file.organizations, theirs],
      memberships: [
        ...file.memberships,
        membershipOf(theirs.id, someoneElse, 'owner'),
        membershipOf(mine, someoneElse, 'admin'),
      ],
    });

    const state = await identity.getState();
    expect(state.organizations.map((organization) => organization.id)).toEqual([mine]);
    expect(state.memberships).toMatchObject([{ organizationId: mine, userId: state.profile.id, role: 'owner' }]);
    expect(JSON.stringify(state)).not.toContain('Riverbend');
    expect(JSON.stringify(state)).not.toContain(someoneElse);
    expect(await identity.can('organization.read', theirs.id)).toBe(false);
  });

  it('is a copy: changing it changes nothing that is stored', async () => {
    const identity = service();
    const id = await create(identity);
    const state = await identity.getState();
    state.profile.displayName = 'Mallory';
    state.organizations[0]!.name = 'Renamed in passing';
    state.organizations[0]!.consents.documentAnalysisAt = 1;
    state.memberships[0]!.role = 'viewer';
    state.session.permissions.length = 0;
    state.organizations.length = 0;

    const again = await identity.getState();
    expect(again.profile.displayName).toBe('Dana Rivera');
    expect(again.organizations).toMatchObject([
      { id, name: 'Northside Youth Alliance', consents: { documentAnalysisAt: null } },
    ]);
    expect(again.memberships).toMatchObject([{ role: 'owner' }]);
    expect(again.session.permissions).toHaveLength(12);

    const file = await readIdentity();
    file.organizations.length = 0;
    file.profile!.displayName = 'Mallory';
    expect((await readIdentity()).organizations).toHaveLength(1);
    expect((await readIdentity()).profile!.displayName).toBe('Dana Rivera');
  });
});

describe('the identity file', () => {
  const user = '0a0a0a0a-1111-4111-8111-000000000001';
  const sound = '0b0b0b0b-2222-4222-8222-000000000002';
  const patched = '0c0c0c0c-3333-4333-8333-000000000003';
  const stamp = 1_760_000_000_000;

  const organization = (id: unknown, change: object = {}) => ({
    schemaVersion: 1,
    id,
    name: 'Northside Youth Alliance',
    kind: 'cbo',
    location: { country: 'US', region: 'NJ', county: 'Essex', city: 'Newark' },
    consents: { documentAnalysisAt: stamp, liveFundingSearchAt: null },
    createdAt: stamp,
    updatedAt: stamp + 1_000,
    ...change,
  });
  const membership = (organizationId: unknown, change: object = {}) => ({
    organizationId,
    userId: user,
    role: 'owner',
    status: 'active',
    createdAt: stamp,
    updatedAt: stamp,
    ...change,
  });
  const profile = (change: object = {}) => ({
    schemaVersion: 1,
    id: user,
    displayName: 'Dana Rivera',
    email: 'dana@northside.example',
    createdAt: stamp,
    updatedAt: stamp,
    ...change,
  });

  const withProfile = (change: object) => ({ schemaVersion: 1, profile: profile(change) });
  const withOrganization = (change: object) => ({ schemaVersion: 1, organizations: [organization(sound, change)] });

  /** A file with one sound organization and every kind of damage around it. */
  const damaged = () => ({
    schemaVersion: 1,
    profile: profile(),
    organizations: [
      organization(sound),
      organization(sound, { name: 'A second record with the same id' }),
      organization('../../etc'),
      organization('0B0B0B0B-2222-4222-8222-000000000002'),
      organization(randomUUID(), { kind: 'charity' }),
      organization(randomUUID(), { schemaVersion: 7 }),
      organization(patched, {
        name: 12,
        location: 'Newark',
        consents: { documentAnalysisAt: 'yes', liveFundingSearchAt: -1 },
        createdAt: 'last week',
        updatedAt: null,
      }),
      null,
      'an organization',
      42,
    ],
    memberships: [
      membership(sound),
      membership(sound, { role: 'viewer' }),
      membership(patched, { role: 'viewer' }),
      membership(randomUUID()),
      membership(sound, { userId: 'everyone' }),
      membership(patched, { userId: randomUUID(), role: 'superuser' }),
      membership(patched, { userId: randomUUID(), status: 'pending' }),
      null,
    ],
    activeOrganizationId: randomUUID(),
    apiToken: 'left behind by something else',
  });

  it('is repaired rather than refused', async () => {
    writeFileSync(identityFile(), JSON.stringify(damaged()));
    const identity = service();
    const state = await identity.getState();

    expect(state.profile).toEqual(profile());
    expect(state.organizations).toEqual([
      organization(sound),
      {
        schemaVersion: 1,
        id: patched,
        name: 'Unnamed organization',
        kind: 'cbo',
        location: { country: 'US', region: '', county: '', city: '' },
        consents: { documentAnalysisAt: null, liveFundingSearchAt: null },
        createdAt: 0,
        updatedAt: 0,
      },
    ]);
    // The first of two memberships for the same person wins; none is invented.
    expect(state.memberships).toEqual([membership(sound), membership(patched, { role: 'viewer' })]);
    // The active organization pointed at nothing, so none is chosen for the person.
    expect(state.session).toMatchObject({ organizationId: null, role: null, permissions: [] });
    expect(JSON.stringify(state)).not.toContain('left behind');
    expect(onDisk()).toEqual({
      schemaVersion: 1,
      profile: state.profile,
      organizations: state.organizations,
      memberships: state.memberships,
      activeOrganizationId: null,
    });

    // What survived is fully usable.
    expect((await identity.switchOrganization(sound)).session).toMatchObject({ organizationId: sound, role: 'owner' });
    expect((await identity.updateOrganization(sound, { name: 'Northside Alliance' })).organizations[0]!.name).toBe(
      'Northside Alliance',
    );
    expect((await refusal(identity.updateOrganization(patched, { name: 'Named again' }))).code).toBe('FORBIDDEN');
  });

  it('keeps the file as it was found before saving a repair, and repairs it only once', async () => {
    const original = JSON.stringify(damaged());
    writeFileSync(identityFile(), original);
    const first = await service().getState();
    expect(keptCopies()).toHaveLength(1);
    expect(readFileSync(join(userData, keptCopies()[0]!), 'utf8')).toBe(original);
    const repaired = readFileSync(identityFile(), 'utf8');
    expect(repaired).not.toBe(original);

    for (let run = 0; run < 2; run += 1) {
      vi.resetModules();
      const { identityService } = await import('./service.js');
      const state = await identityService.getState();
      expect(state.profile).toEqual(first.profile);
      expect(state.organizations).toEqual(first.organizations);
      expect(state.memberships).toEqual(first.memberships);
      expect(readFileSync(identityFile(), 'utf8')).toBe(repaired);
      expect(keptCopies()).toHaveLength(1);
    }
  });

  it('leaves a healthy file exactly as it is', async () => {
    const identity = service();
    await identity.createOrganization({
      name: 'Jos\u00e9 & Daughters  Caf\u00e9',
      kind: 'business',
      location: { country: 'us', region: 'ca', county: '', city: 'Los  Angeles' },
    });
    await identity.updateProfile({ displayName: 'Dana  Rivera ', email: 'dana@northside.example' });
    const id = await create(identity, cbo('n'.repeat(120)));
    await identity.recordConsent(id, 'documentAnalysisAt');
    const bytes = readFileSync(identityFile(), 'utf8');
    expect(repairIdentity(JSON.parse(bytes))).toEqual(JSON.parse(bytes));

    vi.resetModules();
    const { identityService } = await import('./service.js');
    await identityService.getState();
    expect(readFileSync(identityFile(), 'utf8')).toBe(bytes);
    expect(readdirSync(userData).sort()).toEqual(['identity.json', 'organizations']);
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['text', 'identity'],
    ['a number', 42],
    ['a list', [organization(sound)]],
    ['an empty object', {}],
    ['a later version', { schemaVersion: 2, profile: profile(), organizations: [organization(sound)] }],
    ['a version written as text', { schemaVersion: '1', profile: profile() }],
    ['no version', { profile: profile(), organizations: [organization(sound)], memberships: [membership(sound)] }],
    ['every kind of damage', damaged()],
    ['fields of the wrong type', { schemaVersion: 1, profile: [], organizations: {}, memberships: 'none' }],
    ['an active organization that is not an id', { ...withOrganization({}), activeOrganizationId: 7 }],
    ['a profile from a later version', withProfile({ schemaVersion: 3 })],
    [
      'a profile with a damaged name and address',
      withProfile({ displayName: ` ${'n'.repeat(79)} tail\n`, email: ' dana@northside.example ' }),
    ],
    ['a profile whose address is not one', withProfile({ displayName: '\u0000', email: 'dana at northside' })],
    ['a name cut where a space falls', withOrganization({ name: `${'n'.repeat(119)} and more` })],
    ['a name typed with separate accents', withOrganization({ name: 'Cafe\u0301\u202e  de\tla\nPaix' })],
    ['a name of characters that take two code units', withOrganization({ name: '\u{1F600}'.repeat(130) })],
    ['a name with half of a broken character', withOrganization({ name: `${'n'.repeat(1_999)}\u{1F600}` })],
    [
      'place names in need of tidying',
      withOrganization({
        location: { country: ' us ', region: `${'r'.repeat(59)} x`, county: 7, city: ' New\u00a0 York ' },
      }),
    ],
    [
      'times that are not times',
      {
        ...withOrganization({ createdAt: -1, updatedAt: Number.MAX_VALUE }),
        memberships: [membership(sound, { createdAt: null, updatedAt: '2026' })],
      },
    ],
  ])('gives the same result when %s is repaired a second time', (_label, sample) => {
    const once = repairIdentity(sample);
    expect(repairIdentity(once)).toEqual(once);
    // And again after a trip through the file.
    const reread = repairIdentity(JSON.parse(JSON.stringify(once)));
    expect(JSON.stringify(reread)).toBe(JSON.stringify(once));
    expect(once.schemaVersion).toBe(1);
  });

  it('reads a file with no version as the only version there has been', () => {
    const file = repairIdentity({
      profile: profile({ schemaVersion: undefined }),
      organizations: [organization(sound, { schemaVersion: undefined })],
      memberships: [membership(sound)],
      activeOrganizationId: sound,
    });
    expect(file).toEqual({
      schemaVersion: 1,
      profile: profile(),
      organizations: [organization(sound)],
      memberships: [membership(sound)],
      activeOrganizationId: sound,
    });
  });

  it('tidies what it can keep of a damaged record', () => {
    const [kept] = repairIdentity({
      schemaVersion: 1,
      organizations: [
        organization(sound, {
          name: 'Cafe\u0301\u202e  de\tla\nPaix',
          location: { country: ' us ', region: `${'r'.repeat(59)} x`, county: 7, city: ' New\u00a0 York ' },
          createdAt: 'unknown',
        }),
      ],
    }).organizations;
    expect(kept).toMatchObject({
      name: 'Caf\u00e9 de la Paix',
      location: { country: 'US', region: 'r'.repeat(59), county: '', city: 'New York' },
      // The time it was created is taken from the time it was last changed.
      createdAt: stamp + 1_000,
      updatedAt: stamp + 1_000,
    });
    const long = repairIdentity(withOrganization({ name: '\u{1F600}'.repeat(130) }));
    expect(Array.from(long.organizations[0]!.name)).toHaveLength(120);

    const person = (change: object) => repairIdentity(withProfile(change)).profile;
    expect(person({ displayName: ' Dana\u0007\n Rivera ', email: ' dana@northside.example ' })).toEqual(profile());
    expect(person({ displayName: 7, email: 'dana at northside' })).toEqual(
      profile({ displayName: 'Local user', email: '' }),
    );
  });

  it('drops a profile it cannot identify, so first use makes a new one', async () => {
    const file = { ...withOrganization({}), profile: profile({ id: 'dana' }), memberships: [membership(sound)] };
    writeFileSync(identityFile(), JSON.stringify(file));
    const state = await service().getState();
    expect(state.profile.id).toMatch(UUID);
    expect(state.profile.id).not.toBe(user);
    // The organization belongs to the person the file named, not to whoever opens it next.
    expect(state.organizations).toEqual([]);
    expect(await service().can('organization.read', sound)).toBe(false);
    expect((onDisk().organizations as unknown[]).length).toBe(1);
  });

  it('starts afresh from a file written by a later version, and keeps that file', async () => {
    const later = JSON.stringify({ schemaVersion: 2, people: [{ name: 'Dana' }], workspaces: [{ name: 'Northside' }] });
    writeFileSync(identityFile(), later);
    const state = await service().getState();
    expect(state).toMatchObject({ profile: { displayName: 'Dana Rivera' }, organizations: [], memberships: [] });
    expect(keptCopies()).toHaveLength(1);
    expect(readFileSync(join(userData, keptCopies()[0]!), 'utf8')).toBe(later);
    expect(onDisk()).toMatchObject({ schemaVersion: 1, profile: state.profile });
  });

  it.each([
    ['half a file', '{"schemaVersion":1,"profile":{"id":"'],
    ['an empty file', ''],
    ['something that is not data at all', '<html>not found</html>'],
  ])('starts afresh from %s, and moves it aside untouched', async (_label, content) => {
    writeFileSync(identityFile(), content);
    silenceErrors();
    const state = await service().getState();
    expect(state).toMatchObject({ profile: { displayName: 'Dana Rivera' }, organizations: [] });
    const aside = readdirSync(userData).filter((name) => name.startsWith('identity.json.unreadable-'));
    expect(aside).toHaveLength(1);
    expect(readFileSync(join(userData, aside[0]!), 'utf8')).toBe(content);
    expect(onDisk().profile).toEqual(state.profile);
  });

  it.each([
    ['a list', '[]', 1],
    ['a number', '7', 1],
    ['a sentence', '"identity"', 1],
    ['an empty object', '{}', 1],
    ['nothing but null', 'null', 0],
  ])('starts afresh from a file that holds %s', async (_label, content, copies) => {
    writeFileSync(identityFile(), content);
    const identity = service();
    expect((await identity.getState()).organizations).toEqual([]);
    expect(keptCopies()).toHaveLength(copies);
    expect((await identity.createOrganization(cbo())).organizations).toHaveLength(1);
    expect(onDisk()).toMatchObject({ schemaVersion: 1, organizations: [{ name: 'Northside Youth Alliance' }] });
  });

  it('reports a file it cannot read at all, and does not start over on top of it', async () => {
    mkdirSync(identityFile());
    writeFileSync(join(identityFile(), 'kept.txt'), 'still here');
    const errors = silenceErrors();
    const identity = service();

    const calls = [
      identity.getState(),
      identity.currentSession(),
      identity.can('funding.read'),
      identity.authorize('funding.read'),
      identity.requireOrganization(),
      identity.createOrganization(cbo()),
      identity.updateProfile({ displayName: 'Dana' }),
    ];
    for (const call of calls) {
      const { code, message } = await refusal(call);
      expect(code).toBe('MIGRATION_FAILED');
      expectPlain(message);
    }
    expect(errors).toHaveBeenCalled();
    expect(readdirSync(userData)).toEqual(['identity.json']);
    expect(readFileSync(join(identityFile(), 'kept.txt'), 'utf8')).toBe('still here');

    // The failure is not remembered: once the file can be read, everything works.
    rmSync(identityFile(), { recursive: true });
    expect((await identity.getState()).profile.displayName).toBe('Dana Rivera');
    expect((await identity.createOrganization(cbo())).organizations).toHaveLength(1);
  });

  it('says so when a change cannot be saved, and goes on with what it had', async () => {
    const identity = service();
    const id = await create(identity);
    // Something sits where the file goes, so nothing can be written over it.
    rmSync(identityFile());
    mkdirSync(identityFile());
    const errors = silenceErrors();
    const changes = vi.fn();
    identity.onChange(changes);

    const calls = [
      identity.updateProfile({ displayName: 'Dana R.' }),
      identity.createOrganization(business()),
      identity.updateOrganization(id, { name: 'Renamed' }),
      identity.recordConsent(id, 'documentAnalysisAt'),
      identity.switchOrganization(id),
    ];
    for (const call of calls.slice(0, 4)) {
      const { code, message } = await refusal(call);
      expect(code).toBe('INTERNAL');
      expect(message).toMatch(/could not be saved/);
      expectPlain(message);
    }
    // Choosing the organization that is already active needs no saving.
    expect((await calls[4]!).session.organizationId).toBe(id);
    expect(errors).toHaveBeenCalledTimes(4);
    expect(changes).not.toHaveBeenCalled();

    // Nothing half-happened: no second organization, no activity, no changed names.
    const state = await identity.getState();
    expect(state.profile.displayName).toBe('Dana Rivera');
    expect(state.organizations).toMatchObject([
      { id, name: 'Northside Youth Alliance', consents: { documentAnalysisAt: null } },
    ]);
    expect(readdirSync(organizationsRoot())).toEqual([id]);
    expect(await listActivity(id)).toHaveLength(1);
    expect(readdirSync(userData).sort()).toEqual(['identity.json', 'organizations']);

    // Once the file can be written again, so can everything else.
    rmSync(identityFile(), { recursive: true });
    expect((await identity.updateProfile({ displayName: 'Dana R.' })).profile.displayName).toBe('Dana R.');
    expect(onDisk()).toMatchObject({ profile: { displayName: 'Dana R.' }, organizations: [{ id }] });
  });

  it('is always saved in repaired form', async () => {
    const identity = service();
    const id = await create(identity);
    const file = await readIdentity();
    await writeIdentity({
      ...file,
      schemaVersion: 9 as never,
      organizations: [...file.organizations, organization('not-an-id') as never],
      memberships: [...file.memberships, membership(randomUUID()) as never],
      activeOrganizationId: randomUUID(),
    });
    const saved = onDisk();
    expect(saved).toEqual({ ...file, activeOrganizationId: null });
    expect(await readIdentity()).toEqual(saved);
    expect((await identity.getState()).organizations.map((o) => o.id)).toEqual([id]);
    expect(keptCopies()).toEqual([]);
  });
});
