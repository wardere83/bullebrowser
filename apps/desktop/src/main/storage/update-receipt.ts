import { compare, valid } from 'semver';
import { createStore } from './store.js';

interface PendingUpdate { version: string; installedVersion: string; appPath: string }
let store: ReturnType<typeof createStore<{ pending: PendingUpdate | null }>> | undefined;
const receipt = () => store ??= createStore('update-receipt', { pending: null as PendingUpdate | null });
let activatedVersion: string | null = null;

/** Set only when the running binary proves the prepared update was installed. */
export function getActivatedUpdateVersion(): string | null { return activatedVersion; }

export function recordPreparedUpdate(version: string, installedVersion: string, appPath: string): void {
  receipt().set('pending', { version, installedVersion, appPath });
}

/** Checked against the running binary, never inferred from download completion. */
export function reconcilePreparedUpdate(installedVersion: string, appPath: string): string | null {
  const pending = receipt().get('pending');
  if (!pending || !valid(pending.version) || !valid(installedVersion)) return null;
  if (compare(installedVersion, pending.version) >= 0) {
    activatedVersion = pending.version;
    receipt().set('pending', null);
    return null;
  }
  const location = pending.appPath === appPath ? '' : ' A different copy of BulleBrowser was opened.';
  return `The previous update to v${pending.version} did not activate. This copy is still v${installedVersion}.${location} Download and open the latest installer if retrying does not help.`;
}
