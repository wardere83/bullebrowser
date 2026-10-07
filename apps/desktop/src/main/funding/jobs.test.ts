import { describe, expect, it, vi } from 'vitest';
import type { FundingEvent, JobProgress } from '../../shared/funding.js';
import { FundingError } from './errors.js';
import { JobManager } from './jobs.js';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const request = (extra: object = {}) => ({ kind: 'rfp_analysis' as const, organizationId: ORG_A, subjectId: 'rfp-1', message: 'Reading the document…', ...extra });

function manager() {
  let time = 1_000;
  const events: JobProgress[] = [];
  const jobs = new JobManager((event: FundingEvent) => {
    if (event.kind === 'job') events.push(event.job);
  }, () => time);
  return { jobs, events, advance: (ms: number) => { time += ms; } };
}

describe('jobs', () => {
  it('runs to completion and reports start, progress and the end', async () => {
    const { jobs, events, advance } = manager();
    const { jobId, done } = jobs.start(request(), async ({ progress }) => {
      advance(200);
      progress('Checking each citation…', 62.4);
      advance(10);
      progress('Almost there…', 250);
    });
    const final = await done;
    expect(final).toMatchObject({ id: jobId, state: 'completed', percent: 100, error: null, message: 'Done.' });
    expect(final.finishedAt).toBeGreaterThan(final.startedAt);
    expect(events.map((job) => job.state)).toEqual(['running', 'running', 'completed']);
    expect(events[1]).toMatchObject({ message: 'Checking each citation…', percent: 62 });
    expect(jobs.list(ORG_A)).toEqual([expect.objectContaining({ id: jobId, state: 'completed' })]);
  });

  it('reports a failure with a message that is safe to show', async () => {
    const { jobs } = manager();
    const expected = await jobs.start(request(), async () => {
      throw new FundingError('NO_ASSISTANT', 'This step needs a connected assistant.');
    }).done;
    expect(expected).toMatchObject({ state: 'failed', error: { code: 'NO_ASSISTANT', message: 'This step needs a connected assistant.' } });

    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const unexpected = await jobs.start(request({ subjectId: 'rfp-2' }), async () => {
      throw new Error('ECONNRESET at /Users/someone/private/path');
    }).done;
    quiet.mockRestore();
    expect(unexpected).toMatchObject({ state: 'failed', error: { code: 'INTERNAL' } });
    expect(unexpected.message).not.toMatch(/ECONNRESET|Users/);
  });

  it('cancels a running job and ignores progress afterwards', async () => {
    const { jobs, events } = manager();
    let report!: (message: string) => void;
    const { jobId, done } = jobs.start(request(), ({ signal, progress }) => {
      report = progress;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled'))));
    });
    expect(jobs.cancel(jobId, ORG_B)).toBe(false); // another organization cannot cancel it
    expect(jobs.cancel(jobId, ORG_A)).toBe(true);
    expect(await done).toMatchObject({ state: 'cancelled', error: null });
    report('late');
    expect(events.at(-1)).toMatchObject({ state: 'cancelled', message: 'Cancelled.' });
    expect(jobs.cancel(jobId, ORG_A)).toBe(false);
  });

  it('treats work that returns after being cancelled as cancelled', async () => {
    const { jobs } = manager();
    let release!: () => void;
    const { jobId, done } = jobs.start(request(), () => new Promise<void>((resolve) => { release = resolve; }));
    jobs.cancel(jobId, ORG_A);
    release();
    expect((await done).state).toBe('cancelled');
  });

  it('refuses a second job of the same kind for the same subject, but not for another', async () => {
    const { jobs } = manager();
    let release!: () => void;
    const first = jobs.start(request(), () => new Promise<void>((resolve) => { release = resolve; }));
    expect(() => jobs.start(request(), async () => {})).toThrow('That is already in progress.');
    expect(() => jobs.start(request({ subjectId: 'rfp-2' }), async () => {})).not.toThrow();
    expect(() => jobs.start(request({ kind: 'alignment' }), async () => {})).not.toThrow();
    expect(() => jobs.start(request({ organizationId: ORG_B }), async () => {})).not.toThrow();
    release();
    await first.done;
    expect(() => jobs.start(request(), async () => {})).not.toThrow();
  });

  it('lists only the asking organization, and forgets old results', async () => {
    const { jobs, advance } = manager();
    await jobs.start(request(), async () => {}).done;
    await jobs.start(request({ organizationId: ORG_B }), async () => {}).done;
    expect(jobs.list(ORG_A)).toHaveLength(1);
    expect(jobs.list(ORG_B)).toHaveLength(1);
    advance(11 * 60 * 1000);
    expect(jobs.list(ORG_A)).toEqual([]);
  });

  it('cancels everything an organization has running', async () => {
    const { jobs } = manager();
    const hang = ({ signal }: { signal: AbortSignal }) => new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled'))));
    const a = jobs.start(request(), hang);
    const b = jobs.start(request({ kind: 'alignment' }), hang);
    const other = jobs.start(request({ organizationId: ORG_B }), async () => {});
    jobs.cancelAll(ORG_A);
    expect((await a.done).state).toBe('cancelled');
    expect((await b.done).state).toBe('cancelled');
    expect((await other.done).state).toBe('completed');
  });
});

describe('stopping work that is slow to let go', () => {
  it('shows the job as stopped at once and holds the same work back until it has ended', async () => {
    const events: FundingEvent[] = [];
    const jobs = new JobManager((event) => events.push(event));
    let release: () => void = () => {};
    const request = { kind: 'rfp_analysis' as const, organizationId: 'org-a', subjectId: 'rfp-1', message: 'Reading' };
    const { jobId, done } = jobs.start(request, () => new Promise<void>((resolve) => (release = resolve)));

    expect(jobs.cancel(jobId, 'org-a')).toBe(true);
    expect(jobs.list('org-a').find((job) => job.id === jobId)?.state).toBe('cancelled');
    expect(() => jobs.start(request, async () => {})).toThrowError(/still stopping/);

    release();
    expect((await done).state).toBe('cancelled');
    // The late ending is not reported a second time.
    expect(events.filter((event) => event.kind === 'job' && event.job.state !== 'running')).toHaveLength(1);
    expect(() => jobs.start(request, async () => {})).not.toThrow();
  });

  it('stops everything filed under one subject', () => {
    const jobs = new JobManager(() => {});
    const forever = () => new Promise<void>(() => {});
    const a = jobs.start({ kind: 'rfp_analysis', organizationId: 'org-a', subjectId: 'rfp-1', message: '' }, forever);
    const b = jobs.start({ kind: 'alignment', organizationId: 'org-a', subjectId: 'rfp-1', message: '' }, forever);
    const other = jobs.start({ kind: 'rfp_analysis', organizationId: 'org-a', subjectId: 'rfp-2', message: '' }, forever);
    const elsewhere = jobs.start({ kind: 'rfp_analysis', organizationId: 'org-b', subjectId: 'rfp-1', message: '' }, forever);
    jobs.cancelSubject('org-a', 'rfp-1');
    const state = (organizationId: string, id: string) => jobs.list(organizationId).find((job) => job.id === id)?.state;
    expect(state('org-a', a.jobId)).toBe('cancelled');
    expect(state('org-a', b.jobId)).toBe('cancelled');
    expect(state('org-a', other.jobId)).toBe('running');
    expect(state('org-b', elsewhere.jobId)).toBe('running');
  });
});
