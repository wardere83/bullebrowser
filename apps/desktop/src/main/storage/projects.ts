// Project store. A project is a named, standing context — instructions plus a
// set of session files — that the user can attach to a run via the "+" menu so
// the agent knows the task belongs to that project. Metadata only; file bytes
// live in the session-file store, referenced by id.

import { randomUUID } from 'node:crypto';
import type { ProjectDetail, ProjectSummary } from '../../shared/ipc.js';
import { createStore } from './store.js';
import { sessionFileStore } from './session-files.js';

interface ProjectsSchema extends Record<string, unknown> {
  projects: ProjectDetail[];
}

const toSummary = (p: ProjectDetail): ProjectSummary => ({
  id: p.id,
  name: p.name,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
  fileCount: p.fileIds.length,
});

class ProjectStore {
  private store = createStore<ProjectsSchema>('projects', { projects: [] });

  // Session files expire after 8 days, but a project keeps referencing them by
  // id. Drop ids whose file is gone so the UI's "N files" matches what the
  // agent will actually receive, rather than counting files it can no longer
  // read. Read-side only — the stored list is left alone.
  private live(p: ProjectDetail): ProjectDetail {
    const fileIds = p.fileIds.filter((id) => sessionFileStore.get(id) !== null);
    return fileIds.length === p.fileIds.length
      ? p
      : { ...p, fileIds, fileCount: fileIds.length };
  }

  // A project carries standing instructions and files, so it stays with the
  // organization it was made under. With no organization argument every project
  // is visible (the behaviour before organizations); projects from before
  // organizations are unbound and visible to all.
  private visibleTo(project: ProjectDetail, organizationId: string | null | undefined): boolean {
    if (organizationId === undefined) return true;
    const owner = project.organizationId ?? null;
    return owner === null || owner === organizationId;
  }

  list(organizationId?: string | null): ProjectSummary[] {
    return this.store
      .get('projects')
      .filter((p) => this.visibleTo(p, organizationId))
      .map((p) => toSummary(this.live(p)))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string, organizationId?: string | null): ProjectDetail | null {
    const found = this.store.get('projects').find((p) => p.id === id);
    return found && this.visibleTo(found, organizationId) ? this.live(found) : null;
  }

  create(name: string, organizationId?: string | null): ProjectDetail {
    const now = Date.now();
    const project: ProjectDetail = {
      id: randomUUID(),
      name: name.trim() || 'Untitled project',
      createdAt: now,
      updatedAt: now,
      fileCount: 0,
      instructions: '',
      fileIds: [],
      ...(organizationId ? { organizationId } : {}),
    };
    this.store.set('projects', [project, ...this.store.get('projects')]);
    return project;
  }

  private write(id: string, mutate: (p: ProjectDetail) => ProjectDetail): ProjectDetail | null {
    const all = this.store.get('projects');
    const idx = all.findIndex((p) => p.id === id);
    const existing = idx === -1 ? undefined : all[idx];
    if (!existing) return null;
    const updated = { ...mutate(existing), updatedAt: Date.now() };
    updated.fileCount = updated.fileIds.length;
    const next = [...all];
    next[idx] = updated;
    this.store.set('projects', next);
    return updated;
  }

  update(id: string, patch: { name?: string; instructions?: string }): ProjectDetail | null {
    return this.write(id, (p) => ({
      ...p,
      ...(patch.name !== undefined ? { name: patch.name.trim() || p.name } : {}),
      ...(patch.instructions !== undefined ? { instructions: patch.instructions } : {}),
    }));
  }

  attachFiles(id: string, fileIds: string[]): ProjectDetail | null {
    return this.write(id, (p) => ({
      ...p,
      // De-dupe so re-attaching the same file is a no-op.
      fileIds: Array.from(new Set([...p.fileIds, ...fileIds])),
    }));
  }

  delete(id: string): void {
    this.store.set(
      'projects',
      this.store.get('projects').filter((p) => p.id !== id),
    );
  }

  /** Removes every project bound to an organization, e.g. when it is deleted. */
  deleteForOrganization(organizationId: string): number {
    const all = this.store.get('projects');
    const kept = all.filter((p) => (p.organizationId ?? null) !== organizationId);
    if (kept.length !== all.length) this.store.set('projects', kept);
    return all.length - kept.length;
  }
}

export const projectStore = new ProjectStore();
