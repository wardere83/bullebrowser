import { useEffect, useId, useRef, useState } from 'react';
import type { AgentStepEvent } from '../../shared/agent-events.js';
import { Icon } from '../workspace/ui/icons.js';
import { activityActions, pagesRead, type ActivityStatus } from './task-activity.js';
import { useBrowserStore } from '../state/browser-store.js';

export function TaskActivity({
  steps,
  status,
  currentStep,
}: {
  steps: readonly AgentStepEvent[];
  status: ActivityStatus;
  currentStep: string;
}) {
  const [chosenOpen, setChosenOpen] = useState<boolean | null>(null);
  const listId = useId();
  const actions = activityActions(steps, status);
  const readCount = pagesRead(steps);
  const logRef = useRef<HTMLDivElement>(null);
  const followLog = useRef(true);
  useEffect(() => {
    const log = logRef.current;
    if (log && followLog.current) log.scrollTop = log.scrollHeight;
  }, [steps.length]);
  const running = status === 'running';
  const failed = status === 'error';
  const open = chosenOpen ?? (running || failed);
  const active = [...actions].reverse().find((action) => action.state === 'running');
  const summary = failed ? 'Task stopped' : running ? active?.label ?? (readCount ? 'Reviewing sources…' : actions.length ? 'Working…' : 'Preparing your task…') : 'Task activity';
  return (
    <section
      aria-label="Task activity"
      className={`mb-5 overflow-hidden rounded-lg border text-[12px] ${
        failed ? 'border-danger/30 bg-danger/5' : 'border-line/50 bg-surface-muted/30'
      }`}
    >
      <button
        type="button"
        onClick={() => setChosenOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-expanded={open}
        aria-controls={listId}
      >
        <Icon
          name={failed ? 'alert' : running ? 'progress' : 'list'}
          size={14}
          className={running ? 'text-primary motion-safe:animate-spin' : failed ? 'text-danger' : 'text-ink-secondary'}
        />
        <span role="status" className={`min-w-0 flex-1 ${failed ? 'text-danger' : 'text-ink-primary'}`}>
          {summary}
        </span>
        {readCount > 0 && <span className="shrink-0 text-[11px] text-ink-secondary">{readCount} {readCount === 1 ? 'page read' : 'pages read'}</span>}
        {actions.length > 0 && <span className="shrink-0 text-[11px] text-ink-secondary">{actions.length} {actions.length === 1 ? 'step' : 'steps'}</span>}
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} className="text-ink-secondary" />
      </button>
      {open && (
        <div id={listId} ref={logRef} onScroll={(event) => {
          const log = event.currentTarget;
          followLog.current = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
        }} className="max-h-64 overflow-y-auto border-t border-line/40 px-3 py-3">
          {actions.length === 0 && !failed && <p className="text-ink-secondary">Preparing the task. Browser actions will appear here as they happen.</p>}
          <ol role="log" aria-label="Browser task steps" aria-live="polite" aria-relevant="additions text" className="space-y-3">
            {actions.map((action) => (
              <li key={action.id} className="flex items-start gap-2">
                <Icon
                  name={action.state === 'running' ? 'progress' : action.state === 'completed' ? 'check-circle' : action.state === 'error' ? 'alert' : 'circle'}
                  size={14}
                  className={`mt-0.5 shrink-0 ${action.state === 'running' ? 'text-primary motion-safe:animate-spin' : action.state === 'error' ? 'text-danger' : 'text-ink-secondary'}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="break-words text-ink-primary">{action.label}</p>
                  <p className="mt-0.5 text-[11px] text-ink-secondary">
                    {action.state === 'running' ? 'In progress' : action.state === 'completed' ? 'Done' : action.state === 'error' ? 'Could not complete' : 'Stopped'}
                  </p>
                  {action.message && <p role={action.state === 'error' ? 'alert' : undefined} className="mt-1 break-words text-danger">{action.message}</p>}
                </div>
              </li>
            ))}
          </ol>
          {failed && currentStep && !actions.some((action) => action.message?.trim() === currentStep.trim()) && <p role="alert" className="mt-2 break-words text-danger">{currentStep}</p>}
          {failed && /Web search is not configured/i.test(currentStep) && (
            <button type="button" onClick={() => useBrowserStore.getState().openSettings()}
              className="mt-3 rounded bg-primary px-3 py-2 text-sm text-white">Configure web search</button>
          )}
        </div>
      )}
    </section>
  );
}

/** Outside the message scroller so live browsing stays visible while reading chat. */
export function BrowserProgress({ steps, awaitingAccess = false }: { steps: readonly AgentStepEvent[]; awaitingAccess?: boolean }) {
  const actions = activityActions(steps, 'running');
  const active = [...actions].reverse().find((action) => action.state === 'running');
  const count = pagesRead(steps);
  const label = awaitingAccess ? 'Waiting for browsing access' : active?.label ?? (count ? 'Reviewing sources…' : 'Preparing your task…');
  return (
    <div role="status" aria-label="Browser progress" className="flex shrink-0 items-center gap-2 border-y border-line/40 bg-primary/10 px-4 py-2 text-xs text-ink-primary">
      <Icon name="progress" size={14} className="shrink-0 text-primary motion-safe:animate-spin" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count > 0 && <span className="shrink-0 text-ink-secondary">{count} {count === 1 ? 'page read' : 'pages read'}</span>}
    </div>
  );
}
