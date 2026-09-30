// Coordinates one user-initiated agent task: builds the system prompt
// (skill-aware), wires the ToolContext to the active tab, runs the loop,
// and forwards every step over IPC to the renderer.

import { randomUUID } from 'node:crypto';
import { type BrowserWindow } from 'electron';
import {
  DEFAULT_MODEL,
  findSkill,
  providerFor,
  runAgent,
  type AgentStep,
  type ToolContext,
} from '@bullebrowser/agent-core';
import {
  IPC,
  type AgentConfirmRequest,
  type AgentRunRequest,
} from '../../shared/ipc.js';
import type { AgentStepEvent } from '../../shared/agent-events.js';
import { conversationStore } from '../storage/conversations.js';
import { sessionFileStore } from '../storage/session-files.js';
import { projectStore } from '../storage/projects.js';
import { tabManager } from '../tabs/manager.js';
import { getApiKey } from '../storage/secrets.js';
import { getSettings } from '../storage/settings.js';
import { DesktopToolRuntime } from './runtime.js';
import { describeAgentError } from './errors.js';
import { buildAttachmentAppendix, type AttachmentSources } from './attachments.js';

// The real, store-backed resolvers. buildAttachmentAppendix takes these by
// injection so it can be unit-tested without booting Electron.
const attachmentSources: AttachmentSources = {
  file: (id) => {
    const meta = sessionFileStore.get(id);
    return meta ? { name: meta.name, mime: meta.mime, sizeBytes: meta.sizeBytes } : null;
  },
  excerpt: (id) => sessionFileStore.excerpt(id),
  project: (id) => {
    const p = projectStore.get(id);
    return p ? { name: p.name, instructions: p.instructions, fileIds: p.fileIds } : null;
  },
};

interface ActiveRun {
  controller: AbortController;
  pendingConfirms: Map<string, (approved: boolean) => void>;
}

const runs = new Map<string, ActiveRun>();

const BASE_SYSTEM = [
  "You are the BulleBrowser agent — an autonomous web agent with direct control",
  "of the user's real desktop browser. You complete tasks by actually driving the",
  'browser (navigating, reading, clicking, typing), the way a person would, not by',
  'answering from memory.',
  '',
  'Tools: navigate, read_page (any tab via tabId), find_elements (the page\'s',
  'controls, each with a ref like @12), extract (structured data), listLinks,',
  'getSelection, getPageMetadata, click, type, select_option, press_key (Enter,',
  'Tab, Escape, Backspace, Space, arrows, Home/End, PageUp/PageDown), scroll,',
  'screenshot, wait_for, and tab management (new_tab, switch_tab, close_tab,',
  'go_back, go_forward, reload, list_tabs).',
  '',
  'Method — work in a perceive → plan → act → observe loop:',
  '1. Perceive: check where you are. The current tab and the opening text of its',
  '   page are provided below — answer questions about "this page" from that',
  '   directly, and read_page only when you need more of it. Do not assume page',
  '   contents — read them.',
  '2. Plan the smallest sequence of real browser actions that satisfies the task.',
  '3. Act one step at a time, then observe the tool result before the next step.',
  '4. Adapt: if a page differs from what you expected, re-read and re-plan.',
  '',
  'Browsing effectively:',
  '- To find information you do not already have, search: navigate to',
  '  https://duckduckgo.com/?q=<query> (or google/bing), read_page the results,',
  '  then open the most relevant results and read those pages before answering.',
  '- After navigate or a click that loads new content, use wait_for',
  '  (selector or networkIdle) before read_page when the page renders',
  '  client-side, so you read the finished page rather than a loading state.',
  '- Prefer read_page/extract over screenshot; use screenshot only when the task',
  '  is genuinely visual (layout, charts, images).',
  '- Before clicking, typing or choosing in a form, call find_elements and act by',
  '  ref (target "@12"): refs are exact, while guessing labels or selectors fails',
  '  on real sites. Refs go stale when the page changes — call find_elements again.',
  '- To fill a field: type (it replaces the value). For a <select> dropdown use',
  '  select_option. Press_key Enter submits search boxes. Use extract for',
  '  tables/lists/structured data.',
  '- Document editors (Word Online, Google Docs) live inside embedded frames:',
  '  read_page includes their text, and find_elements lists the editor first',
  '  with a frame ref like "@2.7". To write in a document: if it opened in a',
  '  viewing / read-only mode, switch it to editing first (e.g. Word: the',
  '  "Editing" mode button); click in the document where the text belongs (or',
  '  its editor ref to land at the end), then type with target "focused". Text',
  '  goes in at the cursor; nothing already in the document is replaced.',
  '- A failed action tells you what IS on the page — read the error and retry',
  '  with a better target instead of repeating the same one.',
  '- To compare or summarize several sources, open them in tabs and read_page each',
  '  by tabId (no need to switch focus).',
  '',
  'Safety — these require the user to confirm first; do not do them unprompted:',
  'submitting forms that send the user\'s data, completing purchases or payments,',
  'deleting or sending anything, uploading files, or downloading files. If a step',
  'needs one of these, the browser will prompt the user; respect their decision.',
  '',
  'Answering:',
  '- Ground every factual claim in a page you actually read during this task. Do',
  '  not answer from prior knowledge when the answer depends on current, live, or',
  '  page-specific facts.',
  '- When you have enough to answer, stop browsing and give a clear, well-',
  '  structured reply in Markdown, citing the source URLs you used. Do not keep',
  '  browsing past what the task needs.',
  '- If you reach the 25 tool-call limit, summarize what you found so far and ask',
  '  the user how to proceed.',
].join('\n');

export async function startAgentRun(
  win: BrowserWindow,
  req: AgentRunRequest,
): Promise<{ runId: string }> {
  // Resolve the model first: each assistant authenticates with its own
  // provider's key, so fetching the wrong provider's key would fail with a
  // confusing 401.
  const model = req.model ?? getSettings().defaultModel ?? DEFAULT_MODEL;
  const apiKey = getApiKey(providerFor(model));
  const conversation = conversationStore.get(req.conversationId);
  if (!conversation) throw new Error('Conversation not found');

  // Store the user's message CLEAN (what they typed), but hand the model an
  // enriched version that folds in any attached file/project/screenshot
  // context. This keeps the visible chat uncluttered while the agent still sees
  // everything, and needs no change to agent-core: the enrichment is just text
  // appended to the one message we send this run.
  const userMsg = {
    role: 'user' as const,
    content: req.userMessage,
    timestamp: Date.now(),
  };
  conversationStore.appendMessage(req.conversationId, userMsg);
  // Resolving attachments touches the filesystem (a file can vanish or be
  // unreadable between attaching and sending). A throw here would land after
  // the user's message was already persisted but before the run exists — the
  // message would sit in the chat with nothing happening and no error. Degrade
  // to running the task without the attached context instead.
  let composedMessage = req.userMessage;
  try {
    composedMessage += buildAttachmentAppendix(req.attachments, attachmentSources);
  } catch (err) {
    console.error('[agent] could not resolve attachments; running without them', err);
  }

  const runId = randomUUID();
  const controller = new AbortController();
  const pendingConfirms = new Map<string, (approved: boolean) => void>();
  runs.set(runId, { controller, pendingConfirms });

  let activeTabId = tabManager.getActiveId();
  if (!activeTabId) {
    const created = await tabManager.create();
    activeTabId = created.id;
  }

  const ask = (message: string, kind: AgentConfirmRequest['kind']) =>
    new Promise<boolean>((resolve) => {
      const id = randomUUID();
      pendingConfirms.set(id, resolve);
      win.webContents.send(IPC.AGENT_CONFIRM_REQUEST, {
        runId,
        id,
        message,
        kind,
      } satisfies AgentConfirmRequest);
    });

  const runtime = new DesktopToolRuntime({
    request: (message: string) => ask(message, 'destructive'),
  });

  const skill = req.skillId ? findSkill(req.skillId) : undefined;
  // The compliance skill now exists, so this reaches the user's checklist from
  // Settings and appends it to the skill's own prompt.
  const userChecklist =
    skill?.id === 'compliance_review' ? getSettings().complianceChecklist : [];
  const checklistAppendix =
    userChecklist.length > 0
      ? '\n\nUser-provided checklist items (run these in addition to the defaults above, using the same Status legend):\n' +
        userChecklist.map((i) => `- ${i}`).join('\n')
      : '';
  const systemPrompt = skill
    ? `${BASE_SYSTEM}\n\n${skill.systemPrompt}${checklistAppendix}`
    : BASE_SYSTEM;

  const startTabId = activeTabId;
  const ctx: ToolContext = {
    // A live getter, not a snapshot. new_tab and switch_tab change which tab is
    // really active, so a value captured at run start goes stale the moment the
    // agent opens a tab: it would go on reading the new tab (those tools take an
    // explicit tabId) while navigate/click/type/screenshot kept driving the
    // original one — clicking a page the model isn't looking at, and
    // screenshotting a view that relayout() has since sized to 0x0.
    get activeTabId() {
      return tabManager.getActiveId() ?? startTabId;
    },
    signal: controller.signal,
    runtime,
  };

  // Fire and forget — we don't await; results stream over IPC.
  void (async () => {
    let assistantText = '';
    let lastText = '';
    try {
      assistantText = await runAgent({
        apiKey: apiKey ?? undefined,
        model,
        systemPrompt,
        history: conversation.messages
          .filter((m) => m !== userMsg)
          .map((m) => ({ role: m.role, content: m.content })),
        userMessage: composedMessage,
        context: ctx,
        requestBrowseAccess: () => ask(req.userMessage, 'browse_access'),
        onStep: (step) => {
          // Keep the model's own prose as it streams. If the run later dies
          // (context limit, network drop), the finally block can still persist
          // what it had actually worked out instead of throwing the whole
          // research away and leaving the conversation with only the question.
          if (step.type === 'text' && step.detail) lastText = step.detail;
          win.webContents.send(IPC.AGENT_STEP, {
            runId,
            step: stepToEvent(step),
          });
        },
      });
    } catch (err) {
      // A user Stop aborts the in-flight model call, which the SDK surfaces as
      // an abort error. That's not a failure — don't alarm the user with a red
      // error, just keep whatever the agent had already written and end.
      if (isCancellation(err)) {
        if (lastText) assistantText = `${lastText}\n\n_(Stopped.)_`;
        win.webContents.send(IPC.AGENT_STEP, {
          runId,
          step: { kind: 'done', ts: Date.now() } satisfies AgentStepEvent,
        });
      } else {
        if (lastText) {
          assistantText = `${lastText}\n\n_(This task stopped early: ${describeAgentError(err)})_`;
        }
        win.webContents.send(IPC.AGENT_STEP, {
          runId,
          step: { kind: 'error', message: describeAgentError(err), ts: Date.now() } satisfies AgentStepEvent,
        });
      }
    } finally {
      if (assistantText) {
        conversationStore.appendMessage(req.conversationId, {
          role: 'assistant',
          content: assistantText,
          timestamp: Date.now(),
        });
      }
      runs.delete(runId);
    }
  })();

  return { runId };
}

// True when a run ended because the user pressed Stop, rather than a real
// failure. The SDK throws an abort error on signal; our own guards throw
// Error('cancelled').
function isCancellation(err: unknown): boolean {
  const name = (err as { name?: string })?.name ?? '';
  const message = err instanceof Error ? err.message : '';
  return (
    name === 'AbortError' ||
    name === 'APIUserAbortError' ||
    /cancel|abort/i.test(message)
  );
}

export function cancelAgentRun(runId: string) {
  const run = runs.get(runId);
  if (!run) return;
  run.controller.abort();
  // Deny anything still waiting on the user. Without this, a run cancelled
  // while an "Allow Access" prompt is open leaves that promise unresolved and
  // the agent loop parked on it forever.
  for (const resolve of run.pendingConfirms.values()) resolve(false);
  run.pendingConfirms.clear();
  runs.delete(runId);
}

export function replyAgentConfirm(runId: string, id: string, approved: boolean) {
  const run = runs.get(runId);
  const resolver = run?.pendingConfirms.get(id);
  if (resolver) {
    resolver(approved);
    run?.pendingConfirms.delete(id);
  }
}

// Turn a thrown agent error into a clear, actionable message for the chat UI,
// so failures (bad key, rate limit, no network) are surfaced instead of silent.
function stepToEvent(step: AgentStep): AgentStepEvent {
  const ts = Date.now();
  switch (step.type) {
    case 'thinking':
      return { kind: 'thinking', detail: step.detail, ts };
    case 'tool_call':
      return {
        kind: 'tool_call',
        toolName: step.toolName ?? 'unknown',
        detail: step.detail ?? '',
        input: step.data,
        ts,
      };
    case 'tool_result':
      return {
        kind: 'tool_result',
        toolName: step.toolName ?? 'unknown',
        output: step.data,
        ts,
      };
    case 'text':
      return { kind: 'text', text: step.detail ?? '', ts };
    case 'error':
      return { kind: 'error', toolName: step.toolName, message: step.detail ?? '', ts };
    case 'done':
      return { kind: 'done', ts };
  }
}
