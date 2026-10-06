import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Opportunity } from '../../shared/funding.js';

let userData: string;
vi.mock('electron', () => ({ app: { getPath: () => userData } }));

const { SavedOpportunityStore, assertOpportunityId } = await import('./saved-store.js');
const { STALE_AFTER_MS } = await import('./status.js');
const { orgPath, writeJson } = await import('../funding/org-store.js');

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const NOW = Date.UTC(2026, 9, 6, 12);

const listing = (id: string, extra: Partial<Opportunity> = {}): Opportunity =>
  ({
    id,
    sourceId: id.split(':')[0],
    title: `Listing ${id}`,
    status: 'active',
    statusReason: 'Open at the source.',
    unverifiedReason: null,
    closeDate: '2026-11-15',
    fetchedAt: NOW,
    ...extra,
  }) as Opportunity;

let time = NOW;
const store = () => new SavedOpportunityStore(() => 'America/New_York', () => time);

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'bb-saved-'));
  time = NOW;
});

describe('saved listings', () => {
  it('saves, annotates and removes, newest first', async () => {
    const saved = store();
    await saved.save(ORG_A, listing('grants-gov:101'));
    time += 1000;
    const after = await saved.save(ORG_A, listing('ca-grants-portal:7'));
    expect(after.map((entry) => entry.opportunity.id)).toEqual(['ca-grants-portal:7', 'grants-gov:101']);
    expect(after[0]).toMatchObject({ organizationId: ORG_A, note: '', savedAt: time });

    const noted = await saved.setNote(ORG_A, 'grants-gov:101', 'Ask the board on Tuesday.\nCheck the match.');
    expect(noted.find((entry) => entry.opportunity.id === 'grants-gov:101')!.note).toBe('Ask the board on Tuesday.\nCheck the match.');
    expect((await saved.unsave(ORG_A, 'grants-gov:101')).map((entry) => entry.opportunity.id)).toEqual(['ca-grants-portal:7']);
    expect(await saved.get(ORG_A, 'grants-gov:101')).toBeNull();
  });

  it('refreshes the snapshot and keeps the note when saved again', async () => {
    const saved = store();
    await saved.save(ORG_A, listing('grants-gov:101'));
    await saved.setNote(ORG_A, 'grants-gov:101', 'keep me');
    const again = await saved.save(ORG_A, listing('grants-gov:101', { title: 'Updated title', fetchedAt: NOW + 5 }));
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ note: 'keep me', recheckedAt: NOW + 5 });
    expect(again[0]!.opportunity.title).toBe('Updated title');
  });

  it('ages a saved listing: stale after a day, expired after its deadline, never back to active', async () => {
    const saved = store();
    await saved.save(ORG_A, listing('grants-gov:101'));
    time = NOW + STALE_AFTER_MS + 1;
    expect((await saved.list(ORG_A))[0]!.opportunity).toMatchObject({ status: 'unverified', unverifiedReason: 'stale' });
    time = Date.UTC(2026, 10, 20, 12);
    expect((await saved.list(ORG_A))[0]!.opportunity.status).toBe('expired');
    // What is stored is the snapshot; only a real re-read changes it.
    await saved.replace(ORG_A, listing('grants-gov:101', { closeDate: '2027-01-31', fetchedAt: time }));
    expect((await saved.list(ORG_A))[0]!.opportunity).toMatchObject({ status: 'active', closeDate: '2027-01-31' });
  });

  it('keeps organizations apart', async () => {
    const saved = store();
    await saved.save(ORG_A, listing('grants-gov:101'));
    await saved.save(ORG_B, listing('grants-gov:202'));
    expect((await saved.list(ORG_A)).map((entry) => entry.opportunity.id)).toEqual(['grants-gov:101']);
    expect((await saved.list(ORG_B)).map((entry) => entry.opportunity.id)).toEqual(['grants-gov:202']);
    expect(await saved.get(ORG_B, 'grants-gov:101')).toBeNull();
    await expect(saved.setNote(ORG_B, 'grants-gov:101', 'x')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // A file copied in from another organization is ignored.
    await writeJson(orgPath(ORG_B, 'opportunities', 'saved.json'), { schemaVersion: 1, saved: await saved.list(ORG_A) });
    expect(await saved.list(ORG_B)).toEqual([]);
  });

  it('refuses malformed listing and organization ids', async () => {
    const saved = store();
    for (const id of ['', 'no-colon', '../../x:1', 'a:' + 'x'.repeat(300), 'grants gov:1', 42]) {
      expect(() => assertOpportunityId(id)).toThrow('That listing is not valid.');
    }
    await expect(saved.save(ORG_A, listing('bad id'))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(saved.list('../' + ORG_B)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(saved.setNote(ORG_A, 'grants-gov:1', 5 as unknown as string)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('strips hidden characters from notes and caps their length', async () => {
    const saved = store();
    await saved.save(ORG_A, listing('grants-gov:101'));
    const hidden = String.fromCodePoint(0x202e);
    const [entry] = await saved.setNote(ORG_A, 'grants-gov:101', `call${hidden}funder ${'x'.repeat(5000)}`);
    expect(entry!.note.startsWith('call funder ')).toBe(true);
    expect(entry!.note).toHaveLength(2000);
  });

  it('keeps every save when several arrive at once', async () => {
    const saved = store();
    await Promise.all(Array.from({ length: 12 }, (_, n) => saved.save(ORG_A, listing(`grants-gov:${n}`))));
    expect(await saved.list(ORG_A)).toHaveLength(12);
  });
});
