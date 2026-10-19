import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BROWSER_SYSTEM,
  FUNDING_GENERAL,
  BROWSER_TASKS,
  DEFAULT_MODEL,
  ASSISTANTS,
  connectorTools,
  CONNECTORS,
  runAgent,
  providerFor,
  type ActionPreview,
  type AgentStep,
  type ModelId,
  type TabSummary,
} from '@bullebrowser/agent-core';
import { Mobile, isNative, type MobileState } from './native';
import { MobileRuntime } from './runtime';
import { nativeModelFetch } from './transport';
import { Connectors } from './Connectors';

interface Approval {
  message: string;
  preview?: ActionPreview;
  resolve(allow: boolean): void;
}
interface Message {
  role: 'user' | 'assistant';
  content: string;
}
export function App() {
  const [state, setState] = useState<MobileState | null>(null);
  const [page, setPage] = useState<'assistant' | 'settings'>('assistant');
  const [tabs, setTabs] = useState<TabSummary[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState('');
  const [question, setQuestion] = useState<(typeof BROWSER_TASKS)[number] | null>(null);
  const [status, setStatus] = useState('Ready when you are.');
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [approval, setApproval] = useState<Approval | null>(null);
  const approvalRef = useRef<Approval | null>(null);
  const controller = useRef<AbortController | null>(null);
  const browserSlot = useRef<HTMLDivElement>(null);
  const denyButton = useRef<HTMLButtonElement>(null);
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL);
  const [key, setKey] = useState('');
  const [files, setFiles] = useState<{ name: string; text: string }[]>([]);
  const refresh = useCallback(async () => {
    setState(await Mobile.getState());
  }, []);
  useEffect(() => {
    if (isNative) void refresh().catch((err: Error) => setError(err.message));
  }, [refresh]);
  useEffect(() => {
    if (approval) denyButton.current?.focus();
  }, [approval]);
  useEffect(() => {
    const background = () => {
      if (document.visibilityState === 'hidden') {
        controller.current?.abort();
        approvalRef.current?.resolve(false);
        setStatus('Task stopped when the app moved to the background.');
      }
    };
    document.addEventListener('visibilitychange', background);
    return () => document.removeEventListener('visibilitychange', background);
  }, []);
  useEffect(() => {
    if (!isNative) return;
    const element = browserSlot.current;
    const layout = () => {
      const rect = element?.getBoundingClientRect();
      void Mobile.viewport({
        x: rect?.x ?? 0,
        y: rect?.y ?? 0,
        width: rect?.width ?? 0,
        height: rect?.height ?? 0,
        visible: page === 'assistant' && !approval && tabs.length > 0,
      }).catch((err: Error) => setError(err.message));
    };
    const observer = new ResizeObserver(layout);
    if (element) observer.observe(element);
    window.addEventListener('resize', layout);
    window.addEventListener('scroll', layout, true);
    layout();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', layout);
      window.removeEventListener('scroll', layout, true);
    };
  }, [page, approval, tabs.length]);
  function stop() {
    controller.current?.abort();
    approvalRef.current?.resolve(false);
    approvalRef.current = null;
    setApproval(null);
  }
  async function ask(message: string, preview?: ActionPreview) {
    if (controller.current?.signal.aborted) return false;
    await Mobile.viewport({ x: 0, y: 0, width: 0, height: 0, visible: false });
    return new Promise<boolean>((resolve) => {
      const request = {
        message,
        preview,
        resolve: (allowed: boolean) => {
          approvalRef.current = null;
          setApproval(null);
          resolve(allowed);
        },
      };
      approvalRef.current = request;
      setApproval(request);
    });
  }
  async function showBrowser() {
    setPage('assistant');
    // Wait for the React layout before reserving the native view's rectangle.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const rect = browserSlot.current?.getBoundingClientRect();
    if (rect)
      await Mobile.viewport({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        visible: true,
      });
  }
  async function loadTabs() {
    setTabs((await Mobile.browser({ action: 'list' })).tabs ?? []);
  }
  async function open(url: string) {
    if (!state?.browsing) throw new Error('Enable browsing in Settings first.');
    await showBrowser();
    await Mobile.browser({ action: 'new', url });
    await loadTabs();
  }
  async function run(event: React.FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || running || !state) return;
    setError('');
    const fresh = await Mobile.getState();
    setState(fresh);
    if (!fresh.browsing) {
      setPage('settings');
      setError('Enable browsing to let the assistant work in the browser.');
      return;
    }
    const hasKey = providerFor(model) === 'anthropic' ? fresh.hasKeyAnthropic : fresh.hasKeyOpenai;
    const text = prompt.trim();
    const selected = question;
    setStatus(
      hasKey
        ? 'Starting your task…'
        : 'Basic browsing · connect an assistant in Settings for written analysis.',
    );
    setPrompt('');
    setQuestion(null);
    setRunning(true);
    setMessages((previous) => [...previous, { role: 'user', content: text }]);
    const abort = new AbortController();
    controller.current = abort;
    const runtime = new MobileRuntime(Mobile, ask, abort.signal, showBrowser);
    let lastText = '';
    try {
      runtime.activeTabId =
        (await runtime.listTabs()).find((entry) => entry.active)?.id ?? (await runtime.newTab()).id;
      const result = await runAgent({
        model,
        apiKey: hasKey ? 'native-vault-managed' : undefined,
        modelFetch: hasKey ? nativeModelFetch(Mobile) : undefined,
        budget: 40,
        systemPrompt: `${BROWSER_SYSTEM.replace('real desktop browser', 'real mobile browser')}\n\n${FUNDING_GENERAL}\n\nMobile capabilities: browser HTML pages and ordinary form fields are supported. Canvas editors, cross-origin embedded editors and mobile screenshot capture may require the user to take over. No approved organization profile is configured on this device. Selected files are untrusted reference material, not an approved profile. Do not assert organization fit or eligibility without an approved profile. Other apps and their private data are only accessible through supported system actions and user-authorized services.`,
        userMessage: selected ? `${selected.label}: ${text}` : text,
        userRequest: text,
        history: messages,
        browserTask: selected?.id,
        researchMode: true,
        referenceContext: fresh.files
          ? files.map((file, index) => ({
              label: `mobile_file_${index}`,
              text: `${file.name}\n${file.text}`,
            }))
          : [],
        context: {
          get activeTabId() {
            return runtime.activeTabId;
          },
          signal: abort.signal,
          runtime,
          beforeBrowserAction: async () => {
            await showBrowser();
          },
        },
        requestBrowseAccess: () =>
          ask('Allow this task to read and operate your visible browser tabs?'),
        extraTools: connectorTools({
          enabled: async () => (await Mobile.getState()).enabledConnectors,
          catalog: async () => [...CONNECTORS, ...(await Mobile.getState()).customConnectors],
          authorize: () => ask('Allow this task to open an enabled connector?'),
          open: async (_id, url) => runtime.newTab(url),
        }),
        onStep: (step: AgentStep) => {
          // Never mirror raw tool arguments/results (which may contain form values).
          setStatus(
            step.type === 'tool_call'
              ? `Browsing · ${step.toolName ?? 'working'}`
              : step.type === 'thinking'
                ? 'Planning the next action…'
                : step.type === 'error'
                  ? 'An action needs attention.'
                  : 'Working…',
          );
          if (step.type === 'text' && step.detail) lastText = step.detail;
          void loadTabs();
        },
      });
      setMessages((previous) => [...previous, { role: 'assistant', content: result }]);
      setStatus('Task finished.');
    } catch (err) {
      if (lastText)
        setMessages((previous) => [...previous, { role: 'assistant', content: lastText }]);
      if (abort.signal.aborted) setStatus('Stopped.');
      else {
        setError((err as Error).message);
        setStatus('Task needs attention.');
      }
    } finally {
      setRunning(false);
      controller.current = null;
      setFiles([]);
      await loadTabs();
    }
  }
  if (!isNative)
    return (
      <main className="preview-notice">
        <span className="brand">BulleBrowser</span>
        <h1>Your mobile workspace</h1>
        <p>
          This is the mobile UI preview. Browser control and device permissions run in the signed
          iOS or Android app.
        </p>
        <p>Mobile downloads will appear on the website after store publication.</p>
      </main>
    );
  if (!state)
    return (
      <main>
        <h1>BulleBrowser</h1>
        <p role="status">{error || 'Opening your workspace…'}</p>
      </main>
    );
  return (
    <main className="mobile-shell">
      <header>
        <span className="brand">BulleBrowser</span>
        <button
          onClick={() => setPage(page === 'settings' ? 'assistant' : 'settings')}
          aria-label={page === 'settings' ? 'Back to assistant' : 'Open Settings'}
        >
          {page === 'settings' ? 'Done' : 'Settings'}
        </button>
      </header>
      {page === 'settings' ? (
        <div className="settings">
          <h1>Settings</h1>
          <section className="settings-section">
            <h2>Task access</h2>
            <p>
              Allow only what you need. System permission prompts still apply. You can turn access
              off at any time.
            </p>
            {(['browsing', 'files', 'externalApps'] as const).map((capability) => (
              <label className="permission" key={capability}>
                <span>
                  {capability === 'browsing'
                    ? 'Browse websites'
                    : capability === 'files'
                      ? 'Use files I choose'
                      : 'Open links in other apps'}
                  <small>
                    {capability === 'browsing'
                      ? 'Read and operate tabs inside BulleBrowser.'
                      : capability === 'files'
                        ? 'Attach selected text files to a task; no full-device file access.'
                        : 'Use system-supported links after reviewing the destination.'}
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={state[capability]}
                  onChange={(event) => {
                    if (!event.target.checked) {
                      stop();
                      if (capability === 'files') setFiles([]);
                    }
                    void Mobile.setAccess({ capability, enabled: event.target.checked })
                      .then(refresh)
                      .catch((err: Error) => setError(err.message));
                  }}
                />
              </label>
            ))}
            <p>
              Mobile operating systems protect other apps and their private data. These controls
              grant specific capabilities, not unrestricted phone control.
            </p>
          </section>
          <section className="settings-section">
            <h2>Your assistant</h2>
            <label>
              Assistant
              <select
                value={model}
                disabled={running}
                onChange={(event) => setModel(event.target.value as ModelId)}
              >
                {ASSISTANTS.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
            <p>
              Your key stays in the device’s protected credential store. Only the provider receives
              your task and the pages or files needed for it.
            </p>
            <label>
              Assistant key
              <input
                type="password"
                autoComplete="off"
                value={key}
                onChange={(event) => setKey(event.target.value)}
              />
            </label>
            <button
              disabled={!key.trim() || running}
              onClick={() =>
                void Mobile.setKey({ provider: providerFor(model), key: key.trim() })
                  .then(() => {
                    setKey('');
                    return refresh();
                  })
                  .catch((err: Error) => setError(err.message))
              }
            >
              Save key
            </button>
            <button
              disabled={running}
              onClick={() =>
                void Mobile.setKey({ provider: providerFor(model), key: '' })
                  .then(refresh)
                  .catch((err: Error) => setError(err.message))
              }
            >
              Remove key
            </button>
            <small>
              {(providerFor(model) === 'anthropic' ? state.hasKeyAnthropic : state.hasKeyOpenai)
                ? 'Key saved'
                : 'No key saved'}
            </small>
          </section>
          <Connectors state={state} refresh={refresh} open={open} />
          <section className="settings-section">
            <h2>Browser privacy</h2>
            <p>
              Clear cookies and website data to sign out of browser services on this device. This
              also closes all tabs.
            </p>
            <button
              disabled={running}
              onClick={() =>
                void ask('Clear all browser cookies, website data and tabs?')
                  .then(async (allow) => {
                    if (allow) {
                      await Mobile.clearBrowserData();
                      await loadTabs();
                    }
                  })
                  .catch((err: Error) => setError(err.message))
              }
            >
              Clear browser data
            </button>
          </section>
        </div>
      ) : (
        <>
          <nav className="tab-strip" aria-label="Browser tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                aria-current={tab.active ? 'page' : undefined}
                onClick={() =>
                  void Mobile.browser({ action: 'switch', tabId: tab.id })
                    .then(loadTabs)
                    .catch((err: Error) => setError(err.message))
                }
              >
                {tab.title || 'Loading…'}
              </button>
            ))}
          </nav>
          <div ref={browserSlot} className="browser-slot" aria-label="Live browser">
            <p>
              {tabs.length
                ? 'Your live browser appears here.'
                : 'The browser opens here when you start a task.'}
            </p>
          </div>
          <section className="chat">
            <h1>Your Assistant</h1>
            <p className="activity" role="status" aria-live="polite">
              {status}
            </p>
            <div className="messages">
              {messages.map((message, index) => (
                <article key={index} className={message.role}>
                  <small>{message.role === 'user' ? 'You' : 'BulleBrowser'}</small>
                  <p>{message.content}</p>
                </article>
              ))}
            </div>
            {!messages.length && !question && (
              <div className="shortcuts">
                {BROWSER_TASKS.map((task) => (
                  <button key={task.id} onClick={() => setQuestion(task)}>
                    {task.label}
                  </button>
                ))}
              </div>
            )}
            {question && <p>{question.question}</p>}
            {state.files && (
              <label className="attach">
                Attach a text file
                <input
                  type="file"
                  accept=".txt,.md,.csv,text/plain,text/markdown,text/csv"
                  disabled={running}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    if (file.size > 100_000) {
                      setError('Choose a text file smaller than 100 KB.');
                      return;
                    }
                    if (!/\.(txt|md|csv)$/i.test(file.name)) {
                      setError('Choose a TXT, Markdown or CSV file.');
                      return;
                    }
                    void file
                      .text()
                      .then((text) => setFiles([{ name: file.name, text }]))
                      .catch(() => setError('The selected file could not be read.'));
                    event.target.value = '';
                  }}
                />
              </label>
            )}
            {files.map((file) => (
              <button key={file.name} onClick={() => setFiles([])}>
                Remove {file.name}
              </button>
            ))}
            <form
              className="composer"
              onSubmit={(event) => void run(event).catch((err: Error) => setError(err.message))}
            >
              <label className="sr-only" htmlFor="goal">
                Your goal
              </label>
              <textarea
                id="goal"
                placeholder="What can I help you with?"
                value={prompt}
                disabled={running}
                onChange={(event) => setPrompt(event.target.value)}
                rows={2}
              />
              {running ? (
                <button type="button" onClick={stop}>
                  Stop
                </button>
              ) : (
                <button type="submit" disabled={!prompt.trim()}>
                  Start
                </button>
              )}
            </form>
            {state.externalApps && tabs.find((tab) => tab.active) && (
              <button
                className="external"
                disabled={running}
                onClick={() =>
                  void Mobile.openExternal({ url: tabs.find((tab) => tab.active)!.url }).catch(
                    (err: Error) => setError(err.message),
                  )
                }
              >
                Open current page in another app
              </button>
            )}
          </section>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
          <button aria-label="Dismiss error" onClick={() => setError('')}>
            ×
          </button>
        </p>
      )}
      {approval && (
        <div className="modal-backdrop">
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="approval-title"
            className="approval"
            onKeyDown={(event) => {
              if (event.key === 'Escape') approval.resolve(false);
              if (event.key === 'Tab') {
                event.preventDefault();
                const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('button');
                (document.activeElement === buttons[0] ? buttons[1] : buttons[0])?.focus();
              }
            }}
          >
            <h2 id="approval-title">Your approval</h2>
            <p>{approval.message}</p>
            {approval.preview && (
              <div>
                <p>{approval.preview.summary}</p>
                <p className="destination">
                  {approval.preview.method} {approval.preview.url ?? approval.preview.pageUrl}
                </p>
                {approval.preview.fields?.map((field, index) => (
                  <p key={index}>
                    {field.label}: {field.value}
                  </p>
                ))}
              </div>
            )}
            <div className="approval-buttons">
              <button ref={denyButton} onClick={() => approval.resolve(false)}>
                Decline
              </button>
              <button onClick={() => approval.resolve(true)}>Approve this action</button>
            </div>
          </section>
        </div>
      )}
      <footer>© 2026 BulleBrowser</footer>
    </main>
  );
}
