// Per-site permission levels the user chose to keep ("Always allow on this
// site"), filed per browsing profile. Sites with no entry use the default
// level (read + click); anything more is asked for when a task needs it.

import { DEFAULT_SITE_LEVEL, type PermissionLevel } from '@bullebrowser/agent-core';
import { createStore } from './store.js';

type ByOrigin = Record<string, PermissionLevel>;
const store = createStore<{ byProfile: Record<string, ByOrigin> }>('site-permissions', { byProfile: {} });

const LEVELS = new Set<PermissionLevel>(['read', 'click', 'type', 'full']);

export function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

function all(profile: string): ByOrigin {
  return { ...(store.get('byProfile')[profile] ?? {}) };
}

export const sitePermissions = {
  level(profile: string, origin: string): PermissionLevel {
    return all(profile)[origin] ?? DEFAULT_SITE_LEVEL;
  },
  list(profile: string): { origin: string; level: PermissionLevel }[] {
    return Object.entries(all(profile))
      .map(([origin, level]) => ({ origin, level }))
      .sort((a, b) => a.origin.localeCompare(b.origin));
  },
  set(profile: string, origin: string, level: PermissionLevel): void {
    if (!LEVELS.has(level) || !originOf(origin)) return;
    const byProfile = store.get('byProfile');
    byProfile[profile] = { ...(byProfile[profile] ?? {}), [originOf(origin)!]: level };
    store.set('byProfile', byProfile);
  },
  remove(profile: string, origin: string): void {
    const byProfile = store.get('byProfile');
    const mine = { ...(byProfile[profile] ?? {}) };
    delete mine[origin];
    byProfile[profile] = mine;
    store.set('byProfile', byProfile);
  },
};
