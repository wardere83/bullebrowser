import { describe, expect, it } from 'vitest';
import {
  PROFILE_FIELDS,
  PROFILE_FIELD_LABELS,
  type ClaimStatus,
  type OrganizationProfile,
  type ProfileClaim,
} from '../../../shared/funding.js';
import {
  DRAFT_WAYS,
  EDITED_LABEL,
  NO_SOURCE_DOCUMENT,
  ORIGIN_LABELS,
  PRIORITIES_FIELD,
  actionsFor,
  addedClaims,
  approveLabel,
  approvedMessage,
  claimIndex,
  countProfile,
  describeGroup,
  draftEndedMessage,
  draftMode,
  effectiveProfile,
  excerpt,
  focusAfterChange,
  groupByField,
  lastDraftText,
  liveSelection,
  openConflicts,
  prioritiesOf,
  rejectedMessage,
  replacementOf,
  replacesLine,
  reviewText,
  withSelection,
} from './profile.js';

function claim(patch: Partial<ProfileClaim> & { id: string }): ProfileClaim {
  return {
    field: 'mission',
    text: `Statement ${patch.id}.`,
    origin: 'extracted',
    status: 'proposed',
    citations: [],
    reviewReason: null,
    reviewNote: '',
    supersedesClaimId: null,
    edited: false,
    createdAt: 1,
    updatedAt: 1,
    approvedAt: null,
    approvedBy: null,
    ...patch,
  };
}

function profile(patch: Partial<OrganizationProfile> = {}): OrganizationProfile {
  return {
    schemaVersion: 1,
    organizationId: 'org-1',
    claims: [],
    conflicts: [],
    gaps: [],
    extraction: { status: 'idle', lastRunAt: null, method: null, error: '' },
    approvedAt: null,
    approvedBy: null,
    updatedAt: 1,
    ...patch,
  };
}

describe('where a statement came from', () => {
  it('is said in the product’s words', () => {
    expect(ORIGIN_LABELS).toEqual({
      extracted: 'Drafted from your documents',
      verbatim: 'Word for word from a document',
      user: 'Written by your team',
    });
    expect(EDITED_LABEL).toBe('Edited');
    expect(NO_SOURCE_DOCUMENT).toBe('No source document');
  });

  it('never gives two origins the same words', () => {
    const labels = Object.values(ORIGIN_LABELS);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('reviewText', () => {
  it('shows the sentence main wrote', () => {
    expect(
      reviewText({ reviewNote: ' Plan.pdf was replaced on March 3. ', reviewReason: 'source_replaced' }),
    ).toBe('Plan.pdf was replaced on March 3.');
  });

  it('says the reason in words when no sentence came with it', () => {
    expect(reviewText({ reviewNote: '', reviewReason: 'source_deleted' })).toBe(
      'The document this statement cites was deleted.',
    );
    expect(reviewText({ reviewNote: '  ', reviewReason: 'source_replaced' })).toBe(
      'The document this statement cites was replaced.',
    );
    expect(reviewText({ reviewNote: '', reviewReason: 'evidence_missing' })).toContain(
      'no longer in your documents',
    );
    expect(reviewText({ reviewNote: '', reviewReason: 'conflict' })).toContain('disagree');
    expect(reviewText({ reviewNote: '', reviewReason: null })).toBe(
      'Its source changed after it was approved.',
    );
  });
});

describe('groupByField', () => {
  it('always returns the nine fields, in the contract’s order, with their labels', () => {
    const groups = groupByField(profile());
    expect(groups.map((group) => group.field)).toEqual([...PROFILE_FIELDS]);
    expect(groups.map((group) => group.label)).toEqual(
      PROFILE_FIELDS.map((field) => PROFILE_FIELD_LABELS[field]),
    );
    expect(groups.every((group) => group.gap === null)).toBe(true);
  });

  it('keeps approved, proposed, to-review and rejected statements apart', () => {
    const groups = groupByField(
      profile({
        claims: [
          claim({ id: 'a', status: 'approved' }),
          claim({ id: 'b', status: 'proposed' }),
          claim({ id: 'c', status: 'needs_review' }),
          claim({ id: 'd', status: 'rejected' }),
          claim({ id: 'e', status: 'proposed', field: 'programs' }),
        ],
      }),
    );
    const mission = groups.find((group) => group.field === 'mission');
    expect(mission?.approved.map((entry) => entry.id)).toEqual(['a']);
    expect(mission?.proposed.map((entry) => entry.id)).toEqual(['b']);
    expect(mission?.needsReview.map((entry) => entry.id)).toEqual(['c']);
    expect(mission?.rejected.map((entry) => entry.id)).toEqual(['d']);
    const programs = groups.find((group) => group.field === 'programs');
    expect(programs?.proposed.map((entry) => entry.id)).toEqual(['e']);
    expect(programs?.approved).toEqual([]);
  });

  it('never lists a proposal among the approved statements', () => {
    const statuses: ClaimStatus[] = ['proposed', 'needs_review', 'rejected'];
    const groups = groupByField(
      profile({ claims: statuses.map((status, index) => claim({ id: `c${index}`, status })) }),
    );
    expect(groups.flatMap((group) => group.approved)).toEqual([]);
  });

  it('lists the oldest statement first, so nothing moves when one is edited', () => {
    const groups = groupByField(
      profile({
        claims: [
          claim({ id: 'late', status: 'approved', createdAt: 30, updatedAt: 99 }),
          claim({ id: 'early', status: 'approved', createdAt: 10, updatedAt: 500 }),
          claim({ id: 'middle', status: 'approved', createdAt: 20 }),
        ],
      }),
    );
    expect(groups[0]?.approved.map((entry) => entry.id)).toEqual(['early', 'middle', 'late']);
  });

  it('attaches a gap to its field', () => {
    const groups = groupByField(
      profile({ gaps: [{ field: 'capacity', note: 'No document describes staffing.' }] }),
    );
    expect(groups.find((group) => group.field === 'capacity')?.gap).toEqual({
      field: 'capacity',
      note: 'No document describes staffing.',
    });
    expect(groups.find((group) => group.field === 'mission')?.gap).toBeNull();
  });
});

describe('describeGroup', () => {
  it('counts what stands where', () => {
    expect(
      describeGroup({
        approved: [claim({ id: 'a' })],
        proposed: [claim({ id: 'b' }), claim({ id: 'c' })],
        needsReview: [claim({ id: 'd' })],
      }),
    ).toBe('1 approved, 2 proposed, 1 needs review');
    expect(
      describeGroup({
        approved: [],
        proposed: [],
        needsReview: [claim({ id: 'd' }), claim({ id: 'e' })],
      }),
    ).toBe('2 need review');
  });

  it('says so when a field has nothing', () => {
    expect(describeGroup({ approved: [], proposed: [], needsReview: [] })).toBe('No statements yet');
  });
});

describe('countProfile', () => {
  it('counts statements by status, open conflicts and gaps', () => {
    expect(
      countProfile(
        profile({
          claims: [
            claim({ id: 'a', status: 'approved' }),
            claim({ id: 'b', status: 'approved' }),
            claim({ id: 'c', status: 'proposed' }),
            claim({ id: 'd', status: 'needs_review' }),
            claim({ id: 'e', status: 'rejected' }),
          ],
          conflicts: [
            { id: 'x', field: 'mission', summary: '', claimIds: ['a', 'c'], resolvedAt: null },
            { id: 'y', field: 'mission', summary: '', claimIds: ['a', 'c'], resolvedAt: 9 },
          ],
          gaps: [{ field: 'capacity', note: '' }],
        }),
      ),
    ).toEqual({ approved: 2, proposed: 1, needsReview: 1, rejected: 1, openConflicts: 1, gaps: 1 });
  });
});

describe('what a proposal replaces', () => {
  const approved = claim({ id: 'old', status: 'approved', text: 'We serve 900 families a year.' });
  const index = claimIndex(profile({ claims: [approved] }));

  it('is nothing for a proposal that stands on its own', () => {
    expect(replacementOf(claim({ id: 'new' }), index)).toBeNull();
    expect(replacesLine(null)).toBe('');
  });

  it('is the approved statement’s own text', () => {
    const replacement = replacementOf(claim({ id: 'new', supersedesClaimId: 'old' }), index);
    expect(replacement).toEqual({ kind: 'statement', text: 'We serve 900 families a year.' });
    expect(replacesLine(replacement)).toBe('Replaces: We serve 900 families a year.');
  });

  it('says so when the statement it named has gone', () => {
    const replacement = replacementOf(claim({ id: 'new', supersedesClaimId: 'gone' }), index);
    expect(replacement).toEqual({ kind: 'missing' });
    expect(replacesLine(replacement)).toBe(
      'Replaces: a statement that is no longer in the profile.',
    );
  });
});

describe('openConflicts', () => {
  const claims = [
    claim({ id: 'a', status: 'approved' }),
    claim({ id: 'b' }),
    claim({ id: 'c', field: 'programs' }),
    claim({ id: 'd', field: 'programs' }),
  ];

  it('lists only conflicts nobody has settled, with each side’s statement', () => {
    const open = openConflicts(
      profile({
        claims,
        conflicts: [
          { id: 'x', field: 'mission', summary: 'Two missions.', claimIds: ['a', 'b'], resolvedAt: null },
          { id: 'y', field: 'programs', summary: 'Settled.', claimIds: ['c', 'd'], resolvedAt: 12 },
        ],
      }),
    );
    expect(open).toHaveLength(1);
    expect(open[0]?.conflict.id).toBe('x');
    expect(open[0]?.fieldLabel).toBe('Mission');
    expect(open[0]?.sides.map((side) => side.id)).toEqual(['a', 'b']);
    expect(open[0]?.missing).toBe(0);
  });

  it('counts a side whose statement has gone instead of inventing one', () => {
    const open = openConflicts(
      profile({
        claims,
        conflicts: [
          { id: 'x', field: 'mission', summary: '', claimIds: ['a', 'gone', 'a'], resolvedAt: null },
        ],
      }),
    );
    expect(open[0]?.sides.map((side) => side.id)).toEqual(['a']);
    expect(open[0]?.missing).toBe(1);
  });

  it('follows the order of the fields', () => {
    const open = openConflicts(
      profile({
        claims,
        conflicts: [
          { id: 'second', field: 'programs', summary: '', claimIds: ['c', 'd'], resolvedAt: null },
          { id: 'first', field: 'mission', summary: '', claimIds: ['a', 'b'], resolvedAt: null },
        ],
      }),
    );
    expect(open.map((entry) => entry.conflict.id)).toEqual(['first', 'second']);
  });
});

describe('prioritiesOf', () => {
  it('is a view of the strategic priorities field', () => {
    expect(PRIORITIES_FIELD).toBe('strategic_priorities');
  });

  it('confirms only approved statements, and keeps proposed changes apart', () => {
    const view = prioritiesOf(
      profile({
        claims: [
          claim({ id: 'p1', field: 'strategic_priorities', status: 'approved' }),
          claim({ id: 'p2', field: 'strategic_priorities', status: 'proposed', supersedesClaimId: 'p1' }),
          claim({ id: 'p3', field: 'strategic_priorities', status: 'needs_review' }),
          claim({ id: 'p4', field: 'strategic_priorities', status: 'rejected' }),
          claim({ id: 'm1', field: 'mission', status: 'approved' }),
        ],
      }),
    );
    expect(view.confirmed.map((entry) => entry.id)).toEqual(['p1']);
    expect(view.proposed.map((entry) => entry.id)).toEqual(['p2']);
    expect(view.needsReview.map((entry) => entry.id)).toEqual(['p3']);
    expect(view.rejected.map((entry) => entry.id)).toEqual(['p4']);
    expect(view.empty).toBe(false);
  });

  it('is empty when nothing is confirmed and nothing is waiting', () => {
    expect(prioritiesOf(profile()).empty).toBe(true);
    // A rejected priority is not a reason to hide how priorities get here.
    expect(
      prioritiesOf(
        profile({ claims: [claim({ id: 'p', field: 'strategic_priorities', status: 'rejected' })] }),
      ).empty,
    ).toBe(true);
    expect(
      prioritiesOf(profile({ claims: [claim({ id: 'p', field: 'strategic_priorities' })] })).empty,
    ).toBe(false);
  });
});

describe('actionsFor', () => {
  const everything = { approve: true, manage: true };

  it('offers Approve, Reject and Edit on a proposal', () => {
    expect(actionsFor('proposed', everything)).toEqual(['approve', 'reject', 'edit']);
  });

  it('offers Approve again, Edit and Remove on a statement that needs review', () => {
    expect(actionsFor('needs_review', everything)).toEqual(['approve', 'edit', 'remove']);
    expect(approveLabel('needs_review')).toBe('Approve again');
    expect(approveLabel('proposed')).toBe('Approve');
  });

  it('offers Edit and Remove on an approved statement', () => {
    expect(actionsFor('approved', everything)).toEqual(['edit', 'remove']);
  });

  it('lets a rejected statement be approved after all, or removed', () => {
    expect(actionsFor('rejected', everything)).toEqual(['approve', 'remove']);
  });

  it('keeps approving and rejecting for people who may approve', () => {
    const member = { approve: false, manage: true };
    expect(actionsFor('proposed', member)).toEqual(['edit']);
    expect(actionsFor('needs_review', member)).toEqual(['edit', 'remove']);
    expect(actionsFor('rejected', member)).toEqual(['remove']);
  });

  it('offers nothing to someone who may only read', () => {
    const viewer = { approve: false, manage: false };
    for (const status of ['proposed', 'approved', 'needs_review', 'rejected'] as const) {
      expect(actionsFor(status, viewer)).toEqual([]);
    }
  });
});

describe('what is read out after approving or rejecting', () => {
  it('counts the statements', () => {
    expect(approvedMessage(1)).toBe('Statement approved.');
    expect(approvedMessage(4)).toBe('4 statements approved.');
    expect(rejectedMessage(1)).toBe('Statement rejected.');
    expect(rejectedMessage(2)).toBe('2 statements rejected.');
  });
});

describe('the ticked statements', () => {
  const current = profile({
    claims: [
      claim({ id: 'a', status: 'proposed' }),
      claim({ id: 'b', status: 'proposed' }),
      claim({ id: 'c', status: 'approved' }),
    ],
  });

  it('adds and removes one at a time', () => {
    const one = withSelection(new Set(), 'a', true);
    expect([...one]).toEqual(['a']);
    expect([...withSelection(one, 'b', true)]).toEqual(['a', 'b']);
    expect([...withSelection(one, 'a', false)]).toEqual([]);
  });

  it('returns the same set when nothing changes', () => {
    const one: ReadonlySet<string> = new Set(['a']);
    expect(withSelection(one, 'a', true)).toBe(one);
    expect(withSelection(one, 'b', false)).toBe(one);
  });

  it('drops a statement that is no longer a proposal', () => {
    expect([...liveSelection(new Set(['a', 'c', 'gone']), current)]).toEqual(['a']);
  });

  it('keeps the same set while every ticked statement is still a proposal', () => {
    const ticked: ReadonlySet<string> = new Set(['a', 'b']);
    expect(liveSelection(ticked, current)).toBe(ticked);
    const none: ReadonlySet<string> = new Set();
    expect(liveSelection(none, current)).toBe(none);
  });
});

describe('drafting', () => {
  it('works one of two ways, and says “unknown” until the app knows which', () => {
    expect(draftMode({ connected: true })).toBe('assistant');
    expect(draftMode({ connected: false })).toBe('verbatim');
    expect(draftMode(null)).toBe('unknown');
  });

  it('explains both ways without naming who makes the assistant', () => {
    expect(DRAFT_WAYS.assistant.body).toContain('citations');
    expect(DRAFT_WAYS.assistant.body).toContain('disagree');
    expect(DRAFT_WAYS.verbatim.body).toContain('word for word');
    expect(DRAFT_WAYS.verbatim.body).toContain('cannot compare documents');
  });

  it('says how a draft ended, and calls a stopped draft stopped', () => {
    expect(draftEndedMessage('completed')).toBe('The profile draft is ready to review.');
    expect(draftEndedMessage('failed')).toBe('The profile draft did not finish.');
    expect(draftEndedMessage('cancelled')).toBe('The profile draft was stopped.');
    expect(draftEndedMessage('running')).toBe('');
  });

  it('says when and how the last draft was made', () => {
    const when = (ms: number) => `day ${ms}`;
    expect(lastDraftText({ lastRunAt: null, method: null }, when)).toBe(
      'No draft has been made yet.',
    );
    expect(lastDraftText({ lastRunAt: 7, method: 'assistant' }, when)).toBe(
      'Last drafted day 7, with a connected assistant.',
    );
    expect(lastDraftText({ lastRunAt: 7, method: 'verbatim' }, when)).toBe(
      'Last drafted day 7, word for word and without an assistant.',
    );
    expect(lastDraftText({ lastRunAt: 7, method: null }, when)).toBe('Last drafted day 7.');
  });
});

describe('effectiveProfile', () => {
  const loaded = profile({ updatedAt: 1 });
  const changed = profile({ updatedAt: 2 });

  it('shows a change’s own answer over the profile it was made on', () => {
    expect(effectiveProfile(loaded, { profile: changed, over: loaded })).toBe(changed);
  });

  it('gives way as soon as a newer read arrives', () => {
    const reread = profile({ updatedAt: 3 });
    expect(effectiveProfile(reread, { profile: changed, over: loaded })).toBe(reread);
  });

  it('shows what was loaded when nothing has changed', () => {
    expect(effectiveProfile(loaded, null)).toBe(loaded);
    expect(effectiveProfile(undefined, null)).toBeUndefined();
  });

  it('can show an answer before the first read has finished', () => {
    expect(effectiveProfile(undefined, { profile: changed, over: undefined })).toBe(changed);
  });
});

describe('addedClaims', () => {
  it('finds the statements a change added', () => {
    const before = profile({ claims: [claim({ id: 'a' })] });
    const after = profile({ claims: [claim({ id: 'a' }), claim({ id: 'b' })] });
    expect(addedClaims(before, after).map((entry) => entry.id)).toEqual(['b']);
    expect(addedClaims(undefined, after).map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(addedClaims(after, after)).toEqual([]);
  });
});

describe('focusAfterChange', () => {
  const current = profile({
    claims: [
      claim({ id: 'kept', status: 'approved', field: 'programs' }),
      claim({ id: 'declined', status: 'rejected', field: 'programs' }),
    ],
  });

  it('follows a statement that is still listed, wherever it is listed now', () => {
    expect(focusAfterChange(current, { claimId: 'kept', field: 'mission' })).toEqual({
      claimId: 'kept',
      field: 'programs',
    });
  });

  it('goes to the field’s heading when the statement was removed', () => {
    expect(focusAfterChange(current, { claimId: 'gone', field: 'capacity' })).toEqual({
      claimId: null,
      field: 'capacity',
    });
    expect(focusAfterChange(current, { claimId: null, field: 'mission' })).toEqual({
      claimId: null,
      field: 'mission',
    });
  });

  it('goes to the heading for a rejected statement, which sits in a closed list', () => {
    expect(focusAfterChange(current, { claimId: 'declined', field: 'mission' })).toEqual({
      claimId: null,
      field: 'programs',
    });
  });
});

describe('excerpt', () => {
  it('leaves a short statement as it is, on one line', () => {
    expect(excerpt('  We feed\n our  neighbors. ')).toBe('We feed our neighbors.');
  });

  it('cuts a long one at a word and marks the cut', () => {
    const long =
      'Riverbend Kitchen works so that every household in the east side has enough to eat, every week of the year.';
    const short = excerpt(long, 40);
    expect(short.length).toBeLessThanOrEqual(41);
    expect(short.endsWith('…')).toBe(true);
    expect(long.startsWith(short.slice(0, -1))).toBe(true);
    expect(short.slice(0, -1).endsWith(' ')).toBe(false);
  });

  it('still cuts text that has no spaces', () => {
    expect(excerpt('x'.repeat(200), 10)).toBe(`${'x'.repeat(10)}…`);
  });
});
