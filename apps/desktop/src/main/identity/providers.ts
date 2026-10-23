// How the person using the app is identified. Today that is simply whoever is
// at the device: no account, no password and no network. The interface exists
// so that a sign-in provider added later is one more class behind it, and
// nothing that asks "who is this?" has to change.
//
// A provider never hands tokens to the rest of the app. One that holds any
// keeps them in the app's secret storage, never in the identity file.

import type { AuthMode } from '../../shared/funding.js';

/** What may be shown about a provider. Never contains a secret. */
export interface AuthProviderInfo {
  id: string;
  mode: AuthMode;
  /** A short name for settings, such as "This device". */
  label: string;
  /** One sentence on what being identified this way means. */
  detail: string;
  /** False when there is no outside session that signing out would end. */
  canSignOut: boolean;
}

export interface AuthProvider {
  readonly id: string;
  readonly mode: AuthMode;
  describe(): AuthProviderInfo;
  /** Ends any outside session. What is stored on the device is left alone. */
  signOut(): Promise<void>;
}

export class LocalAuthProvider implements AuthProvider {
  readonly id = 'local';
  readonly mode = 'local';

  describe(): AuthProviderInfo {
    return {
      id: this.id,
      mode: this.mode,
      label: 'This device',
      detail: 'You are using BulleBrowser as the person at this device. No account or sign-in is needed.',
      canSignOut: false,
    };
  }

  async signOut(): Promise<void> {
    // Local mode has no outside session to end.
  }
}
