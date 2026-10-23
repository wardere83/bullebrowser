import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgActivity } from '../../shared/funding.js';

let userData: string;
vi.mock('electron', () => ({ app: { getPath: () => userData } }));

const { ACTIVITY_LIMIT, closeActivity, listActivity, recordActivity, reopenActivity } = await import('./activity.js');
const { orgPath, organizationsRoot, removeOrganizationData, writeJson } = await import('../funding/org-store.js');

const USER = '99999999-9999-4999-8999-999999999999';
// An id with letters in it, for the tests about spelling one in capitals.
const LETTERED = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
// A word whose letters are held apart by an invisible joiner, as some scripts need.
const JOINED = '\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Fresh ids for every test: a record that one test closes stays closed.
let orgA: string;
let orgB: string;

const activityFile = (organizationId: string) => orgPath(organizationId, 'activity.json');
const details = (entries: OrgActivity[]) => entries.map((entry) => entry.detail);
const silenceErrors = () => vi.spyOn(console, 'error').mockImplementation(() => {});

/** Entries as the app writes them, newest first: "seed <count>" down to "seed 1". */
function seed(organizationId: string, count: number): OrgActivity[] {
  return Array.from({ length: count }, (_, n) => ({
    id: randomUUID(),
    organizationId,
    at: 1_000 + count - n,
    actorId: USER,
    action: 'document_added' as const,
    detail: `seed ${count - n}`,
  }));
}

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'bb-activity-'));
  orgA = randomUUID();
  orgB = randomUUID();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  // The data directory is removed again so that test runs do not pile up on disk.
  rmSync(userData, { recursive: true, force: true });
});

describe('recording activity', () => {
  it("notes who did what and when, newest first, in the organization's own directory", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_800_000_000_000);
    await recordActivity(orgA, USER, 'document_added', 'Strategic plan 2026.pdf');
    vi.setSystemTime(1_800_000_060_000);
    await recordActivity(orgA, USER, 'claims_approved', '3 claims');

    const entries = await listActivity(orgA);
    expect(entries).toEqual([
      {
        id: expect.stringMatching(UUID),
        organizationId: orgA,
        at: 1_800_000_060_000,
        actorId: USER,
        action: 'claims_approved',
        detail: '3 claims',
      },
      {
        id: expect.stringMatching(UUID),
        organizationId: orgA,
        at: 1_800_000_000_000,
        actorId: USER,
        action: 'document_added',
        detail: 'Strategic plan 2026.pdf',
      },
    ]);
    expect(entries[0]!.id).not.toBe(entries[1]!.id);
    expect(JSON.parse(readFileSync(activityFile(orgA), 'utf8'))).toEqual({ schemaVersion: 1, entries });
    expect(readdirSync(orgPath(orgA))).toEqual(['activity.json']);
  });

  it.each([
    ['line breaks and tabs', 'line one\nline two\r\n\tline three', 'line one line two line three'],
    ['padding', '   padded \u00a0  out   ', 'padded out'],
    ['a control character', 'nul\u0000byte', 'nul byte'],
    ['a direction override that hides an extension', 'report\u202efdp.exe', 'report fdp.exe'],
    ['a line separator', 'sep\u2028arated', 'sep arated'],
    ['half of a broken character', 'half\ud83d of one', 'half of one'],
    ['text that is already one line', 'Annual report (final).docx', 'Annual report (final).docx'],
    ['joiners that a script needs', JOINED, JOINED],
  ])('keeps the detail to one line: %s', async (_label, given, kept) => {
    await recordActivity(orgA, USER, 'document_added', given);
    expect(details(await listActivity(orgA))).toEqual([kept]);
  });

  it('cuts a long detail to 200 characters without splitting one', async () => {
    await recordActivity(orgA, USER, 'document_added', 'x'.repeat(5_000));
    await recordActivity(orgA, USER, 'document_added', '\u{1F600}'.repeat(300));
    await recordActivity(orgA, USER, 'document_added', 'y'.repeat(200));
    await recordActivity(orgA, USER, 'rfp_analyzed', `${'Paragraph of a document.\n'.repeat(400)}`);
    const [pasted, exact, emoji, plain] = details(await listActivity(orgA));

    expect(plain).toBe(`${'x'.repeat(199)}…`);
    expect(Array.from(emoji!)).toHaveLength(200);
    expect(emoji!.endsWith('…')).toBe(true);
    expect(/\p{Cs}/u.test(emoji!)).toBe(false);
    expect(exact).toBe('y'.repeat(200));
    expect(Array.from(pasted!).length).toBeLessThanOrEqual(200);
    expect(pasted).not.toMatch(/\n/);

    // It is cut before it is saved: a pasted document never reaches the disk.
    const saved = JSON.parse(readFileSync(activityFile(orgA), 'utf8')) as { entries: OrgActivity[] };
    expect(details(saved.entries)).toEqual([pasted, exact, emoji, plain]);
    expect(readFileSync(activityFile(orgA), 'utf8').length).toBeLessThan(2_500);
  });

  it('records an empty label when the detail or the actor is not text', async () => {
    await recordActivity(orgA, undefined as unknown as string, 'guide_started', 42 as unknown as string);
    expect(await listActivity(orgA)).toMatchObject([{ actorId: '', detail: '', action: 'guide_started' }]);
  });

  it(`keeps the newest ${ACTIVITY_LIMIT} entries`, async () => {
    expect(ACTIVITY_LIMIT).toBe(500);
    await writeJson(activityFile(orgA), { schemaVersion: 1, entries: seed(orgA, 499) });
    await recordActivity(orgA, USER, 'rfp_added', 'new 1');
    await recordActivity(orgA, USER, 'rfp_added', 'new 2');
    await recordActivity(orgA, USER, 'rfp_added', 'new 3');

    const all = details(await listActivity(orgA, ACTIVITY_LIMIT));
    expect(all).toHaveLength(500);
    expect(all.slice(0, 4)).toEqual(['new 3', 'new 2', 'new 1', 'seed 499']);
    expect(all.at(-1)).toBe('seed 3');
    const onDisk = JSON.parse(readFileSync(activityFile(orgA), 'utf8')) as { entries: unknown[] };
    expect(onDisk.entries).toHaveLength(500);
  });

  it('keeps every entry when many are recorded at the same moment', async () => {
    await Promise.all(
      Array.from({ length: 40 }, (_, n) => recordActivity(orgA, USER, 'document_added', `file ${n}`)),
    );
    const expected = Array.from({ length: 40 }, (_, n) => `file ${39 - n}`);
    expect(details(await listActivity(orgA))).toEqual(expected);
    expect(readdirSync(orgPath(orgA))).toEqual(['activity.json']);
  });

  it('includes an entry that is still being written in the next listing', async () => {
    const writing = recordActivity(orgA, USER, 'opportunity_saved', 'Community Development Block Grant');
    expect(details(await listActivity(orgA))).toEqual(['Community Development Block Grant']);
    await writing;
  });
});

describe('recording never fails the action it records', () => {
  it('ignores an organization id that is not valid, and writes nothing anywhere', async () => {
    const errors = silenceErrors();
    const ids = ['', '..', `../${orgB}`, `${orgA}/../${orgB}`, 'not-a-uuid', `${orgA} `, '/etc', '../../identity'];
    for (const id of ids) {
      await expect(recordActivity(id, USER, 'document_added', 'x')).resolves.toBeUndefined();
    }
    await expect(
      recordActivity(null as unknown as string, USER, 'document_added', 'x'),
    ).resolves.toBeUndefined();
    expect(existsSync(organizationsRoot())).toBe(false);
    expect(readdirSync(userData)).toEqual([]);
    expect(errors).toHaveBeenCalledTimes(ids.length + 1);
  });

  it("ignores another spelling of an id rather than touching that organization's record", async () => {
    await recordActivity(LETTERED, USER, 'document_added', 'kept');
    const before = readFileSync(activityFile(LETTERED), 'utf8');
    const errors = silenceErrors();
    await recordActivity(LETTERED.toUpperCase(), USER, 'document_deleted', 'should not land');
    expect(errors).toHaveBeenCalledTimes(1);
    expect(readFileSync(activityFile(LETTERED), 'utf8')).toBe(before);
    expect(readdirSync(organizationsRoot())).toEqual([LETTERED]);
  });

  it('ignores an action the app does not record', async () => {
    const errors = silenceErrors();
    for (const action of ['organization_deleted', '', 'constructor', '__proto__', 'DOCUMENT_ADDED']) {
      await expect(
        recordActivity(orgA, USER, action as OrgActivity['action'], 'x'),
      ).resolves.toBeUndefined();
    }
    expect(errors).toHaveBeenCalledTimes(5);
    expect(existsSync(organizationsRoot())).toBe(false);
  });

  it('logs and carries on when the record cannot be written', async () => {
    const errors = silenceErrors();
    // Something else sits where the organization's directory would go.
    mkdirSync(organizationsRoot(), { recursive: true });
    writeFileSync(join(organizationsRoot(), orgA), 'in the way');
    await expect(recordActivity(orgA, USER, 'document_added', 'x')).resolves.toBeUndefined();
    expect(readFileSync(join(organizationsRoot(), orgA), 'utf8')).toBe('in the way');

    // The record itself is not a file.
    mkdirSync(activityFile(orgB), { recursive: true });
    await expect(recordActivity(orgB, USER, 'document_added', 'x')).resolves.toBeUndefined();
    expect(readdirSync(activityFile(orgB))).toEqual([]);
    expect(errors).toHaveBeenCalledTimes(2);

    // A failure is not sticky: another organization's record still works.
    const orgC = randomUUID();
    await recordActivity(orgC, USER, 'document_added', 'fine');
    expect(details(await listActivity(orgC))).toEqual(['fine']);
  });
});

describe('listing activity', () => {
  it('returns 50 entries unless asked for another number', async () => {
    await writeJson(activityFile(orgA), { schemaVersion: 1, entries: seed(orgA, 60) });
    expect(await listActivity(orgA)).toHaveLength(50);
    expect(details(await listActivity(orgA, 3))).toEqual(['seed 60', 'seed 59', 'seed 58']);
    expect(await listActivity(orgA, 2.7)).toHaveLength(2);
    expect(await listActivity(orgA, 1_000_000)).toHaveLength(60);
    for (const limit of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '10', null]) {
      expect(await listActivity(orgA, limit as number)).toHaveLength(50);
    }
  });

  it('is empty for an organization with no record, and creates nothing to find that out', async () => {
    expect(await listActivity(orgA)).toEqual([]);
    expect(existsSync(organizationsRoot())).toBe(false);
  });

  it('refuses an organization id that is not valid', async () => {
    for (const id of ['', '..', `../${orgB}`, `${orgA}/../${orgB}`, 'not-a-uuid', '/etc/passwd', `${orgA}\n`]) {
      await expect(listActivity(id)).rejects.toMatchObject({
        code: 'INVALID_INPUT',
        message: 'That organization is not valid.',
      });
    }
    await expect(listActivity(undefined as unknown as string)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('never shows one organization the entries of another', async () => {
    await recordActivity(orgA, USER, 'document_added', 'plan for A.pdf');
    await recordActivity(orgB, USER, 'document_added', 'plan for B.pdf');
    expect(details(await listActivity(orgA))).toEqual(['plan for A.pdf']);
    expect(details(await listActivity(orgB))).toEqual(['plan for B.pdf']);

    // Even when A's entries have been copied into B's file by hand.
    const fromA = JSON.parse(readFileSync(activityFile(orgA), 'utf8')) as { entries: OrgActivity[] };
    const fromB = JSON.parse(readFileSync(activityFile(orgB), 'utf8')) as { entries: OrgActivity[] };
    writeFileSync(
      activityFile(orgB),
      JSON.stringify({ schemaVersion: 1, entries: [...fromA.entries, ...fromB.entries] }),
    );
    expect(details(await listActivity(orgB))).toEqual(['plan for B.pdf']);
  });

  it('reads nothing through another spelling of an id, whatever the volume does with case', async () => {
    await recordActivity(LETTERED, USER, 'document_added', 'plan.pdf');
    expect(await listActivity(LETTERED.toUpperCase())).toEqual([]);
    expect(details(await listActivity(LETTERED))).toEqual(['plan.pdf']);
  });

  it('shows only the entries of a damaged record that can be trusted, tidied', async () => {
    const good = seed(orgA, 2);
    mkdirSync(orgPath(orgA), { recursive: true });
    writeFileSync(
      activityFile(orgA),
      JSON.stringify({
        schemaVersion: 1,
        entries: [
          null,
          'entry',
          { ...good[0], id: 'not-an-id' },
          { ...good[0], id: randomUUID(), at: 'yesterday' },
          { ...good[0], id: randomUUID(), at: -5 },
          { ...good[0], id: randomUUID(), action: 'made_up' },
          { ...good[0], id: randomUUID(), organizationId: orgB },
          { ...good[0], detail: `two\nlines ${'z'.repeat(400)}`, actorId: 7 },
          good[1],
        ],
      }),
    );
    const entries = await listActivity(orgA);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ id: good[0]!.id, actorId: '' });
    expect(entries[0]!.detail.startsWith('two lines zzz')).toBe(true);
    expect(entries[0]!.detail).toHaveLength(200);
    expect(entries[1]).toEqual(good[1]);
  });

  it('treats a record it cannot parse as empty and leaves the bytes on disk', async () => {
    mkdirSync(orgPath(orgA), { recursive: true });
    writeFileSync(activityFile(orgA), '{"schemaVersion":1,"entries":[{"id":');
    silenceErrors();
    expect(await listActivity(orgA)).toEqual([]);
    const aside = readdirSync(orgPath(orgA)).filter((name) => name.startsWith('activity.json.unreadable-'));
    expect(aside).toHaveLength(1);
    expect(readFileSync(join(orgPath(orgA), aside[0]!), 'utf8')).toBe('{"schemaVersion":1,"entries":[{"id":');
  });

  it.each([
    ['a newer version', { schemaVersion: 2, entries: [{ note: 'from a later build' }] }],
    ['a bare list', [{ note: 'no wrapper' }]],
    ['entries that are not a list', { schemaVersion: 1, entries: 'none' }],
  ])('sets aside %s instead of writing over it', async (_label, content) => {
    mkdirSync(orgPath(orgA), { recursive: true });
    const original = JSON.stringify(content);
    writeFileSync(activityFile(orgA), original);

    // Reading changes nothing.
    expect(await listActivity(orgA)).toEqual([]);
    expect(readdirSync(orgPath(orgA))).toEqual(['activity.json']);

    await recordActivity(orgA, USER, 'document_added', 'first of a new record');
    expect(details(await listActivity(orgA))).toEqual(['first of a new record']);
    const aside = readdirSync(orgPath(orgA)).filter((name) => name.startsWith('activity.json.unreadable-'));
    expect(aside).toHaveLength(1);
    expect(readFileSync(join(orgPath(orgA), aside[0]!), 'utf8')).toBe(original);
  });

  it('reports a record that cannot be read, in plain words', async () => {
    mkdirSync(activityFile(orgA), { recursive: true });
    silenceErrors();
    const failure = listActivity(orgA);
    await expect(failure).rejects.toMatchObject({
      code: 'INTERNAL',
      message: "This organization's activity could not be read. Try again in a moment.",
    });
    await expect(failure).rejects.not.toThrow(/EISDIR|activity\.json|bb-activity/);
  });
});

describe('closing a record when its organization is deleted', () => {
  it('waits for an entry that is being written, then refuses later ones', async () => {
    const writing = recordActivity(orgA, USER, 'document_added', 'in flight');
    // Two turns of the queue: the write has started but cannot have finished.
    await Promise.resolve();
    await Promise.resolve();
    expect(existsSync(activityFile(orgA))).toBe(false);

    await closeActivity(orgA);
    expect(existsSync(activityFile(orgA))).toBe(true);
    await writing;

    await removeOrganizationData(orgA);
    await recordActivity(orgA, USER, 'document_added', 'too late');
    expect(existsSync(orgPath(orgA))).toBe(false);
    expect(await listActivity(orgA)).toEqual([]);
  });

  it('drops an entry that was waiting its turn when the record closed', async () => {
    const waiting = recordActivity(orgA, USER, 'document_added', 'never started');
    await closeActivity(orgA);
    await waiting;
    expect(existsSync(organizationsRoot())).toBe(false);
  });

  it('records again once reopened, and leaves other organizations alone throughout', async () => {
    await closeActivity(orgA);
    await recordActivity(orgA, USER, 'document_added', 'while closed');
    await recordActivity(orgB, USER, 'document_added', 'another organization');
    expect(await listActivity(orgA)).toEqual([]);
    expect(details(await listActivity(orgB))).toEqual(['another organization']);

    reopenActivity(orgA);
    await recordActivity(orgA, USER, 'document_added', 'after reopening');
    expect(details(await listActivity(orgA))).toEqual(['after reopening']);
  });

  it('does nothing for an id that is not valid', async () => {
    await expect(closeActivity(`../${orgB}`)).resolves.toBeUndefined();
    expect(() => reopenActivity('not-a-uuid')).not.toThrow();
    await recordActivity(orgB, USER, 'document_added', 'still recorded');
    expect(details(await listActivity(orgB))).toEqual(['still recorded']);
  });
});
