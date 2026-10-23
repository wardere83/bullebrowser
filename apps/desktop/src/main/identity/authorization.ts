// Turns a role into a decision. These are the only functions that read the
// role and method tables in shared/funding.ts, so there is one place to look
// when asking who may do what. They are pure: no storage and no session.
//
// Every argument may be something that arrived over IPC or was read from a
// damaged file, so only the tables' own entries count. A name that an object
// merely inherits, such as "constructor", is never an entry.

import {
  FUNDING_METHODS,
  ROLE_PERMISSIONS,
  type FundingNamespace,
  type OrgRole,
  type Permission,
} from '../../shared/funding.js';

/** Everything a role may do. A copy, so a caller cannot alter the table. */
export function permissionsFor(role: OrgRole): Permission[] {
  return Object.hasOwn(ROLE_PERMISSIONS, role) ? [...ROLE_PERMISSIONS[role]] : [];
}

/** An unknown role holds nothing, and an unknown permission is held by no one. */
export function roleAllows(role: OrgRole, permission: Permission): boolean {
  return Object.hasOwn(ROLE_PERMISSIONS, role) && ROLE_PERMISSIONS[role].includes(permission);
}

/**
 * What a renderer call needs: a permission, `null` when any local user may
 * make the call, or `undefined` when the call is not listed at all. The caller
 * must treat `undefined` as a refusal.
 */
export function permissionFor(namespace: unknown, method: unknown): Permission | null | undefined {
  if (typeof namespace !== 'string' || typeof method !== 'string') return undefined;
  if (!Object.hasOwn(FUNDING_METHODS, namespace)) return undefined;
  const methods: Record<string, Permission | null> = FUNDING_METHODS[namespace as FundingNamespace];
  return Object.hasOwn(methods, method) ? methods[method] : undefined;
}
