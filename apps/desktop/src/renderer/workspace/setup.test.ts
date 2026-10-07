import { describe, expect, it } from 'vitest';
import type { IdentityState, Organization, SetupStatus } from '../../shared/funding.js';
import { groundingLabel, groundingOf, profileStateText, setupProgress } from './setup.js';

function setup(completed: number, total: number, ready = false): SetupStatus {
  return {
    steps: [],
    completed,
    total,
    readyForTailoredGuidance: ready,
    nextAction: '',
    counts: {
      documents: 0,
      documentsReady: 0,
      documentsFailed: 0,
      claimsProposed: 0,
      claimsApproved: 0,
      claimsNeedingReview: 0,
      openConflicts: 0,
    },
  };
}

function organization(id: string, name: string): Organization {
  return {
    schemaVersion: 1,
    id,
    name,
    kind: 'cbo',
    location: { country: 'US', region: '', county: '', city: '' },
    consents: { documentAnalysisAt: null, liveFundingSearchAt: null },
    createdAt: 1,
    updatedAt: 1,
  };
}

function identity(organizations: Organization[], activeId: string | null): IdentityState {
  return {
    profile: { schemaVersion: 1, id: 'u', displayName: '', email: '', createdAt: 1, updatedAt: 1 },
    organizations,
    memberships: [],
    session: {
      id: 's',
      userId: 'u',
      organizationId: activeId,
      authMode: 'local',
      issuedAt: 1,
      expiresAt: null,
      role: activeId ? 'owner' : null,
      permissions: [],
    },
  };
}

describe('setupProgress', () => {
  it('reads as "Profile setup: 3 of 5"', () => {
    expect(setupProgress(setup(3, 5))).toEqual({
      completed: 3,
      total: 5,
      complete: false,
      label: 'Profile setup: 3 of 5',
    });
  });

  it('is complete only when every step is done', () => {
    expect(setupProgress(setup(5, 5)).complete).toBe(true);
    expect(setupProgress(setup(4, 5)).complete).toBe(false);
    expect(setupProgress(setup(0, 0)).complete).toBe(false);
  });

  it('keeps the numbers within bounds whatever arrives', () => {
    expect(setupProgress(setup(9, 5))).toMatchObject({ completed: 5, total: 5, complete: true });
    expect(setupProgress(setup(-2, 5))).toMatchObject({
      completed: 0,
      label: 'Profile setup: 0 of 5',
    });
    expect(setupProgress(setup(2.9, 5.2))).toMatchObject({ completed: 2, total: 5 });
    expect(setupProgress(setup(1, -3))).toMatchObject({ completed: 0, total: 0, complete: false });
  });
});

describe('what the assistant is grounded in', () => {
  const riverbend = organization('org-1', 'Riverbend Kitchen');
  const harbor = organization('org-2', 'Harbor Works');

  it('says nothing until identity has been read', () => {
    const grounding = groundingOf({ identity: null, identityStatus: 'loading', setup: null });
    expect(grounding).toEqual({ kind: 'loading' });
    expect(groundingLabel(grounding)).toBe('');
  });

  it('names no organization when identity could not be read', () => {
    const grounding = groundingOf({
      identity: null,
      identityStatus: 'error',
      setup: setup(5, 5, true),
    });
    expect(grounding).toEqual({ kind: 'unavailable' });
    expect(groundingLabel(grounding)).toBe('Organization unavailable. Open the workspace.');
  });

  it('says so when there is no organization yet', () => {
    const grounding = groundingOf({
      identity: identity([], null),
      identityStatus: 'ready',
      setup: null,
    });
    expect(grounding).toEqual({ kind: 'none' });
    expect(groundingLabel(grounding)).toBe(
      'No organization yet. Open the workspace to set one up.',
    );
  });

  it('names the organization and whether its profile is approved', () => {
    const state = { identity: identity([riverbend], 'org-1'), identityStatus: 'ready' as const };
    const approved = groundingOf({ ...state, setup: setup(5, 5, true) });
    expect(approved).toEqual({
      kind: 'organization',
      name: 'Riverbend Kitchen',
      profile: 'approved',
    });
    expect(profileStateText(approved)).toBe('profile approved');
    expect(groundingLabel(approved)).toBe(
      'Grounded in Riverbend Kitchen, profile approved. Open the Organization Knowledge Hub.',
    );

    const pending = groundingOf({ ...state, setup: setup(2, 5, false) });
    expect(profileStateText(pending)).toBe('profile not approved yet');
    expect(groundingLabel(pending)).toBe(
      'Grounded in Riverbend Kitchen, profile not approved yet. Open the Organization Knowledge Hub.',
    );
  });

  it('shows the new organization at once after a switch, and no profile state until it is known', () => {
    // The store clears the setup status the moment the active organization changes.
    const justSwitched = groundingOf({
      identity: identity([riverbend, harbor], 'org-2'),
      identityStatus: 'ready',
      setup: null,
    });
    expect(justSwitched).toEqual({
      kind: 'organization',
      name: 'Harbor Works',
      profile: 'unknown',
    });
    expect(profileStateText(justSwitched)).toBe('');
    expect(groundingLabel(justSwitched)).toBe(
      'Grounded in Harbor Works. Open the Organization Knowledge Hub.',
    );
    expect(groundingLabel(justSwitched)).not.toContain('Riverbend');
  });

  it('treats an active id that matches no organization as no organization', () => {
    const grounding = groundingOf({
      identity: identity([riverbend], 'org-gone'),
      identityStatus: 'ready',
      setup: setup(5, 5, true),
    });
    expect(grounding).toEqual({ kind: 'none' });
  });
});
