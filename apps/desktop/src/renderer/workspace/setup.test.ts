import { describe, expect, it } from 'vitest';
import type { SetupStatus } from '../../shared/funding.js';
import { setupProgress } from './setup.js';

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
