import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
let userData: string;
vi.mock('electron', () => ({ app: { getPath: () => userData } }));
const { ProfileStore } = await import('./profile-store.js');
const org = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const owner = { userId: '99999999-9999-4999-8999-999999999999', canApprove: true };
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'bb-profile-test-'));
});
afterEach(() => {
  rmSync(userData, { recursive: true, force: true });
});

describe('explicit profile approval and persistence', () => {
  it('requires owners to approve additions and preserves approved wording while edits await review', async () => {
    const store = new ProfileStore();
    let profile = await store.addClaim(
      org,
      { field: 'strategic_priorities', text: 'Support neighborhood jobs.', evidence: [] },
      owner,
      async () => [],
    );
    expect(profile.claims[0]?.status).toBe('proposed');
    expect(profile.approvedAt).toBeNull();
    const id = profile.claims[0]!.id;
    profile = await store.approveClaims(org, [id], owner);
    expect(profile.claims[0]?.status).toBe('approved');
    profile = await store.updateClaim(org, id, 'Support neighborhood jobs and skills.', owner);
    expect(profile.claims.find((claim) => claim.id === id)?.text).toBe(
      'Support neighborhood jobs.',
    );
    const replacement = profile.claims.find((claim) => claim.supersedesClaimId === id)!;
    expect(replacement.status).toBe('proposed');
    profile = await store.approveClaims(org, [replacement.id], owner);
    expect(
      profile.claims.filter((claim) => claim.status === 'approved').map((claim) => claim.text),
    ).toEqual(['Support neighborhood jobs and skills.']);
    expect((await new ProfileStore().get(org)).claims).toEqual(profile.claims);
    expect((await store.get(other)).claims).toEqual([]);
  });
  it('prevents members from approving their own proposed statements', async () => {
    const store = new ProfileStore();
    const member = { ...owner, canApprove: false };
    const profile = await store.addClaim(
      org,
      { field: 'mission', text: 'Our documented mission.', evidence: [] },
      member,
      async () => [],
    );
    await expect(store.approveClaims(org, [profile.claims[0]!.id], member)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
