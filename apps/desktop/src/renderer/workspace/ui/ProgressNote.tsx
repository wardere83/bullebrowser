import { Button } from './Button.js';
import { Spinner } from './icons.js';
import { cx, text } from './styles.js';

export interface ProgressNoteProps {
  /** What is happening now, in words. Pass a job's `message`. */
  message: string;
  /** 0 to 100, or null when progress cannot be measured. Pass a job's `percent`. */
  percent?: number | null;
  /** Shows the control that stops the work. Usually `() => stopJob(job.id)` from the workspace store. */
  onStop?(): void;
  /** The stop control's label. Keep it specific: "Stop job", "Stop analysis". */
  stopLabel?: string;
  /** True once stopping has been asked for and the job has not yet ended. */
  stopping?: boolean;
  className?: string;
}

/**
 * A running job, shown where its result will appear: what it is doing, how far
 * it has got when that is known, and a way to stop it. The message is read out
 * when it changes; the bar is not, so progress does not interrupt on every
 * step.
 *
 *   const job = useJob('rfp_analysis', rfp.id);
 *   {job?.state === 'running' && (
 *     <ProgressNote message={job.message} percent={job.percent} onStop={() => void stopJob(job.id)} />
 *   )}
 */
export function ProgressNote({
  message,
  percent = null,
  onStop,
  stopLabel = 'Stop job',
  stopping = false,
  className,
}: ProgressNoteProps) {
  const measured = typeof percent === 'number' && Number.isFinite(percent);
  const value = measured ? Math.max(0, Math.min(100, Math.round(percent))) : null;

  return (
    <div
      className={cx(
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-primary/30 bg-primary/[0.12] px-3.5 py-3',
        className,
      )}
    >
      <Spinner size={18} className="text-primary" />
      <div className="min-w-0 flex-1 basis-48">
        <p role="status" aria-live="polite" className="text-sm leading-5 text-ink-inverse">
          {message}
        </p>
        {value !== null && (
          <div className="mt-2 flex items-center gap-2">
            <div
              role="progressbar"
              aria-label="Progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={value}
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10"
            >
              <div className="h-full rounded-full bg-primary" style={{ width: `${value}%` }} />
            </div>
            <span className={cx(text.caption, 'tabular-nums')}>{value}%</span>
          </div>
        )}
      </div>
      {onStop && (
        <Button size="sm" variant="secondary" busy={stopping} busyLabel="Stopping" onClick={onStop}>
          {stopLabel}
        </Button>
      )}
    </div>
  );
}
