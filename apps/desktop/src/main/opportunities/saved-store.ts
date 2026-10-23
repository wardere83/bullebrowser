// The listings an organization has saved. A saved listing is a snapshot: the
// status shown later is recomputed from its deadline and the time it was last
// read from the source, so it can only become less certain until it is
// re-checked. Kept per organization, like everything else it holds.

import type { Opportunity, SavedOpportunity } from '../../shared/funding.js';
import { FundingError } from '../funding/errors.js';
import { orgPath, readJson, writeJson } from '../funding/org-store.js';
import { refreshStatus } from './status.js';

interface SavedFile {
  schemaVersion: 1;
  saved: SavedOpportunity[];
}

const MAX_SAVED = 500;
const MAX_NOTE_CHARS = 2_000;
const ID_RE = /^[a-z0-9-]{2,40}:[\w.:/+=-]{1,200}$/i;

/** Listing ids come from the renderer; anything that is not source:record is refused. */
export function assertOpportunityId(value: unknown): string {
  if (typeof value !== 'string' || !ID_RE.test(value)) {
    throw new FundingError('INVALID_INPUT', 'That listing is not valid.');
  }
  return value;
}

export class SavedOpportunityStore {
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly timeZoneFor: (opportunity: Opportunity) => string,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private file(organizationId: string): string {
    return orgPath(organizationId, 'opportunities', 'saved.json');
  }

  private async read(organizationId: string): Promise<SavedOpportunity[]> {
    const stored = await readJson<Partial<SavedFile>>(this.file(organizationId), {});
    const saved = Array.isArray(stored.saved) ? stored.saved : [];
    return saved.filter((entry) => entry && entry.organizationId === organizationId && entry.opportunity);
  }

  private change<T>(organizationId: string, apply: (saved: SavedOpportunity[]) => { saved: SavedOpportunity[]; result: T }): Promise<T> {
    const previous = this.queues.get(organizationId) ?? Promise.resolve();
    const run = previous.then(async () => {
      const { saved, result } = apply(await this.read(organizationId));
      await writeJson(this.file(organizationId), { schemaVersion: 1, saved } satisfies SavedFile);
      return result;
    });
    this.queues.set(
      organizationId,
      run.catch(() => {}),
    );
    return run;
  }

  /** Saved listings, newest first, with their status aged to now. */
  async list(organizationId: string): Promise<SavedOpportunity[]> {
    const now = this.now();
    return (await this.read(organizationId))
      .map((entry) => ({
        ...entry,
        opportunity: refreshStatus(entry.opportunity, now, this.timeZoneFor(entry.opportunity)),
      }))
      .sort((a, b) => b.savedAt - a.savedAt);
  }

  async get(organizationId: string, opportunityId: string): Promise<SavedOpportunity | null> {
    assertOpportunityId(opportunityId);
    return (await this.list(organizationId)).find((entry) => entry.opportunity.id === opportunityId) ?? null;
  }

  async save(organizationId: string, opportunity: Opportunity): Promise<SavedOpportunity[]> {
    assertOpportunityId(opportunity.id);
    await this.change(organizationId, (saved) => {
      const existing = saved.find((entry) => entry.opportunity.id === opportunity.id);
      if (existing) {
        // Saving again refreshes the snapshot and keeps the note.
        return {
          saved: saved.map((entry) =>
            entry === existing ? { ...entry, opportunity, recheckedAt: opportunity.fetchedAt } : entry,
          ),
          result: null,
        };
      }
      if (saved.length >= MAX_SAVED) {
        throw new FundingError('INVALID_INPUT', `You can save up to ${MAX_SAVED} listings. Remove some first.`);
      }
      const now = this.now();
      return {
        saved: [...saved, { organizationId, opportunity, savedAt: now, note: '', recheckedAt: opportunity.fetchedAt }],
        result: null,
      };
    });
    return this.list(organizationId);
  }

  async unsave(organizationId: string, opportunityId: string): Promise<SavedOpportunity[]> {
    assertOpportunityId(opportunityId);
    await this.change(organizationId, (saved) => ({
      saved: saved.filter((entry) => entry.opportunity.id !== opportunityId),
      result: null,
    }));
    return this.list(organizationId);
  }

  async setNote(organizationId: string, opportunityId: string, note: string): Promise<SavedOpportunity[]> {
    assertOpportunityId(opportunityId);
    if (typeof note !== 'string') throw new FundingError('INVALID_INPUT', 'That note is not valid.');
    const cleaned = note.replace(/[\p{Cc}\p{Cf}]/gu, (character) => (character === '\n' ? '\n' : ' ')).slice(0, MAX_NOTE_CHARS);
    await this.change(organizationId, (saved) => {
      if (!saved.some((entry) => entry.opportunity.id === opportunityId)) {
        throw new FundingError('NOT_FOUND', 'That listing is no longer saved.');
      }
      return {
        saved: saved.map((entry) => (entry.opportunity.id === opportunityId ? { ...entry, note: cleaned } : entry)),
        result: null,
      };
    });
    return this.list(organizationId);
  }

  /** Stores a freshly re-read listing in place of the snapshot. */
  async replace(organizationId: string, opportunity: Opportunity): Promise<void> {
    await this.change(organizationId, (saved) => ({
      saved: saved.map((entry) =>
        entry.opportunity.id === opportunity.id ? { ...entry, opportunity, recheckedAt: this.now() } : entry,
      ),
      result: null,
    }));
  }
}
