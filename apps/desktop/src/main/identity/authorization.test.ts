import { describe, expect, it } from 'vitest';
import {
  FUNDING_METHODS,
  ROLE_PERMISSIONS,
  type FundingNamespace,
  type OrgRole,
  type Permission,
} from '../../shared/funding.js';
import { permissionFor, permissionsFor, roleAllows } from './authorization.js';

const ROLES: OrgRole[] = ['owner', 'admin', 'member', 'viewer'];

// The whole matrix, written out. It repeats the shared table on purpose: a
// change to who may do what has to be made here as well, where it is seen.
// Its type also fails to compile if a role or a permission is added.
const MATRIX: Record<Permission, Record<OrgRole, boolean>> = {
  'organization.read': { owner: true, admin: true, member: true, viewer: true },
  'organization.manage': { owner: true, admin: false, member: false, viewer: false },
  'members.read': { owner: true, admin: true, member: true, viewer: true },
  'members.manage': { owner: true, admin: true, member: false, viewer: false },
  'settings.read': { owner: true, admin: true, member: true, viewer: true },
  'settings.manage': { owner: true, admin: true, member: false, viewer: false },
  'audit.read': { owner: true, admin: true, member: false, viewer: false },
  'knowledge.read': { owner: true, admin: true, member: true, viewer: true },
  'knowledge.manage': { owner: true, admin: true, member: true, viewer: false },
  'profile.approve': { owner: true, admin: true, member: false, viewer: false },
  'funding.read': { owner: true, admin: true, member: true, viewer: true },
  'funding.manage': { owner: true, admin: true, member: true, viewer: false },
};

const PERMISSIONS = Object.keys(MATRIX) as Permission[];
const CELLS = PERMISSIONS.flatMap((permission) =>
  ROLES.map((role) => [role, permission, MATRIX[permission][role]] as const),
);

describe('roles', () => {
  it('covers four roles and twelve permissions', () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...ROLES].sort());
    expect(PERMISSIONS).toHaveLength(12);
    expect(CELLS).toHaveLength(48);
  });

  it.each(CELLS)('%s and %s: %s', (role, permission, allowed) => {
    expect(roleAllows(role, permission)).toBe(allowed);
  });

  it.each(ROLES)('lists exactly what the %s role may do, every time it is asked', (role) => {
    const expected = PERMISSIONS.filter((permission) => MATRIX[permission][role]).sort();
    const listed = permissionsFor(role);
    expect([...listed].sort()).toEqual(expected);
    expect(new Set(listed).size).toBe(listed.length);
    expect(permissionsFor(role)).toEqual(listed);
  });

  it('never gives a role more than the one above it', () => {
    for (const [lower, higher] of [['viewer', 'member'], ['member', 'admin'], ['admin', 'owner']] as const) {
      for (const permission of permissionsFor(lower)) expect(roleAllows(higher, permission)).toBe(true);
    }
  });

  it('hands out a copy, so a caller cannot widen a role', () => {
    const listed = permissionsFor('viewer');
    listed.push('organization.manage');
    permissionsFor('owner').length = 0;
    expect(roleAllows('viewer', 'organization.manage')).toBe(false);
    expect(permissionsFor('viewer')).not.toContain('organization.manage');
    expect(permissionsFor('owner')).toHaveLength(12);
  });

  it('gives nothing to a role or for a permission it does not know', () => {
    for (const role of ['', 'Owner', 'superuser', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(permissionsFor(role as OrgRole)).toEqual([]);
      expect(roleAllows(role as OrgRole, 'organization.read')).toBe(false);
    }
    for (const permission of ['', 'organization', 'organization.*', 'ORGANIZATION.READ', 'length', 'includes']) {
      expect(roleAllows('owner', permission as Permission)).toBe(false);
    }
    expect(roleAllows(undefined as unknown as OrgRole, undefined as unknown as Permission)).toBe(false);
    expect(permissionsFor(null as unknown as OrgRole)).toEqual([]);
  });
});

describe('the permission a call needs', () => {
  it('reads it from the shared table', () => {
    expect(permissionFor('identity', 'get')).toBeNull();
    expect(permissionFor('identity', 'createOrganization')).toBeNull();
    expect(permissionFor('identity', 'updateOrganization')).toBe('organization.manage');
    expect(permissionFor('identity', 'deleteOrganization')).toBe('organization.manage');
    expect(permissionFor('identity', 'recordConsent')).toBe('settings.manage');
    expect(permissionFor('identity', 'activity')).toBe('audit.read');
    expect(permissionFor('knowledge', 'listDocuments')).toBe('knowledge.read');
    expect(permissionFor('knowledge', 'deleteDocument')).toBe('knowledge.manage');
    expect(permissionFor('knowledge', 'approveClaims')).toBe('profile.approve');
    expect(permissionFor('opportunities', 'search')).toBe('funding.read');
    expect(permissionFor('rfps', 'analyze')).toBe('funding.manage');
    expect(permissionFor('guides', 'requestFeedback')).toBe('funding.manage');
    expect(permissionFor('jobs', 'cancel')).toBeNull();
  });

  it('agrees with the table for every call it lists', () => {
    let calls = 0;
    for (const namespace of Object.keys(FUNDING_METHODS) as FundingNamespace[]) {
      const methods: Record<string, Permission | null> = FUNDING_METHODS[namespace];
      for (const [method, permission] of Object.entries(methods)) {
        expect(permissionFor(namespace, method)).toBe(permission);
        // Nothing may ask for a permission that no role holds.
        if (permission !== null) expect(roleAllows('owner', permission)).toBe(true);
        calls += 1;
      }
    }
    expect(calls).toBeGreaterThan(40);
  });

  it.each([
    ['an unknown method', 'identity', 'exportEverything'],
    ['an unknown namespace', 'billing', 'get'],
    ['the event subscription, which is not a call', 'onEvent', 'call'],
    ['a method in the wrong namespace', 'jobs', 'deleteOrganization'],
    ['a name that differs only in case', 'Identity', 'get'],
    ['a name with a stray space', 'identity', 'get '],
    ['empty names', '', ''],
    ['an inherited method name', 'identity', 'constructor'],
    ['an inherited method name', 'identity', 'toString'],
    ['an inherited method name', 'identity', 'hasOwnProperty'],
    ['the prototype as a method', 'identity', '__proto__'],
    ['the prototype as a namespace', '__proto__', 'get'],
    ['an inherited namespace', 'constructor', 'name'],
    ['an inherited namespace', 'toString', 'length'],
    ['a dotted path', 'identity.get', 'get'],
  ])('is undefined for %s (%s, %s)', (_label, namespace, method) => {
    expect(permissionFor(namespace, method)).toBeUndefined();
  });

  it('is undefined for names that are not text', () => {
    for (const value of [undefined, null, 0, 1, true, {}, [], ['identity'], { toString: () => 'identity' }]) {
      expect(permissionFor(value, 'get')).toBeUndefined();
      expect(permissionFor('identity', value)).toBeUndefined();
    }
    expect(permissionFor(['identity'], ['get'])).toBeUndefined();
  });
});
