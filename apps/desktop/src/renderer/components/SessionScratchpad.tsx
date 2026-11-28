import { useMemo, useState } from 'react';
import type { AgentStepEvent } from '../../shared/agent-events.js';
import type { ConversationDetail } from '../../shared/ipc.js';
import { buildBrief, collectPlaybooks, type BriefOpportunity } from '../../shared/strategy-brief.js';
import { useAgentStore } from '../state/agent-store.js';

const NO_STEPS: readonly AgentStepEvent[] = [];

function Points({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-1.5">
      <p className="font-medium text-ink-primary">{label}</p>
      <ul className="ml-4 list-disc text-ink-secondary">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}

function Opportunity({ item }: { item: BriefOpportunity }) {
  const facts = [item.funder, item.award, item.deadlines[0] ? `Deadline: ${item.deadlines[0]}` : ''].filter(Boolean).join(' · ');
  return (
    <li className="rounded border border-line bg-white p-2.5" data-testid="scratchpad-opportunity">
      <details open={item.rank === 1}>
        <summary className="flex cursor-pointer items-start gap-2">
          <span aria-hidden className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-white">{item.rank}</span>
          <span className="flex-1 font-medium text-ink-primary">{item.name}</span>
          {item.outlook && <span className="shrink-0 rounded-full bg-surface-dark px-2 text-[10px] text-white">{item.outlook}</span>}
        </summary>
        {facts && <p className="mt-1 text-ink-secondary">{facts}</p>}
        <p className="mt-1 text-ink-primary">{item.angle}</p>
        <Points label="What a successful proposal needs" items={item.requirements} />
        <Points label="How to stand out" items={item.winThemes} />
        <Points label="Steps to take" items={item.actions} />
        <Points label="Risks to manage" items={item.risks} />
        {item.nextMove && <p className="mt-1.5 text-ink-primary"><span className="font-medium">Next move: </span>{item.nextMove}</p>}
      </details>
    </li>
  );
}

function Notes({ conversation }: { conversation: ConversationDetail }) {
  const [text, setText] = useState(conversation.scratchpad ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  async function save(value: string) {
    setSaving(true);
    setMessage('');
    try {
      await window.bullebrowser.conversations.setScratchpad(conversation.id, value);
      const store = useAgentStore.getState();
      if (store.current?.id === conversation.id) store.setCurrent({ ...store.current, scratchpad: value });
      setText(value);
      setMessage(value ? 'Saved for later tasks in this conversation.' : 'Session notes forgotten.');
    } catch {
      setMessage('Could not save your notes. Try again.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-ink-secondary">Your notes for this conversation</summary>
      <textarea aria-label="Session notes" value={text} maxLength={12000} disabled={saving}
        onChange={(event) => { setText(event.target.value); setMessage('Unsaved changes'); }}
        className="mt-2 w-full rounded border border-line bg-white p-2 text-ink-primary" rows={3} />
      <div className="mt-1 flex items-center gap-3">
        <button type="button" disabled={saving} onClick={() => void save(text)} className="text-primary disabled:opacity-50">Save notes</button>
        <button type="button" disabled={saving} onClick={() => void save('')} className="text-danger disabled:opacity-50">Forget this</button>
        <span role="status" className="text-ink-secondary">{message}</span>
      </div>
    </details>
  );
}

/**
 * The strategy for every opportunity found in this conversation, in the order
 * to pursue them, with what a successful proposal needs. Downloads as a one or
 * two page PDF brief.
 */
export function SessionScratchpad({ conversation, liveSteps = NO_STEPS }: { conversation: ConversationDetail; liveSteps?: readonly AgentStepEvent[] }) {
  const [downloading, setDownloading] = useState(false);
  const [status, setStatus] = useState('');
  const saved = useMemo(() => collectPlaybooks(conversation.taskRuns ?? []), [conversation.taskRuns]);
  const brief = useMemo(() => {
    const playbooks = collectPlaybooks([
      ...(conversation.taskRuns ?? []),
      { startedAt: Number.MAX_SAFE_INTEGER, steps: liveSteps },
    ]);
    return playbooks.length ? buildBrief(playbooks, Date.now()) : null;
  }, [conversation.taskRuns, liveSteps]);
  const count = brief ? brief.opportunities.length + brief.alsoConsidered.length : 0;

  async function download() {
    setDownloading(true);
    setStatus('');
    try {
      const done = await window.bullebrowser.conversations.downloadBrief(conversation.id);
      setStatus(done ? 'Strategy brief saved as a PDF.' : '');
    } catch {
      setStatus('Could not save the PDF. Try again.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <details className="shrink-0 border-b border-line px-5 py-2 text-xs" data-testid="session-scratchpad">
      <summary className="cursor-pointer text-ink-secondary">
        Session Scratchpad{count > 0 ? ` · ${count} ${count === 1 ? 'opportunity' : 'opportunities'}` : ''}
      </summary>
      <div className="mt-2 max-h-[45vh] overflow-y-auto pr-1">
        {!brief ? (
          <p className="text-ink-secondary">
            When BulleBrowser finds funding, the strategy for each opportunity collects here: what a successful proposal needs,
            how to stand out and the steps to take, in the order to pursue them. You can download it as a short PDF brief.
          </p>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1 text-ink-primary">
                {brief.summary.map((line) => <p key={line}>{line}</p>)}
              </div>
              <button
                type="button"
                onClick={() => void download()}
                disabled={downloading || saved.length === 0}
                title={saved.length === 0 ? 'Available when the current task finishes' : undefined}
                className="shrink-0 rounded bg-accent px-2.5 py-1 font-medium text-ink-primary hover:bg-accent-hover disabled:opacity-50"
              >
                {downloading ? 'Saving…' : 'Download PDF'}
              </button>
            </div>
            {brief.priorities.length > 0 && (
              <div className="mt-2 rounded border-l-4 border-accent bg-surface-muted px-2.5 py-1.5">
                <p className="font-medium text-ink-primary">Start with</p>
                <ol className="ml-4 list-decimal text-ink-primary">
                  {brief.priorities.map((line) => <li key={line}>{line}</li>)}
                </ol>
              </div>
            )}
            <ol className="mt-2 space-y-2">
              {brief.opportunities.map((item) => <Opportunity key={item.name} item={item} />)}
            </ol>
            {brief.alsoConsidered.length > 0 && (
              <div className="mt-2">
                <p className="font-medium text-ink-primary">Also considered</p>
                <ul className="ml-4 list-disc text-ink-secondary">
                  {brief.alsoConsidered.map((item) => <li key={item.name}><span className="text-ink-primary">{item.name}</span>{item.outlook ? ` (${item.outlook})` : ''}: {item.angle}</li>)}
                </ul>
              </div>
            )}
            <p role="status" className="mt-1 text-ink-secondary">{status}</p>
          </>
        )}
        <Notes conversation={conversation} />
      </div>
    </details>
  );
}
