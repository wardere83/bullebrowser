// Where an organization's proposal guides are kept.
//
//   <organization>/guides/<guideId>.json
//
// One file for each guide, inside the directory of the organization it was
// written for. Every call names that organization and reaches no other. A file
// that says it belongs to a different organization, or does not hold a guide
// at all, is treated as though it were not there.

import { readdir } from 'node:fs/promises';
import type { GuideSession } from '../../shared/funding.js';
import { FundingError } from '../funding/errors.js';
import { assertUuid, isUuid, orgPath, readJson, removePath, writeJson } from '../funding/org-store.js';
import type { GuideStoreApi } from '../funding/services.js';

const AREA = 'guides';
const EXTENSION = '.json';

function isGuide(value: unknown, organizationId: string, guideId: string): value is GuideSession {
  if (typeof value !== 'object' || value === null) return false;
  const guide = value as Partial<GuideSession>;
  return (
    guide.schemaVersion === 1 &&
    guide.id === guideId &&
    // A file copied in from elsewhere must not bring another organization's guide with it.
    guide.organizationId === organizationId &&
    typeof guide.rfpId === 'string' &&
    typeof guide.title === 'string' &&
    (guide.mode === 'full' || guide.mode === 'limited') &&
    typeof guide.createdAt === 'number' &&
    typeof guide.updatedAt === 'number' &&
    typeof guide.aiUse === 'object' &&
    guide.aiUse !== null &&
    Array.isArray(guide.principles) &&
    Array.isArray(guide.outline) &&
    Array.isArray(guide.feedback)
  );
}

export class GuideStore implements GuideStoreApi {
  private readonly now: () => number;

  constructor(deps: { now?: () => number } = {}) {
    this.now = deps.now ?? (() => Date.now());
  }

  private file(organizationId: string, guideId: string): string {
    return orgPath(organizationId, AREA, `${assertUuid(guideId, 'guide')}${EXTENSION}`);
  }

  private async read(organizationId: string, guideId: string): Promise<GuideSession | null> {
    const stored = await readJson<unknown>(this.file(organizationId, guideId), null);
    return isGuide(stored, organizationId, guideId) ? stored : null;
  }

  /** Newest first. */
  async list(organizationId: string): Promise<GuideSession[]> {
    let names: string[];
    try {
      names = await readdir(orgPath(organizationId, AREA));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const ids = names
      .filter((name) => name.endsWith(EXTENSION))
      .map((name) => name.slice(0, -EXTENSION.length))
      .filter(isUuid);
    const guides = await Promise.all(ids.map((id) => this.read(organizationId, id)));
    return guides
      .filter((guide): guide is GuideSession => guide !== null)
      .sort((a, b) => b.createdAt - a.createdAt || b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : 1));
  }

  async get(organizationId: string, guideId: string): Promise<GuideSession | null> {
    return this.read(organizationId, guideId);
  }

  /**
   * Stores a guide. A guide that is already here keeps the time it was first
   * created and is marked as changed now, so its history cannot be rewritten
   * by a later save.
   */
  async save(organizationId: string, guide: GuideSession): Promise<void> {
    const file = this.file(organizationId, guide.id);
    if (guide.organizationId !== organizationId) {
      throw new FundingError('INVALID_INPUT', 'That guide belongs to a different organization.');
    }
    const earlier = await this.read(organizationId, guide.id);
    const stored: GuideSession = earlier
      ? { ...guide, createdAt: earlier.createdAt, updatedAt: Math.max(this.now(), earlier.updatedAt) }
      : guide;
    await writeJson(file, stored);
  }

  async remove(organizationId: string, guideId: string): Promise<void> {
    const file = this.file(organizationId, guideId);
    if (!(await this.read(organizationId, guideId))) {
      throw new FundingError('NOT_FOUND', 'That guide is no longer here.');
    }
    await removePath(file);
  }

  /** Removes the guides written for a funding document that is being removed. */
  async removeForRfp(organizationId: string, rfpId: string): Promise<void> {
    // An empty id would name every general guide, so only a real document id is accepted.
    assertUuid(rfpId, 'funding document');
    const guides = await this.list(organizationId);
    await Promise.all(
      guides.filter((guide) => guide.rfpId === rfpId).map((guide) => removePath(this.file(organizationId, guide.id))),
    );
  }
}
