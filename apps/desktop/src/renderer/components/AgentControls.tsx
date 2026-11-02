import { useEffect, useState } from 'react';
import type { AgentStepEvent } from '../../shared/agent-events.js';
type Command = 'pause' | 'resume' | 'step' | 'replan' | 'follow' | 'unfollow';

export function AgentControls({ runId, steps }: { runId: string; steps: readonly AgentStepEvent[] }) {
  const [paused, setPaused] = useState(false);
  const [follow, setFollow] = useState(true);
  const [error, setError] = useState('');
  const scope = [...steps].reverse().find((step) => step.kind === 'scope');
  async function command(action: Command) {
    try {
      await window.bullebrowser.agent.control(runId, action);
      setError('');
      if (action === 'pause' || action === 'step') setPaused(true);
      if (action === 'resume' || action === 'replan') setPaused(false);
      if (action === 'follow' || action === 'unfollow') setFollow(action === 'follow');
    } catch { setError('Task control was unavailable. Use Stop to interrupt.'); }
  }
  const state = [...steps].reverse().find((step) => step.kind === 'control');
  useEffect(() => {
    if (state?.kind === 'control') { setPaused(state.paused); setFollow(state.follow); }
  }, [state]);
  return <div className="shrink-0 border-b border-line px-4 py-2 text-xs" aria-label="Agent controls">
    <p className="mb-2 text-ink-secondary">{scope?.kind === 'scope' ? scope.label : 'Awaiting session access'}{paused ? ' • Paused at next tool' : ''}</p>
    <div className="flex flex-wrap gap-3">
      <button type="button" title={paused ? "Ctrl/Command + Shift + O" : "Ctrl/Command + Shift + P"} onClick={() => void command(paused ? 'resume' : 'pause')}>{paused ? 'Resume' : 'Pause'}</button>
      <button type="button" title="Ctrl/Command + Shift + N" onClick={() => void command('step')}>Step</button>
      <button type="button" title="Ctrl/Command + Shift + R" onClick={() => void command('replan')}>Re-plan</button>
      <label><input type="checkbox" checked={follow} onChange={() => void command(follow ? 'unfollow' : 'follow')} /> Follow agent</label>
    </div>
    {error && <p role="alert">{error}</p>}
  </div>;
}
