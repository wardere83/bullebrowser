// What the workspace says about how far an organization's setup has got, and
// what the assistant is grounded in. Both are worked out here from the store's
// data so the navigation, the dashboard and the assistant panel agree.

import type { IdentityState, SetupStatus } from '../../shared/funding.js';
import { activeOrganization } from '../state/workspace-store.js';

export interface SetupProgress {
  completed: number;
  total: number;
  complete: boolean;
  /** "Profile setup: 3 of 5". */
  label: string;
}

/** How far setup has got, with the numbers kept within bounds whatever main sends. */
export function setupProgress(setup: SetupStatus): SetupProgress {
  const total = Math.max(0, Math.floor(setup.total));
  const completed = Math.min(total, Math.max(0, Math.floor(setup.completed)));
  return {
    completed,
    total,
    complete: total > 0 && completed >= total,
    label: `Profile setup: ${completed} of ${total}`,
  };
}

/**
 * What the assistant's guidance rests on right now.
 *  loading       — identity has not been read yet.
 *  unavailable   — identity could not be read; no organization may be named.
 *  none          — there is no active organization.
 *  organization  — the active organization, and whether its profile has any
 *                  approved claim. `profile` is "unknown" until the setup status
 *                  for this organization has arrived, so a previous
 *                  organization's answer is never shown.
 */
export type Grounding =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'none' }
  | { kind: 'organization'; name: string; profile: 'approved' | 'not_approved' | 'unknown' };

export function groundingOf(state: {
  identity: IdentityState | null;
  identityStatus: 'loading' | 'ready' | 'error';
  setup: SetupStatus | null;
}): Grounding {
  if (!state.identity) {
    return state.identityStatus === 'error' ? { kind: 'unavailable' } : { kind: 'loading' };
  }
  const organization = activeOrganization(state.identity);
  if (!organization) return { kind: 'none' };
  return {
    kind: 'organization',
    name: organization.name,
    profile: !state.setup
      ? 'unknown'
      : state.setup.readyForTailoredGuidance
        ? 'approved'
        : 'not_approved',
  };
}

const PROFILE_STATE_TEXT = {
  approved: 'profile approved',
  not_approved: 'profile not approved yet',
  unknown: '',
} as const;

/** The profile's state in words, or an empty string while it is not known. */
export function profileStateText(grounding: Grounding): string {
  return grounding.kind === 'organization' ? PROFILE_STATE_TEXT[grounding.profile] : '';
}

/**
 * The grounding line as a whole sentence, for assistive technology: what the
 * assistant is grounded in, then where the link leads.
 */
export function groundingLabel(grounding: Grounding): string {
  switch (grounding.kind) {
    case 'loading':
      return '';
    case 'unavailable':
      return 'Organization unavailable. Open the workspace.';
    case 'none':
      return 'No organization yet. Open the workspace to set one up.';
    case 'organization': {
      const state = profileStateText(grounding);
      return `Grounded in ${grounding.name}${state ? `, ${state}` : ''}. Open the Organization Knowledge Hub.`;
    }
  }
}
