// Organization setup progress shared by workspace navigation.

import type { SetupStatus } from '../../shared/funding.js';

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
