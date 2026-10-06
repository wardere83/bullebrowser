// Long-running funding work: reading a profile out of documents, analyzing an
// RFP, assessing alignment, preparing a guide. A job reports progress to the
// renderer, can be cancelled, and ends in exactly one of three states. The
// same subject cannot run the same kind of job twice at once.

import { randomUUID } from 'node:crypto';
import type { FundingEvent, JobKind, JobProgress } from '../../shared/funding.js';
import { FundingError, isCancellation, toPublicError } from './errors.js';

export interface JobContext {
  signal: AbortSignal;
  /** Tells the user what is happening now. Percent is 0–100, or null if unknown. */
  progress(message: string, percent?: number | null): void;
}

export interface JobRequest {
  kind: JobKind;
  organizationId: string;
  /** The document, RFP or guide this work is about; empty when there is none. */
  subjectId: string;
  /** The first progress message. */
  message: string;
}

interface Running {
  job: JobProgress;
  controller: AbortController;
  /** Reports the job as stopped now, without waiting for the work to unwind. */
  stop(): void;
}

/** Finished jobs are kept this long so a screen opened late can still show the result. */
const KEEP_FINISHED_MS = 10 * 60 * 1000;
const MIN_PROGRESS_INTERVAL_MS = 150;

export class JobManager {
  private readonly running = new Map<string, Running>();
  // Stopped by the user, but the work has not let go yet. Shown as stopped at
  // once; the same work cannot start again until this one has really ended.
  private readonly unwinding = new Map<string, JobProgress>();
  private finished: JobProgress[] = [];

  constructor(
    private readonly emit: (event: FundingEvent) => void,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Starts the work without waiting for it. `done` settles when it ends and
   * never rejects: the outcome is in the job's final state.
   */
  start(
    request: JobRequest,
    run: (context: JobContext) => Promise<void>,
  ): { jobId: string; done: Promise<JobProgress> } {
    const same = (job: JobProgress) =>
      job.kind === request.kind &&
      job.organizationId === request.organizationId &&
      job.subjectId === request.subjectId;
    if ([...this.running.values()].some(({ job }) => same(job))) {
      throw new FundingError('BUSY', 'That is already in progress.');
    }
    if ([...this.unwinding.values()].some(same)) {
      throw new FundingError('BUSY', 'The last run is still stopping. Try again in a moment.');
    }

    const controller = new AbortController();
    const job: JobProgress = {
      id: randomUUID(),
      kind: request.kind,
      organizationId: request.organizationId,
      subjectId: request.subjectId,
      state: 'running',
      message: request.message,
      percent: null,
      startedAt: this.now(),
      finishedAt: null,
      error: null,
    };
    this.publish(job);

    let lastSent = this.now();
    const context: JobContext = {
      signal: controller.signal,
      progress: (message, percent = null) => {
        if (job.state !== 'running') return;
        job.message = message;
        job.percent = percent === null ? null : Math.max(0, Math.min(100, Math.round(percent)));
        const time = this.now();
        if (time - lastSent >= MIN_PROGRESS_INTERVAL_MS) {
          lastSent = time;
          this.publish(job);
        }
      },
    };

    const finish = (patch: Pick<JobProgress, 'state' | 'message' | 'error'>): JobProgress => {
      // Already reported as stopped: what the work did afterwards changes nothing.
      if (job.state !== 'running') return { ...job };
      Object.assign(job, patch, {
        finishedAt: this.now(),
        percent: patch.state === 'completed' ? 100 : job.percent,
      });
      this.running.delete(job.id);
      this.finished = [{ ...job }, ...this.finished].slice(0, 50);
      this.publish(job);
      return { ...job };
    };
    this.running.set(job.id, {
      job,
      controller,
      stop: () => {
        if (job.state !== 'running') return;
        this.unwinding.set(job.id, job);
        finish({ state: 'cancelled', message: 'Cancelled.', error: null });
      },
    });

    // Started at once, so a cancel that arrives immediately is seen by the work.
    let work: Promise<void>;
    try {
      work = run(context);
    } catch (error) {
      work = Promise.reject(error);
    }
    const done = work
      .then(
        () =>
          controller.signal.aborted
            ? finish({ state: 'cancelled', message: 'Cancelled.', error: null })
            : finish({ state: 'completed', message: 'Done.', error: null }),
        (error: unknown) => {
          if (controller.signal.aborted || isCancellation(error)) {
            return finish({ state: 'cancelled', message: 'Cancelled.', error: null });
          }
          const publicError = toPublicError(error);
          return finish({ state: 'failed', message: publicError.message, error: publicError });
        },
      )
      .finally(() => this.unwinding.delete(job.id));
    return { jobId: job.id, done };
  }

  /** Cancels a running job that belongs to the organization. */
  cancel(jobId: string, organizationId: string): boolean {
    const entry = this.running.get(jobId);
    if (!entry || entry.job.organizationId !== organizationId) return false;
    entry.controller.abort();
    entry.stop();
    return true;
  }

  /** Cancels what is running for one document, RFP or guide, e.g. before it is removed. */
  cancelSubject(organizationId: string, subjectId: string): void {
    for (const entry of [...this.running.values()]) {
      if (entry.job.organizationId === organizationId && entry.job.subjectId === subjectId) {
        entry.controller.abort();
        entry.stop();
      }
    }
  }

  /** Cancels everything an organization has running, e.g. before it is deleted. */
  cancelAll(organizationId: string): void {
    for (const entry of [...this.running.values()]) {
      if (entry.job.organizationId === organizationId) {
        entry.controller.abort();
        entry.stop();
      }
    }
  }

  /** Running jobs and those that finished recently, for one organization. */
  list(organizationId: string): JobProgress[] {
    const cutoff = this.now() - KEEP_FINISHED_MS;
    this.finished = this.finished.filter((job) => (job.finishedAt ?? 0) >= cutoff);
    return [...[...this.running.values()].map(({ job }) => ({ ...job })), ...this.finished].filter(
      (job) => job.organizationId === organizationId,
    );
  }

  private publish(job: JobProgress): void {
    this.emit({ kind: 'job', job: { ...job } });
  }
}
