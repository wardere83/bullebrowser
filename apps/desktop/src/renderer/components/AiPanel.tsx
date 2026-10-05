import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { product } from '@bullebrowser/brand-tokens';
import { providerFor, type ModelId } from '@bullebrowser/agent-core';
import { useAgentStore } from '../state/agent-store.js';
import { useBrowserStore } from '../state/browser-store.js';
import { AGENT_PROMPT_EVENT } from '../lib/url.js';
import { expandSlashCommand, SLASH_COMMANDS } from '../lib/slash-commands.js';
import { useInputActivity } from '../hooks/useInputActivity.js';
import { VoiceOverlay } from './VoiceOverlay.js';
import { RealtimeVoice } from './RealtimeVoice.js';
import { refreshVoiceConversation, runVoiceBrowserTask, type VoiceBrowserTaskResult } from '../lib/voice-agent.js';
import { AttachMenu, type UiAttachment } from './AttachMenu.js';
import type {
  AppSettings,
  ConversationSummary,
  RunAttachment,
} from '../../shared/ipc.js';
import type { AgentStepEvent } from '../../shared/agent-events.js';

// A task waiting behind the running one, carrying whatever was attached when it
// was queued so its context isn't lost by the time it runs.
interface QueuedTask {
  text: string;
  attachments: UiAttachment[];
}

// UI attachment references → the wire shape the agent run accepts.
function toRunAttachments(list: UiAttachment[]): RunAttachment[] {
  return list.map((a) =>
    a.kind === 'file'
      ? { kind: 'file', fileId: a.fileId, name: a.name }
      : a.kind === 'project'
        ? { kind: 'project', projectId: a.projectId, name: a.name }
        : { kind: 'screenshot', url: a.url },
  );
}

export const FOCUS_AI_PANEL_EVENT = 'bullebrowser:focus-ai-panel';

function browserBridge(): any {
  return (window as unknown as { bullebrowser: any }).bullebrowser;
}

export function AiPanel() {
  const current = useAgentStore((s) => s.current);
  const showSettings = useBrowserStore((s) => s.showSettings);
  const setCurrent = useAgentStore((s) => s.setCurrent);
  // The history list renders from this; without the selector the identifier is
  // simply undefined and opening History throws.
  const conversations = useAgentStore((s) => s.conversations);
  const setConversations = useAgentStore((s) => s.setConversations);
  const startRun = useAgentStore((s) => s.startRun);
  const status = useAgentStore((s) => s.status);
  const steps = useAgentStore((s) => s.steps);
  const currentStep = useAgentStore((s) => s.currentStep);
  const runId = useAgentStore((s) => s.runId);
  const [draft, setDraft] = useState('');
  // Tasks the user submitted while a run was already going. They run one after
  // another as each finishes, so the user can queue up work instead of waiting.
  const [queued, setQueued] = useState<QueuedTask[]>([]);
  // Context attached to the NEXT message via the "+" menu (files, a project, a
  // screenshot). Cleared when that message is sent or queued.
  const [attachments, setAttachments] = useState<UiAttachment[]>([]);
  // Voice input overlay: null when off, otherwise the active mode.
  const [voiceMode, setVoiceMode] = useState<'once' | 'continuous' | null>(null);
  const [skillId, setSkillId] = useState<string>('');
  const [model, setModel] = useState<ModelId>('claude-opus-4-7');
  const [showHistory, setShowHistory] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const runInProgress = status === 'running';
  const promptActivity = useInputActivity();

  // Conversation scroll: keep the newest message in view as the agent streams,
  // unless the user has scrolled up to read — then a pointer button appears to
  // jump back down.
  const messagesRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  // Held while a queued task is being dispatched, so the drain effect starts
  // exactly one run at a time (see the drain effect below).
  const drainingRef = useRef(false);
  // A run's handle arrives asynchronously. Reserve this interval as well as
  // the running state so voice and typed prompts cannot start two tasks.
  const dispatchingRef = useRef(false);
  const [dispatchRevision, setDispatchRevision] = useState(0);
  const queuedRef = useRef(queued);
  queuedRef.current = queued;
  const voiceContextRef = useRef({ model, skillId, attachments });
  voiceContextRef.current = { model, skillId, attachments };
  const onMessagesScroll = () => {
    const el = messagesRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 32);
  };
  const jumpToLatest = () => {
    const el = messagesRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  useEffect(() => {
    void (async () => {
      const bridge = browserBridge();
      const settings: AppSettings = await bridge.settings.get();
      const configuredProvider = providerFor(settings.defaultModel);
      const [hasAnthropic, hasOpenAi] = await Promise.all([
        bridge.secrets.hasApiKey('anthropic'),
        bridge.secrets.hasApiKey('openai'),
      ]);
      const configuredKeyPresent = configuredProvider === 'openai' ? hasOpenAi : hasAnthropic;
      // Prefer an optional cloud engine that is configured. When neither has
      // a key, the main process selects the local assistant.
      let effectiveSettings = settings;
      if (!configuredKeyPresent) {
        if (configuredProvider !== 'openai' && hasOpenAi) {
          effectiveSettings = await bridge.settings.set({ defaultModel: 'gpt-4o' });
        } else if (configuredProvider === 'openai' && hasAnthropic) {
          effectiveSettings = await bridge.settings.set({ defaultModel: 'claude-opus-4-7' });
        }
      }
      setModel(effectiveSettings.defaultModel);
      // Opening the app lands on a NEW session rather than resuming the last
      // one — a browser you just opened shouldn't drop you back into whatever
      // you were mid-way through, and the previous chats are a click away under
      // History. The one exception: if the newest conversation is still empty,
      // reuse it, so relaunching repeatedly doesn't litter History with blank
      // rows nobody asked for.
      const list = await bridge.conversations.list();
      const newest = list[0];
      const newestDetail = newest ? await bridge.conversations.get(newest.id) : null;
      if (newestDetail && newestDetail.messages.length === 0) {
        setConversations(list);
        setCurrent(newestDetail);
      } else {
        const fresh = await bridge.conversations.create();
        setCurrent(fresh);
        setConversations(await bridge.conversations.list());
      }
    })();
  }, [setConversations, setCurrent]);

  const sendMessage = async (text: string, atts: UiAttachment[] = [], budget?: number) => {
    const raw = text.trim();
    if (!raw || !current) return;
    dispatchingRef.current = true;
    try {
      // Slash commands expand client-side into a fully formed agent prompt so
      // the model sees a plain task and the user sees what they typed.
      const expanded = expandSlashCommand(raw);
      if (expanded?.echo === 'help') {
        setCurrent({
          ...current,
          messages: [
            ...current.messages,
            { role: 'user', content: raw, timestamp: Date.now() },
            {
              role: 'assistant',
              content: slashHelpText(),
              timestamp: Date.now(),
            },
          ],
        });
        return;
      }
      const message = expanded?.prompt ?? raw;
      setCurrent({
        ...current,
        messages: [
          ...current.messages,
          { role: 'user', content: raw, timestamp: Date.now() },
        ],
      });
      const bridge = browserBridge();
      const skill = skillId || undefined;
      const runAttachments = atts.length > 0 ? toRunAttachments(atts) : undefined;
      const { runId } = await bridge.agent.run({
        conversationId: current.id,
        userMessage: message,
        model,
        ...(skill ? { skillId: skill } : {}),
        ...(runAttachments ? { attachments: runAttachments } : {}),
        ...(budget ? { budget } : {}),
      });
      startRun(runId);
    } finally {
      dispatchingRef.current = false;
      setDispatchRevision((revision) => revision + 1);
    }
  };

  // Queue a task if one is already running (or waiting), else dispatch it now.
  // EVERY entry point that can start work — the composer, a voice transcript,
  // an address-bar prompt — goes through here so two runs never overlap. The
  // running check reads live store state rather than a render snapshot, because
  // voice transcripts fire from a long-lived overlay closure that would
  // otherwise see a stale value and start a second, concurrent run.
  const submit = async (text: string, atts: UiAttachment[] = []) => {
    const t = text.trim();
    if (!t) return;
    const running = useAgentStore.getState().status === 'running';
    if (running || dispatchingRef.current || drainingRef.current || queuedRef.current.length > 0) {
      const next = [...queuedRef.current, { text: t, attachments: atts }];
      queuedRef.current = next;
      setQueued(next);
      return;
    }
    await sendMessage(t, atts);
  };

  const send = async () => {
    const t = draft.trim();
    if (!t) return;
    const atts = attachments;
    setDraft('');
    setAttachments([]);
    promptActivity.reset();
    await submit(t, atts);
  };

  // Drain the queue: whenever the agent goes idle and something is waiting,
  // start the next task. sendMessage flips status back to running, so this
  // won't double-fire until the next task finishes.
  useEffect(() => {
    // `status` only flips to 'running' once agent.run() resolves. Without a
    // synchronous guard this effect re-fires the moment setQueued changes the
    // list — status is still 'idle' — and dispatches the whole queue at once
    // instead of one task after another.
    if (status !== 'idle' || queued.length === 0 || !current || drainingRef.current || dispatchingRef.current) return;
    const [next, ...rest] = queuedRef.current;
    if (!next) return;
    drainingRef.current = true;
    queuedRef.current = rest;
    setQueued(rest);
    void sendMessage(next.text, next.attachments).finally(() => {
      drainingRef.current = false;
      setDispatchRevision((revision) => revision + 1);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, queued, current, dispatchRevision]);

  // Dictation submits the recorded prompt. Live voice delegates browser tasks
  // through its tool callback instead, so transcripts never run a task twice.
  const onVoiceTranscript = (text: string) => {
    const t = text.trim();
    if (!t) return;
    void submit(t, attachments);
    setAttachments([]);
    setDraft('');
  };

  const onVoiceBrowserTask = async (
    prompt: string,
    signal: AbortSignal,
  ): Promise<VoiceBrowserTaskResult> => {
    if (signal.aborted) return { status: 'cancelled', text: 'The browser task was stopped.' };
    if (
      useAgentStore.getState().status === 'running' || dispatchingRef.current ||
      drainingRef.current || queuedRef.current.length > 0
    ) {
      return {
        status: 'failed',
        text: 'A browser task is already running. Wait or stop it before starting another.',
      };
    }
    const conversation = useAgentStore.getState().current;
    const message = prompt.trim();
    if (!conversation || !message) {
      return { status: 'failed', text: 'The assistant is still connecting. Try again shortly.' };
    }
    const context = voiceContextRef.current;
    dispatchingRef.current = true;
    setCurrent({
      ...conversation,
      messages: [...conversation.messages, { role: 'user', content: message, timestamp: Date.now() }],
    });
    setDraft('');
    setAttachments([]);
    try {
      const result = await runVoiceBrowserTask(window.bullebrowser, {
        conversationId: conversation.id,
        userMessage: message,
        model: context.model,
        ...(context.skillId ? { skillId: context.skillId } : {}),
        ...(context.attachments.length > 0 ? { attachments: toRunAttachments(context.attachments) } : {}),
      }, signal, (id) => {
        startRun(id);
        dispatchingRef.current = false;
      });
      await refreshVoiceConversation(window.bullebrowser, conversation.id, {
        current: () => useAgentStore.getState().current,
        refresh: (saved) => useAgentStore.getState().refreshCurrent(saved),
      });
      return result;
    } finally {
      dispatchingRef.current = false;
      setDispatchRevision((revision) => revision + 1);
    }
  };

  // "Control Browser": give the agent a live tab to drive if there isn't one,
  // and focus the composer so the user can say what to do.
  const controlBrowser = async () => {
    const bridge = browserBridge();
    const tabs = await bridge.tabs.list();
    if (!tabs || tabs.length === 0) await bridge.tabs.create();
    textareaRef.current?.focus();
  };

  const startVoice = (nextMode: 'once' | 'continuous') => {
    setVoiceMode(nextMode);
  };

  // Open bullebrowser.com in a new tab — the brand-mark "home" affordance.
  const openHome = () => {
    void browserBridge().tabs.create(`https://${product.domain}`);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  // Listen for address-bar agent prompts. The user typed a task into the
  // top-bar address field with the BulleBrowser search engine selected;
  // TopBar dispatched the event and we send it as the next agent message.
  // If we aren't hydrated yet (no current conversation), queue the prompt
  // and flush it once `current` is ready.
  const queuedPrompt = useRef<string | null>(null);
  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      if (!text) return;
      if (current) void submit(text);
      else queuedPrompt.current = text;
    };
    window.addEventListener(AGENT_PROMPT_EVENT, handler);
    return () => window.removeEventListener(AGENT_PROMPT_EVENT, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  // Cmd+/ focuses the AI panel input — Comet-style "summon the agent".
  useEffect(() => {
    const handler = () => textareaRef.current?.focus();
    window.addEventListener(FOCUS_AI_PANEL_EVENT, handler);
    return () => window.removeEventListener(FOCUS_AI_PANEL_EVENT, handler);
  }, []);

  // Flush any queued address-bar prompt once we're ready.
  useEffect(() => {
    if (current && queuedPrompt.current) {
      const text = queuedPrompt.current;
      queuedPrompt.current = null;
      void submit(text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  useEffect(() => {
    if (!current || current.messages.length > 0 || status === 'running') return;
    textareaRef.current?.focus();
  }, [current, status]);

  // Re-sync the optional cloud engine when Settings closes. Without its key,
  // the same composer uses the local assistant automatically.
  const settingsWasOpen = useRef(false);
  useEffect(() => {
    if (settingsWasOpen.current && !showSettings) {
      void (async () => {
        const bridge = browserBridge();
        const next: AppSettings = await bridge.settings.get();
        setModel(next.defaultModel);
      })();
    }
    settingsWasOpen.current = showSettings;
  }, [showSettings]);

  // The task the "Allow Access" prompt is asking about — always the message
  // that kicked off the current run.
  const lastUserMessage =
    [...(current?.messages ?? [])].reverse().find((m) => m.role === 'user')
      ?.content ?? '';

  // Follow the conversation as it grows / streams, but only when already
  // pinned to the bottom, so scrolling up to re-read isn't yanked back down.
  useEffect(() => {
    const el = messagesRef.current;
    if (el && atBottom) el.scrollTop = el.scrollHeight;
  }, [current?.messages, steps, status, atBottom]);

  const createConversation = async () => {
    const bridge = browserBridge();
    const c = await bridge.conversations.create();
    setCurrent(c);
    setShowHistory(false);
    setConversations(await bridge.conversations.list());
  };

  const openConversation = async (id: string) => {
    const detail = await browserBridge().conversations.get(id);
    if (detail) setCurrent(detail);
    setShowHistory(false);
  };

  const deleteConversation = async (id: string) => {
    const bridge = browserBridge();
    await bridge.conversations.delete(id);
    const list = await bridge.conversations.list();
    setConversations(list);
    // If the open chat was the one deleted, fall back to the newest remaining
    // chat, or a fresh one if none are left, so the panel is never left empty.
    if (current?.id === id) {
      if (list[0]) await openConversation(list[0].id);
      else await createConversation();
    }
  };

  return (
    <aside aria-label="Assistant chat" className="chat-panel relative flex w-[440px] flex-col border-l">
      {voiceMode === 'once' && (
        <VoiceOverlay
          mode="once"
          onTranscript={onVoiceTranscript}
          onClose={() => setVoiceMode(null)}
        />
      )}
      <header className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="text-[13px] font-semibold tracking-tight text-ink-primary">
          BulleBrowser Agent
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={async () => {
              setConversations(await browserBridge().conversations.list());
              setShowHistory((v) => !v);
            }}
            className={`rounded-md px-2 py-1 text-xs transition-colors ${
              showHistory ? 'text-ink-primary' : 'text-ink-secondary hover:text-ink-primary'
            }`}
          >
            History
          </button>
          <button
            type="button"
            onClick={createConversation}
            className="rounded-md px-2 py-1 text-xs text-ink-secondary transition-colors hover:text-ink-primary"
          >
            New chat
          </button>
        </div>
      </header>

      {voiceMode === 'continuous' && (
        <RealtimeVoice
          onBrowserTask={onVoiceBrowserTask}
          onClose={() => setVoiceMode(null)}
        />
      )}

      {showHistory && (
        <HistoryList
          conversations={conversations}
          currentId={current?.id}
          onOpen={openConversation}
          onDelete={deleteConversation}
          onClose={() => setShowHistory(false)}
        />
      )}

      <div className="relative flex flex-1 flex-col overflow-hidden">
      <div
        ref={messagesRef}
        onScroll={onMessagesScroll}
        // The whole conversation is selectable, margins included: a drag that
        // starts beside a reply (how most people select) began on an
        // unselectable container and selected nothing.
        className="selectable flex-1 overflow-y-auto px-5 py-5"
      >
        {current && current.messages.length === 0 && (
          <EmptyState
            onAction={(text, skill) => {
              setDraft(text);
              setSkillId(skill ?? '');
              textareaRef.current?.focus();
            }}
            onSpeak={() => void startVoice('once')}
          />
        )}
        {current?.messages.map((m, i) => (
          <Bubble key={i} role={m.role} content={m.content} />
        ))}
        {(status === 'running' || status === 'error') && (
          <ActivityFeed steps={steps} status={status} currentStep={currentStep} />
        )}
        {status !== 'running' && <BudgetSpent steps={steps} onContinue={(b) => void sendMessage('Continue the task from where you stopped.', [], b)} />}
      </div>

        {/* Pointer arrow → jump to the latest message. Shown only when the
            user has scrolled up, so it never covers the newest reply. */}
        {!atBottom && (
          <button
            type="button"
            onClick={jumpToLatest}
            aria-label="Jump to latest message"
            className="absolute bottom-3 right-4 inline-flex h-9 w-9 items-center justify-center rounded-full border border-line bg-white text-ink-primary shadow-md transition-transform hover:scale-105"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M6 13l6 6 6-6" />
            </svg>
          </button>
        )}
      </div>

      {/* Outside the scroll area on purpose: a consent prompt the user has to
          go looking for is a consent prompt they will click through blind. It
          sits directly above the composer, always in view. */}
      <AllowAccess task={lastUserMessage} />

      <footer className="border-t border-line/25 p-3">
        {draft.startsWith('/') && !draft.includes(' ') && (
          <div className="mb-1 max-h-32 overflow-y-auto rounded border border-line bg-white text-[11px]">
            {SLASH_COMMANDS.filter((c) => c.name.startsWith(draft.toLowerCase())).map(
              (c) => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => {
                    setDraft(c.fillTemplate ?? `${c.name} `);
                    textareaRef.current?.focus();
                  }}
                  className="block w-full px-2 py-1 text-left hover:bg-surface-muted"
                >
                  <span className="font-mono text-ink-primary">{c.name}</span>
                  <span className="ml-2 text-ink-secondary">{c.description}</span>
                </button>
              ),
            )}
          </div>
        )}
        {queued.length > 0 && (
          <div className="mb-1.5 space-y-1">
            <div className="px-1 text-[10px] font-medium uppercase tracking-wide text-ink-secondary">
              Queued · runs next
            </div>
            {queued.map((q, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-md bg-surface-muted/60 px-2 py-1 text-[11px] text-ink-secondary"
              >
                <span className="flex-1 truncate">{q.text}</span>
                {q.attachments.length > 0 && (
                  <span className="shrink-0 text-[10px] text-ink-secondary">
                    +{q.attachments.length}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    const next = queuedRef.current.filter((_, j) => j !== i);
                    queuedRef.current = next;
                    setQueued(next);
                  }}
                  className="shrink-0 text-ink-secondary hover:text-danger"
                  title="Remove from queue"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        {attachments.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {attachments.map((a, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-muted/60 py-1 pl-1.5 pr-1 text-[11px] text-ink-primary"
              >
                {a.kind === 'screenshot' ? (
                  <img src={a.thumb} alt="" className="h-4 w-6 rounded object-cover" />
                ) : (
                  <span className="text-primary">{a.kind === 'project' ? '▣' : '📄'}</span>
                )}
                <span className="max-w-[150px] truncate">
                  {a.kind === 'project' ? `Project: ${a.name}` : a.kind === 'screenshot' ? 'Screenshot' : a.name}
                </span>
                <button
                  type="button"
                  onClick={() => setAttachments((list) => list.filter((_, j) => j !== i))}
                  className="ml-0.5 rounded px-1 text-ink-secondary hover:text-danger"
                  title="Remove attachment"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <div
              className={`prompt-input-shell prompt-input-shell--chat prompt-input-shell--${promptActivity.state}${
                runInProgress ? ' prompt-input-shell--working' : ''
              }`}
              data-activity-state={promptActivity.state}
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) {
                  e.preventDefault();
                  textareaRef.current?.focus();
                }
              }}
            >
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  promptActivity.onInputActivity();
                }}
                onPaste={() => promptActivity.onInputActivity()}
                onFocus={promptActivity.onFocus}
                onBlur={promptActivity.onBlur}
                onKeyDown={onKeyDown}
                placeholder={
                  runInProgress
                    ? 'Add another task — it will run after this one.'
                    : 'Ask BulleBrowser to do something. It will browse, read, compare, and report back.'
                }
                rows={3}
                className="prompt-input-field prompt-input-field--dark"
                autoFocus={current?.messages.length === 0}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            {/* Stop is always available while running, so a task can be halted.
                Send/queue stays usable too, so the user can line up more work
                instead of waiting. */}
            {status === 'running' && (
              <button
                type="button"
                onClick={() => {
                  if (runId) void window.bullebrowser.agent.cancel(runId);
                }}
                className="h-9 rounded border border-danger bg-white px-3 text-sm font-medium text-danger hover:bg-danger/10"
                title="Stop the running task"
              >
                Stop
              </button>
            )}
            <button
              type="button"
              onClick={() => void send()}
              disabled={!draft.trim()}
              className="h-9 rounded bg-primary px-3 text-sm font-medium text-white hover:bg-primary-hover disabled:bg-line"
              title={runInProgress ? 'Queue this task' : 'Send'}
            >
              {runInProgress ? 'Queue' : 'Send'}
            </button>
          </div>
        </div>

        {/* Control row: "+" attachment menu, brand-mark home, one-shot mic,
            and the live Voice Mode toggle. */}
        <div className="mt-2 flex items-center gap-1">
          <AttachMenu
            onAttach={(a) => setAttachments((list) => [...list, a])}
            onControlBrowser={() => void controlBrowser()}
          />

          <button
            type="button"
            onClick={openHome}
            aria-label="Open bullebrowser.com"
            title="bullebrowser.com"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-surface-muted"
          >
            <svg viewBox="0 0 64 64" className="h-5 w-5" aria-hidden>
              <rect x="4" y="4" width="56" height="56" rx="16" fill="#20BAD1" />
              <circle cx="26" cy="30" r="12" fill="none" stroke="#fff" strokeWidth="5" />
              <circle cx="42" cy="40" r="6" fill="#fff" />
            </svg>
          </button>

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => void startVoice('once')}
              aria-label="Voice input"
              title="Speak a prompt"
              className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                voiceMode === 'once' ? 'bg-primary/10 text-primary' : 'text-ink-secondary hover:bg-surface-muted hover:text-ink-primary'
              }`}
            >
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </svg>
            </button>

            <button
              type="button"
              onClick={() => {
                if (voiceMode === 'continuous') setVoiceMode(null);
                else void startVoice('continuous');
              }}
              aria-label="Voice Mode"
              aria-pressed={voiceMode === 'continuous'}
              title="Live voice conversation"
              className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                voiceMode === 'continuous' ? 'bg-primary/10 text-primary' : 'text-ink-secondary hover:bg-surface-muted hover:text-ink-primary'
              }`}
            >
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round">
                <path d="M4 11v2M8 8v8M12 5v14M16 8v8M20 11v2" />
              </svg>
            </button>
          </div>
        </div>
      </footer>
    </aside>
  );
}

// Past conversations, newest first, with open-on-click and per-row delete.
// Drops in below the header as a scrollable list rather than a modal, so it
// feels like part of the panel.
function HistoryList({
  conversations,
  currentId,
  onOpen,
  onDelete,
  onClose,
}: {
  conversations: ConversationSummary[];
  currentId?: string;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <div className="border-y border-line/25 bg-surface-muted/30">
      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-ink-secondary">
          Chat history
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-ink-secondary hover:text-ink-primary"
        >
          Close
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto px-2 pb-2">
        {sorted.length === 0 ? (
          <div className="px-2 py-3 text-[11px] text-ink-secondary">No chats yet.</div>
        ) : (
          sorted.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center gap-2 rounded-md px-2 py-1.5 ${
                c.id === currentId ? 'bg-primary/10' : 'hover:bg-surface-muted'
              }`}
            >
              <button
                type="button"
                onClick={() => onOpen(c.id)}
                className="flex-1 truncate text-left text-[12px] text-ink-primary"
                title={c.title}
              >
                {c.title || 'Untitled chat'}
                <span className="ml-2 text-[10px] text-ink-secondary">
                  {new Date(c.updatedAt).toLocaleDateString()}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm('Delete this chat? This cannot be undone.')) onDelete(c.id);
                }}
                className="shrink-0 text-ink-secondary opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                title="Delete chat"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// What the agent is doing, as one quiet line you can open. The raw tool calls
// are still there — they're just not the default view, because a wall of
// navigate({"url":…}) is noise to everyone except the person debugging it.
function ActivityFeed({
  steps,
  status,
  currentStep,
}: {
  steps: AgentStepEvent[];
  status: 'idle' | 'running' | 'error';
  currentStep: string;
}) {
  const [open, setOpen] = useState(false);
  const actions = steps.filter((s) => s.kind === 'tool_call');
  const failed = status === 'error';
  const summary = failed
    ? currentStep || 'The task stopped.'
    : (humanStep(steps[steps.length - 1]) ?? 'Working…');

  return (
    <div
      className={`mb-5 overflow-hidden rounded-lg border text-[12px] ${
        failed ? 'border-danger/30 bg-danger/5' : 'border-line/50 bg-surface-muted/30'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-expanded={open}
      >
        {!failed && status === 'running' && (
          <span className="activity-pulse h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
        )}
        <span className={`flex-1 truncate ${failed ? 'text-danger' : 'text-ink-primary'}`}>
          {summary}
        </span>
        {actions.length > 0 && (
          <span className="shrink-0 text-[11px] text-ink-secondary">
            {actions.length} {actions.length === 1 ? 'step' : 'steps'}
          </span>
        )}
        <span className={`shrink-0 text-ink-secondary transition-transform ${open ? 'rotate-90' : ''}`}>
          ›
        </span>
      </button>

      {open && (
        <div className="max-h-56 overflow-y-auto border-t border-line/40 px-3 py-2">
          {steps.length === 0 ? (
            <div className="text-ink-secondary">Nothing recorded yet.</div>
          ) : (
            <ol className="space-y-1.5">
              {steps.map((s, i) => {
                const line = humanStep(s);
                if (!line) return null;
                return (
                  <li key={i} className={s.kind === 'error' ? 'text-danger' : 'text-ink-secondary'}>
                    <div>{line}</div>
                    {s.kind === 'tool_call' && s.detail && (
                      <div className="mt-0.5 truncate font-mono text-[10.5px] text-ink-secondary/70">
                        {s.detail}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

// The once-per-task browsing consent, answered in the chat next to the task it
// belongs to rather than in a modal over the page.
function AllowAccess({ task }: { task: string }) {
  const pending = useAgentStore((s) => s.pendingConfirm);
  const setPending = useAgentStore((s) => s.setPendingConfirm);
  if (!pending || pending.kind !== 'browse_access') return null;

  const reply = (approved: boolean) => {
    void browserBridge().agent.replyConfirm(pending.runId, pending.id, approved);
    setPending(null);
  };

  return (
    <div className="mx-3 mb-2 rounded-xl border border-primary/30 bg-primary/[0.04] p-4 shadow-sm">
      <div className="text-[13px] font-medium text-ink-primary">
        Allow Access
      </div>
      <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
        BulleBrowser wants to browse the web in your tabs to do this:
        <span className="mt-1 block italic text-ink-primary">“{task}”</span>
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => reply(true)}
          className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover"
        >
          Allow Access
        </button>
        <button
          type="button"
          onClick={() => reply(false)}
          className="rounded border border-line px-3 py-1.5 text-xs text-ink-secondary hover:bg-surface-muted"
        >
          Not now
        </button>
      </div>
    </div>
  );
}

// Plain-language actions instead of a list of internal "skills". Each seeds the
// composer with a natural-language prompt (and quietly selects the matching
// skill under the hood, so the orchestration is unchanged); "Speak" opens the
// same voice flow as the mic. The user thinks in verbs, not tools.
function EmptyState({
  onAction,
  onSpeak,
}: {
  onAction: (text: string, skillId?: string) => void;
  onSpeak: () => void;
}) {
  const ACTIONS: { label: string; text: string; skillId?: string; icon: React.ReactNode }[] = [
    {
      label: 'Summarize this page',
      text: 'Summarize this page',
      skillId: 'page_assistant',
      icon: <path d="M4 6h16M4 12h16M4 18h10" />,
    },
    {
      label: 'Compare options',
      text: 'Compare the options across my open tabs and recommend one',
      skillId: 'workflow_automator',
      icon: <path d="M4 5h6v14H4zM14 5h6v14h-6z" />,
    },
    {
      label: 'Act on this',
      text: 'Act on this page: ',
      skillId: 'site_navigator',
      icon: <path d="M13 3 4 14h7l-1 7 9-11h-7z" />,
    },
  ];
  const chip =
    'flex items-center gap-2.5 rounded-lg border border-line px-3 py-2 text-left text-[13px] text-ink-primary transition-colors hover:border-primary/40 hover:bg-surface-muted';
  return (
    <div className="space-y-5 pt-1 text-sm">
      <p className="text-[15px] font-semibold tracking-tight text-ink-primary">
        What can I help you with?
      </p>
      <p className="leading-relaxed text-ink-secondary">
        Ask in plain language — or pick one. I can read, compare, and act across
        your tabs, and you can talk to me instead of typing.
      </p>
      <div className="grid gap-2">
        {ACTIONS.map((a) => (
          <button key={a.label} type="button" onClick={() => onAction(a.text, a.skillId)} className={chip}>
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-primary" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
              {a.icon}
            </svg>
            {a.label}
          </button>
        ))}
        <button type="button" onClick={onSpeak} className={chip}>
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-primary" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          </svg>
          Speak
        </button>
      </div>
    </div>
  );
}

function Bubble({ role, content }: { role: 'user' | 'assistant'; content: string }) {
  const prose = useRef<HTMLDivElement>(null);
  if (role === 'user') {
    return (
      <div className="mb-6 flex justify-end">
        <div className="chat-user-message selectable max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed">
          {content}
        </div>
      </div>
    );
  }
  // Assistant replies read as plain prose — no card, no border — for a calm,
  // document-like feel. Selectable, with a one-click copy of the whole reply.
  return (
    <div className="group mb-6">
      <div ref={prose} className="md-prose selectable">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, title, children }) => (
              <a href={href} title={title} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ),
          }}
        >{content}</ReactMarkdown>
      </div>
      <CopyButton source={prose} />
    </div>
  );
}

// Copies the reply as it reads, not as Markdown source: formatted (headings,
// bold, lists, tables) for Word, Docs and email, with clean plain text for
// anywhere else. Copying the raw Markdown pasted as **asterisks** and
// |table|pipes|, which reads as broken.
function CopyButton({ source }: { source: React.RefObject<HTMLDivElement | null> }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const el = source.current;
    if (!el) return;
    const html = el.innerHTML;
    const text = el.innerText.trim();
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]);
    } catch {
      // The async clipboard can be unavailable (window not focused); copy a
      // selection of the reply instead, which carries the formatting too.
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      document.execCommand('copy');
      sel?.removeAllRanges();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label="Copy reply"
      className="mt-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-ink-secondary opacity-70 transition-opacity hover:bg-surface-muted hover:opacity-100 group-hover:opacity-100"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <rect x="9" y="9" width="12" height="12" rx="2" />
        <path d="M5 15V5a2 2 0 0 1 2-2h10" />
      </svg>
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function slashHelpText(): string {
  const rows = SLASH_COMMANDS.filter((c) => c.name !== '/help')
    .map((c) => `| \`${c.name}\` | ${c.description} |`)
    .join('\n');
  return [
    '**Slash commands**',
    '',
    '| Command | What it does |',
    '|---|---|',
    rows,
    '',
    'You can always type a task in plain English instead.',
  ].join('\n');
}

// Plain-English name for each browser action. The tool name and its raw
// arguments are still shown underneath when the feed is expanded; this is the
// line a person reads.
const ACTION_VERB: Record<string, string> = {
  navigate: 'Opening',
  read_page: 'Reading the page',
  getPageMetadata: 'Checking the page',
  extract: 'Pulling data off the page',
  listLinks: 'Looking at the links',
  getSelection: 'Reading the selection',
  click: 'Clicking',
  type: 'Typing',
  press_key: 'Pressing a key',
  scroll: 'Scrolling',
  wait_for: 'Waiting for the page',
  screenshot: 'Taking a screenshot',
  new_tab: 'Opening a new tab',
  switch_tab: 'Switching tabs',
  close_tab: 'Closing a tab',
  list_tabs: 'Checking open tabs',
  go_back: 'Going back',
  go_forward: 'Going forward',
  reload: 'Reloading',
  find_elements: 'Finding the controls',
  select_option: 'Choosing an option',
};

// Pull the interesting argument out of the raw call so the summary can name
// what it acted on ("Opening example.com") instead of just the verb.
function describeTarget(step: AgentStepEvent): string {
  if (step.kind !== 'tool_call') return '';
  const input = step.input as Record<string, unknown> | undefined;
  const url = typeof input?.url === 'string' ? input.url : '';
  if (url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }
  const target = typeof input?.target === 'string' ? input.target : '';
  return target ? `“${target}”` : '';
}

function humanStep(step: AgentStepEvent | undefined): string | null {
  if (!step) return null;
  switch (step.kind) {
    case 'thinking':
      return 'Thinking…';
    case 'tool_call': {
      const verb = ACTION_VERB[step.toolName] ?? step.toolName;
      const target = describeTarget(step);
      return target ? `${verb} ${target}` : verb;
    }
    // Results and the final text are not their own line: the action already
    // said what was happening, and the answer renders as a message.
    case 'tool_result':
    case 'text':
      return null;
    case 'error':
      return step.message;
    case 'budget':
      return step.detail;
    case 'done':
      return 'Done';
  }
}

// A task that used its whole step budget stops with a partial answer. Offer to
// carry on with a bigger budget, rather than making the user rephrase it.
function BudgetSpent({ steps, onContinue }: { steps: AgentStepEvent[]; onContinue: (budget: number) => void }) {
  const spent = steps.find((s): s is Extract<AgentStepEvent, { kind: 'budget' }> => s.kind === 'budget' && s.exhausted);
  if (!spent) return null;
  const next = Math.min(200, spent.total + Math.max(20, Math.round(spent.total / 2)));
  return (
    <div className="mb-5 flex items-center justify-between gap-3 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-[12px] text-ink-primary">
      <span>This task used its whole step budget ({spent.total} steps).</span>
      <button
        type="button"
        onClick={() => onContinue(next)}
        className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-primary-hover"
      >
        Continue with {next} steps
      </button>
    </div>
  );
}
