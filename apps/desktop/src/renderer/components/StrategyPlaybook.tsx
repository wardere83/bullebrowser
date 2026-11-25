import type { StrategyPlaybook as Playbook } from '@bullebrowser/agent-core';
import { sanitizeAssistantText } from '@bullebrowser/agent-core/presentation';
import { useId, useState } from 'react';
import { Icon } from '../workspace/ui/icons.js';

const OUTLOOK_TONE: Record<NonNullable<Playbook['outlook']>, string> = {
  strong: 'bg-emerald-100 text-emerald-800',
  promising: 'bg-primary/10 text-primary',
  'long shot': 'bg-amber-100 text-amber-800',
  'not a fit': 'bg-surface-muted text-ink-secondary',
};

const clean = (text: string) => sanitizeAssistantText(text);

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/**
 * The live strategy playbook: what the assistant believes it will take to win
 * the opportunity being browsed, rewritten as the task learns more. It is
 * written for the user and stays visible while the task runs.
 */
export function StrategyPlaybook({ playbook, live = false }: { playbook: Playbook; live?: boolean }) {
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  const sources = (playbook.sources ?? []).filter((url) => /^https?:\/\//i.test(url));
  return (
    <section aria-label="Strategy playbook" className="border-t border-primary/20 bg-primary/[0.04] px-3 py-2.5 text-ink-primary">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={bodyId}
        className="flex w-full items-start gap-2 text-left">
        <Icon name="compass" size={14} className="mt-0.5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] uppercase tracking-wide text-ink-secondary">
            Strategy playbook{live ? ' · updating as I browse' : ''}
          </span>
          <span className="block font-medium">{clean(playbook.headline)}</span>
        </span>
        {playbook.outlook && <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${OUTLOOK_TONE[playbook.outlook]}`}>{playbook.outlook}</span>}
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} className="mt-0.5 text-ink-secondary" />
      </button>
      {open && (
        <div id={bodyId} aria-live="polite" className="mt-2 space-y-2.5 pl-[22px]">
          {playbook.fit && <p className="text-ink-secondary">{clean(playbook.fit)}</p>}
          {playbook.winThemes.length > 0 && (
            <div>
              <h4 className="mb-1 text-[11px] font-medium text-ink-secondary">How to win</h4>
              <ul className="space-y-1">{playbook.winThemes.map((theme) => (
                <li key={theme} className="flex gap-1.5"><Icon name="check" size={12} className="mt-0.5 shrink-0 text-primary" /><span>{clean(theme)}</span></li>
              ))}</ul>
            </div>
          )}
          {playbook.actions.length > 0 && (
            <div>
              <h4 className="mb-1 text-[11px] font-medium text-ink-secondary">Action plan</h4>
              <ol className="space-y-1">{playbook.actions.map((action, index) => (
                <li key={`${index}-${action.step}`} className="flex gap-1.5">
                  <span className="w-4 shrink-0 text-right text-ink-secondary">{index + 1}.</span>
                  <span className="min-w-0">
                    {clean(action.step)}
                    {(action.owner || action.when) && (
                      <span className="block text-[11px] text-ink-secondary">{[action.owner, action.when].filter(Boolean).map((part) => clean(String(part))).join(' · ')}</span>
                    )}
                  </span>
                </li>
              ))}</ol>
            </div>
          )}
          {(playbook.deadlines?.length ?? 0) > 0 && (
            <div>
              <h4 className="mb-1 text-[11px] font-medium text-ink-secondary">Key dates</h4>
              <ul className="space-y-1">{playbook.deadlines!.map((date) => (
                <li key={date} className="flex gap-1.5"><Icon name="calendar" size={12} className="mt-0.5 shrink-0 text-ink-secondary" /><span>{clean(date)}</span></li>
              ))}</ul>
            </div>
          )}
          {(playbook.risks?.length ?? 0) > 0 && (
            <div>
              <h4 className="mb-1 text-[11px] font-medium text-ink-secondary">Watch outs</h4>
              <ul className="space-y-1">{playbook.risks!.map((risk) => (
                <li key={risk} className="flex gap-1.5"><Icon name="alert" size={12} className="mt-0.5 shrink-0 text-amber-600" /><span>{clean(risk)}</span></li>
              ))}</ul>
            </div>
          )}
          {playbook.nextMove && (
            <p className="rounded bg-surface px-2 py-1.5"><span className="font-medium">Next move: </span>{clean(playbook.nextMove)}</p>
          )}
          {sources.length > 0 && (
            <p className="text-[11px] text-ink-secondary">Based on {sources.map((url, index) => (
              <span key={url}>{index > 0 ? ', ' : ''}<button type="button" className="text-primary" onClick={() => { void window.bullebrowser.tabs.create(url).catch(() => {}); }}>{hostOf(url) || 'source'}</button></span>
            ))}</p>
          )}
        </div>
      )}
    </section>
  );
}
