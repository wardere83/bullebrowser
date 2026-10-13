import { useId, useState } from 'react';
import type { AgentStepEvent } from '../../shared/agent-events.js';
import { Icon } from '../workspace/ui/icons.js';
import { activityActions, type ActivityStatus } from './task-activity.js';

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
  const running = status === 'running';
  const failed = status === 'error';
  const open = chosenOpen ?? (running || failed);
  const active = [...actions].reverse().find((action) => action.state === 'running');
  const summary = failed ? 'Task stopped' : running ? active?.label ?? 'Working…' : 'Task activity';
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
        {actions.length > 0 && <span className="shrink-0 text-[11px] text-ink-secondary">{actions.length} {actions.length === 1 ? 'step' : 'steps'}</span>}
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} className="text-ink-secondary" />
      </button>
      {open && (
        <div id={listId} className="max-h-64 overflow-y-auto border-t border-line/40 px-3 py-3">
          {actions.length === 0 && !failed && <p className="text-ink-secondary">Waiting for the next task update.</p>}
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
                  {action.message && <p className="mt-1 break-words text-danger">{action.message}</p>}
                </div>
              </li>
            ))}
          </ol>
          {failed && currentStep && <p role="alert" className="mt-2 break-words text-danger">{currentStep}</p>}
        </div>
      )}
    </section>
  );
}
