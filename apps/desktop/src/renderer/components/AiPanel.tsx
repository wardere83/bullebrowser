import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { skills } from '@bullebrowser/agent-core';
import type { ClaudeModelId } from '@bullebrowser/agent-core';
import { useAgentStore } from '../state/agent-store.js';
import { useBrowserStore } from '../state/browser-store.js';
import type { AppSettings } from '../../shared/ipc.js';
import type { AgentStepEvent } from '../../shared/agent-events.js';

const MODELS: { id: ClaudeModelId; label: string }[] = [
  { id: 'claude-opus-4-7', label: 'Opus 4.7 (most capable)' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6 (balanced)' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 (fastest)' },
];

export function AiPanel() {
  const current = useAgentStore((s) => s.current);
  const setCurrent = useAgentStore((s) => s.setCurrent);
  const setConversations = useAgentStore((s) => s.setConversations);
  const startRun = useAgentStore((s) => s.startRun);
  const status = useAgentStore((s) => s.status);
  const steps = useAgentStore((s) => s.steps);
  const openSettings = useBrowserStore((s) => s.openSettings);
  const [draft, setDraft] = useState('');
  const [skillId, setSkillId] = useState<string>('');
  const [model, setModel] = useState<ClaudeModelId>('claude-opus-4-7');
  const [hasKey, setHasKey] = useState(true);

  useEffect(() => {
    void (async () => {
      setHasKey(await window.bullebrowser.secrets.hasApiKey());
      const settings: AppSettings = await window.bullebrowser.settings.get();
      setModel(settings.defaultModel);
      const list = await window.bullebrowser.conversations.list();
      setConversations(list);
      if (list.length === 0) {
        const first = await window.bullebrowser.conversations.new();
        setCurrent(first);
      } else if (list[0]) {
        const detail = await window.bullebrowser.conversations.get(list[0].id);
        setCurrent(detail);
      }
    })();
  }, [setConversations, setCurrent]);

  const send = async () => {
    if (!draft.trim() || !current) return;
    const message = draft.trim();
    setDraft('');
    setCurrent({
      ...current,
      messages: [
        ...current.messages,
        { role: 'user', content: message, timestamp: Date.now() },
      ],
    });
    const skill = skillId || undefined;
    const { runId } = await window.bullebrowser.agent.run({
      conversationId: current.id,
      userMessage: message,
      model,
      ...(skill ? { skillId: skill } : {}),
    });
    startRun(runId);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const newConversation = async () => {
    const c = await window.bullebrowser.conversations.new();
    setCurrent(c);
    setConversations(await window.bullebrowser.conversations.list());
  };

  return (
    <aside className="flex w-[380px] flex-col border-l border-line/30 bg-surface-light">
      <header className="flex items-center justify-between gap-2 border-b border-line/60 px-3 py-2">
        <div className="text-sm font-semibold text-ink-primary">AI agent</div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={newConversation}
            className="rounded px-2 py-1 text-xs text-ink-secondary hover:bg-surface-muted"
          >
            New chat
          </button>
        </div>
      </header>

      <div className="flex items-center gap-2 border-b border-line/60 bg-surface-muted px-3 py-2 text-xs">
        <select
          value={skillId}
          onChange={(e) => setSkillId(e.target.value)}
          className="flex-1 rounded border border-line bg-white px-2 py-1 text-ink-primary"
        >
          <option value="">Skills: free chat</option>
          {skills.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value as ClaudeModelId)}
          className="rounded border border-line bg-white px-2 py-1 text-ink-primary"
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {!hasKey && <ApiKeyPrompt onOpenSettings={openSettings} />}
        {hasKey && current && current.messages.length === 0 && <EmptyState />}
        {current?.messages.map((m, i) => (
          <Bubble key={i} role={m.role} content={m.content} />
        ))}
        {status === 'running' && (
          <div className="my-2 space-y-1 rounded border border-line bg-surface-muted p-2 text-[11px] text-ink-secondary">
            {steps.slice(-6).map((s, i) => (
              <div key={i}>{stepLabel(s)}</div>
            ))}
          </div>
        )}
      </div>

      <footer className="border-t border-line/60 p-2">
        {skillId && (
          <div className="mb-1 px-1 text-[11px] text-ink-secondary">
            {skills.find((s) => s.id === skillId)?.inputPlaceholder}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={!hasKey || status === 'running'}
            placeholder={
              hasKey
                ? 'Ask the agent anything. Enter to send, Shift+Enter for newline.'
                : 'Add an API key in Settings to start chatting.'
            }
            rows={3}
            className="flex-1 resize-none rounded border border-line bg-white p-2 text-sm text-ink-primary outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:bg-surface-muted"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!hasKey || !draft.trim() || status === 'running'}
            className="h-9 rounded bg-primary px-3 text-sm font-medium text-white hover:bg-primary-hover disabled:bg-line"
          >
            Send
          </button>
        </div>
      </footer>
    </aside>
  );
}

function ApiKeyPrompt({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div className="rounded border border-line bg-surface-muted p-4 text-sm text-ink-primary">
      <div className="mb-1 font-semibold">Add your Anthropic API key</div>
      <p className="mb-3 text-ink-secondary">
        BulleBrowser uses your own Anthropic API key (BYOK). Your prompts go
        directly to Anthropic — never to Bulle Consulting.
      </p>
      <button
        type="button"
        onClick={onOpenSettings}
        className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover"
      >
        Open Settings
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="space-y-3 text-sm text-ink-primary">
      <div className="font-semibold">Welcome to BulleBrowser.</div>
      <p className="text-ink-secondary">
        Ask the agent to research grants, compare RFPs side by side, or check a
        document for compliance. Pick a skill above for a guided workflow, or
        type any task and the agent will use the live tabs to complete it.
      </p>
      <div className="space-y-2 rounded border border-line bg-surface-muted p-3">
        {skills.map((s) => (
          <div key={s.id}>
            <div className="text-xs font-semibold">{s.label}</div>
            <div className="text-[11px] text-ink-secondary">{s.shortDescription}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Bubble({ role, content }: { role: 'user' | 'assistant'; content: string }) {
  if (role === 'user') {
    return (
      <div className="my-2 ml-6 rounded-lg bg-primary px-3 py-2 text-sm text-white">
        {content}
      </div>
    );
  }
  return (
    <div className="my-2 mr-6 rounded-lg border border-line bg-white p-3">
      <div className="md-prose">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </div>
  );
}

function stepLabel(step: AgentStepEvent): string {
  switch (step.kind) {
    case 'thinking':
      return '· Thinking…';
    case 'tool_call':
      return `→ ${step.detail}`;
    case 'tool_result':
      return `  ✓ ${step.toolName}`;
    case 'error':
      return `! ${step.message}`;
    case 'done':
      return '· Done';
    case 'text':
      return '';
  }
}
