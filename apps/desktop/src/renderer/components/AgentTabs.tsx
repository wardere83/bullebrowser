import type { AgentStepEvent, ReplayFrame } from '../../shared/agent-events.js';

export function AgentTabs({ steps }: { steps: readonly AgentStepEvent[] }) {
  const tabs = new Map<string, ReplayFrame>();
  for (const step of steps) if (step.kind === 'replay') tabs.set(step.frame.tabId, step.frame);
  if (!tabs.size) return null;
  return <details className="mb-3" aria-label="Agent tabs">
    <summary className="cursor-pointer">Agent tabs ({tabs.size})</summary>
    <ul className="mt-2 space-y-2">{[...tabs.values()].map((tab) => <li key={tab.tabId}>
      <button type="button" className="text-left text-primary" title={tab.url} onClick={() => void window.bullebrowser.tabs.switch(tab.tabId).catch(() => {})}>{tab.title || tab.url}</button>
      <p className="text-ink-secondary">Last recorded action: {tab.tool} · {new Date(tab.at).toLocaleTimeString()}</p>
    </li>)}</ul>
  </details>;
}
