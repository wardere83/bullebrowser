// Reads the active organization's profile and keeps it current: it is read
// again when main says the profile changed and when a draft ends, and a change
// made on this screen shows main's own answer at once instead of waiting for
// the next read.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OrganizationProfile } from '../../../shared/funding.js';
import {
  type FundingCallError,
  fundingBridge,
  unwrap,
  useAsync,
} from '../../lib/funding-client.js';
import { useFundingEvent, useWorkspaceStore } from '../../state/workspace-store.js';
import { effectiveProfile, type AppliedProfile } from './profile.js';

export interface ProfileData {
  /** The profile to show, when there is one: the latest read, or a change's own answer. */
  profile: OrganizationProfile | undefined;
  /** Set when the last read failed. `profile` may still hold the one before it. */
  error: FundingCallError | undefined;
  /** True until the first read has answered. */
  loading: boolean;
  reload(): void;
  /** Takes the profile main returned from a change, and has everything that depends on it read again. */
  apply(profile: OrganizationProfile): void;
}

export function useProfileData(): ProfileData {
  const loaded = useAsync(() => unwrap(fundingBridge().knowledge.getProfile()), []);
  const refreshSetup = useWorkspaceStore((state) => state.refreshSetup);
  const [applied, setApplied] = useState<AppliedProfile | null>(null);
  const { reload } = loaded;

  // What is loaded at the moment a change's answer arrives, which can be later
  // than the render the handler was created in.
  const latest = useRef(loaded.value);
  useEffect(() => {
    latest.current = loaded.value;
  });

  useFundingEvent(['profile_changed', 'job'], (event) => {
    if (event.kind === 'profile_changed') reload();
    else if (event.job.kind === 'profile_extraction' && event.job.state !== 'running') reload();
  });

  const apply = useCallback(
    (profile: OrganizationProfile) => {
      setApplied({ profile, over: latest.current });
      // Read again all the same: it supersedes a read that was already on its
      // way with older data, and the setup status counts what just changed.
      reload();
      void refreshSetup();
    },
    [reload, refreshSetup],
  );

  const profile = effectiveProfile(loaded.value, applied);
  const error = loaded.state === 'error' ? loaded.error : undefined;
  const loading = loaded.state === 'loading' && !profile;

  return useMemo(
    () => ({ profile, error, loading, reload, apply }),
    [profile, error, loading, reload, apply],
  );
}
