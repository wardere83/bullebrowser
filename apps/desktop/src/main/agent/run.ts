import { TaskControl, type TaskCommand } from './task-control.js';
import { browserSearch, connectorTools, webSearchTool, isFundingDiscoveryRequest, isGrantSearchService, ToolError } from '@bullebrowser/agent-core';
import { connectorCatalog, enabledConnectors } from '../connectors/service.js';
// Coordinates one user-initiated agent task: builds the system prompt
// (skill-aware), wires the ToolContext to the active tab, runs the loop,
// and forwards every step over IPC to the renderer.

import { randomUUID } from 'node:crypto';
import { type BrowserWindow } from 'electron';
import {
  DEFAULT_MODEL,
  BROWSER_SYSTEM as BASE_SYSTEM,
  FUNDING_GENERAL,
  FUNDING_WORKFLOW_IDS,
  findSkill,
  providerFor,
  productQuestionReply,
  runAgent,
  type AgentStep,
  type ActionPreview,
  type ToolContext,
} from '@bullebrowser/agent-core';
import {
  IPC,
  type AgentConfirmRequest,
  type AgentResultEvent,
  type AgentRunRequest,
  type TaskRunLog,
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
import { groundChat, type ChatGrounding } from '../funding/grounding.js';
import { fundingPlatform } from '../funding/platform.js';
import { identityService } from '../identity/service.js';

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
  control: TaskControl;
  notifyControl?: () => void;
}

const runs = new Map<string, ActiveRun>();


const NO_GROUNDING = (now: number): ChatGrounding => ({
  organizationId: null,
  referenceContext: [],
  tools: [],
  systemNote: `Today's date on the user's device is ${new Date(now).toISOString().slice(0, 10)}.`,
});

export async function startAgentRun(
  win: BrowserWindow,
  req: AgentRunRequest,
): Promise<{ runId: string }> {
  // Resolve the model first: each assistant authenticates with its own
  // provider's key, so fetching the wrong provider's key would fail with a
  // confusing 401.
  const model = req.model ?? getSettings().defaultModel ?? DEFAULT_MODEL;
  const apiKey = getApiKey(providerFor(model));

  const controller = new AbortController();
  const runId = randomUUID();
  const pendingConfirms = new Map<string, (approved: boolean) => void>();
  const control = new TaskControl();
  runs.set(runId, { controller, pendingConfirms, control });

  const taskLog: TaskRunLog = { id: runId, startedAt: Date.now(), finishedAt: 0, status: 'completed', steps: [], calls: [], consents: [] };
  const ask = (message: string, kind: AgentConfirmRequest['kind']) =>
    new Promise<boolean>((resolve) => {
      const id = randomUUID();
      pendingConfirms.set(id, (approved) => {
        taskLog.consents.push({ kind, approved, at: Date.now() });
        resolve(approved);
      });
      win.webContents.send(IPC.AGENT_CONFIRM_REQUEST, {
        runId,
        id,
        message,
        kind,
      } satisfies AgentConfirmRequest);
    });

  runs.get(runId)!.notifyControl = () => publishEvent({ kind: 'control', paused: control.paused, follow: control.follow, ts: Date.now() });
  const publishEvent = (event: AgentStepEvent) => {
    taskLog.steps.push(event);
    win.webContents.send(IPC.AGENT_STEP, { runId, step: event });
  };

  // What the run may know about the active organization. A failure here must
  // not stop the chat: the run then simply has no organization material.
  const grounding = await groundChat(fundingPlatform(), identityService, {
    ...(req.focusRfpId ? { focusRfpId: req.focusRfpId } : {}),
    signal: controller.signal,
    now: Date.now(),
  }).catch((err: unknown) => {
    console.error('[agent] could not ground the run in the organization', err);
    return NO_GROUNDING(Date.now());
  });

  // A chat belongs to the organization it was first used under, and is not
  // continued under another one.
  const conversation = conversationStore.get(req.conversationId, grounding.organizationId);
  if (!conversation) { cancelAgentRun(runId); throw new Error('Conversation not found'); }
  if (grounding.organizationId) conversationStore.bind(req.conversationId, grounding.organizationId);
  // Snapshot before appending. Storage adapters may return shared objects;
  // history must contain prior turns exactly once, not the new message too.
  const history = conversation.messages.map((message) => ({ role: message.role, content: message.content }));
  const productOnly = !!productQuestionReply(req.userMessage, history);
  const sessionConsent = productOnly ? Promise.resolve(true) : ask(req.userMessage, 'browse_access');

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
  if (conversation.scratchpad?.trim()) {
    composedMessage += '\n\nUser-authored session notes (context, not verified web evidence):\n' + conversation.scratchpad;
  }
  try {
    composedMessage += buildAttachmentAppendix(req.attachments, attachmentSources);
  } catch (err) {
    console.error('[agent] could not resolve attachments; running without them', err);
  }

  let activeTabId = tabManager.getActiveId();
  if (!activeTabId) {
    const created = await tabManager.create();
    activeTabId = created.id;
  }

  const runtime = new DesktopToolRuntime({
    request: (message: string, preview?: ActionPreview) => ask([
      message,
      preview?.summary,
      preview?.url ? `Destination: ${preview.url}` : undefined,
      ...(preview?.changes ?? []).map((change) => `${change.label}: ${change.before || '(empty)'} → ${change.after || '(empty)'}`),
      ...(preview?.fields ?? []).map((field) => `${field.label}: ${field.value}`),
      ...(preview?.files ?? []).map((file) => `File: ${file.name}`),
      preview?.note,
    ].filter(Boolean).join('\n'), 'destructive'),
  }, (tabId) => {
    // Consent is handled by the tool executor before the runtime touches the
    // page. Late operations after Stop must not restore the browsing effect.
    if (!controller.signal.aborted) {
      // Each source being inspected is shown in the left browsing pane.
      activeTabId = tabId;
      if (control.follow && tabManager.getActiveId() !== tabId) tabManager.activate(tabId);
      tabManager.setBrowsingActivity(runId, tabId);
    }
  }, 'default', controller.signal, () => control.follow, (source) => publishEvent({ kind: 'source', ...source, ts: Date.now() }));

  const skill = req.skillId ? findSkill(req.skillId) : undefined;
  const isFundingWorkflow = !!skill && (FUNDING_WORKFLOW_IDS as readonly string[]).includes(skill.id);
  const systemPrompt = [
    BASE_SYSTEM,
    skill ? skill.systemPrompt : '',
    // A funding workflow carries the funding rules itself.
    isFundingWorkflow ? '' : FUNDING_GENERAL,
    grounding.systemNote,
  ]
    .filter(Boolean)
    .join('\n\n');

  const startTabId = activeTabId;
  const isContinuation = (text: string) => /^(?:please\s+)?(?:continue|retry|try again|resume)[.!?\s]*$/i.test(text);
  const priorRequest = [...history].reverse().find((turn) => turn.role === 'user' && !isContinuation(turn.content))?.content ?? '';
  const discoveryRequest = isContinuation(req.userMessage) ? priorRequest : req.userMessage;
  const fundingOnly = ['find_grants', 'research_funder', 'compare_grants'].includes(req.browserTask ?? '') || isFundingDiscoveryRequest(discoveryRequest);
  const ctx: ToolContext = {
    beforeTool: () => control.beforeTool(controller.signal),
    afterBrowserAction: async (name, args, callId) => {
      if (!['navigate', 'read_page', 'find_elements', 'click', 'type', 'select_option', 'scroll', 'press_key', 'new_tab', 'switch_tab'].includes(name)) return;
      try {
        const tabId = typeof args.tabId === 'string' ? args.tabId : ctx.activeTabId;
        const frame = await runtime.captureReplay(tabId, name, callId);
        publishEvent({ kind: 'replay', frame, ts: frame.at });
      } catch {
        publishEvent({ kind: 'warning', message: 'A page-state capture was unavailable for this step. Its tool audit is still recorded.', ts: Date.now() });
      }
    },
    beforeBrowserAction: (name, args) => {
      if (fundingOnly && ['navigate', 'new_tab'].includes(name) && typeof args.url === 'string' && isGrantSearchService(args.url)) {
        throw new ToolError('BLOCKED_BY_POLICY', 'Grant-search services are excluded from funding discovery. Find the funder’s own program page or official government listing instead.');
      }
      return runtime.presentAction(typeof args.tabId === 'string' ? args.tabId : ctx.activeTabId, name, controller.signal);
    },
    // A live getter, not a snapshot. new_tab and switch_tab change which tab is
    // really active, so a value captured at run start goes stale the moment the
    // agent opens a tab: it would go on reading the new tab (those tools take an
    // explicit tabId) while navigate/click/type/screenshot kept driving the
    // original one — clicking a page the model isn't looking at, and
    // screenshotting a view that relayout() has since sized to 0x0.
    get activeTabId() {
      return activeTabId ?? startTabId;
    },
    signal: controller.signal,
    runtime,
  };

  // Fire and forget — we don't await; results stream over IPC.
  void (async () => {
    let assistantText = '';
    let lastText = '';
    let status: AgentResultEvent['status'] = 'completed';
    let error: string | undefined;
    try {
      const approved = await sessionConsent;
      if (!productOnly) publishEvent({ kind: 'scope', granted: approved, label: approved ? 'Session • Agent tabs' : 'Browser access denied', ts: Date.now() });
      if (controller.signal.aborted) throw new Error('cancelled');
      if (!approved) throw new ToolError('PERMISSION_DENIED', 'Browser access was declined. Use Retry to review session permissions.');
      runtime.authorizeSession();
      assistantText = await runAgent({
        planning: !!apiKey,
        shouldReplan: () => control.takeReplan(),
        apiKey: apiKey ?? undefined,
        researchMode: true,
        browserTask: req.browserTask,
        model,
        systemPrompt,
        history,
        userMessage: composedMessage,
        userRequest: req.userMessage,
        // Sealed by the loop as reference material; never part of the instructions.
        ...(grounding.referenceContext.length > 0 ? { referenceContext: grounding.referenceContext } : {}),
        extraTools: [webSearchTool({ apiKey: getApiKey('brave') ?? undefined, signal: controller.signal, fundingOnly,
          browserSearch: browserSearch({ runtime, activeTabId: () => ctx.activeTabId, signal: controller.signal, fundingOnly,
            presentAction: (tabId, action, signal) => runtime.presentAction(tabId, action, signal),
          }),
        }), ...grounding.tools, ...connectorTools({
          enabled: async () => enabledConnectors(),
          catalog: async () => connectorCatalog(),
          authorize: () => ask('Allow this task to open an enabled connector in your browser?', 'browse_access'),
          open: async (_id, url) => tabManager.create(url),
        })],
        context: ctx,
        // Choosing a browser task and submitting its answer explicitly starts browsing.
        requestBrowseAccess: () => sessionConsent,
        budget: req.budget ?? getSettings().stepBudget,
        onToolRecord: (record) => { taskLog.calls!.push(record); },
        onCompletion: (outcome) => {
          if (outcome.status === 'incomplete') { status = 'failed'; error = outcome.reason; }
        },
        onStep: (step) => {
          // Keep the model's own prose as it streams. If the run later dies
          // (context limit, network drop), the finally block can still persist
          // what it had actually worked out instead of throwing the whole
          // research away and leaving the conversation with only the question.
          if (step.type === 'text' && step.detail) lastText = step.detail;
          // Publish completion after the final answer has been saved, so both
          // the chat refresh and a waiting voice tool receive the same result.
          if (step.type === 'done') return;
          const event = stepToEvent(step);
          publishEvent(event);
        },
      });
    } catch (err) {
      // A user Stop aborts the in-flight model call, which the SDK surfaces as
      // an abort error. That's not a failure — don't alarm the user with a red
      // error, just keep whatever the agent had already written and end.
      if (isCancellation(err)) {
        status = 'cancelled';
        assistantText = lastText ? `${lastText}\n\n_(Stopped.)_` : 'Task stopped at your request. No completed result was reported.';
      } else {
        status = 'failed';
        error = describeAgentError(err);
        if (lastText) {
          assistantText = `${lastText}\n\n_(This task stopped early: ${error})_`;
        } else assistantText = `This task could not finish: ${error}\n\nYour request is saved in this conversation. You can ask me to try again without retyping it.`;
      }
    } finally {
      runtime.dispose();
      tabManager.clearBrowsingActivity(runId);
      try {
        taskLog.finishedAt = Date.now();
        taskLog.status = status;
        taskLog.steps.push({ kind: 'text', text: assistantText, ts: taskLog.finishedAt });
        taskLog.steps.push(status === 'failed'
          ? { kind: 'error', message: error ?? 'Task failed.', ts: taskLog.finishedAt }
          : { kind: 'done', ts: taskLog.finishedAt });
        conversationStore.appendTaskRun(req.conversationId, taskLog);
        if (assistantText) {
          conversationStore.appendMessage(req.conversationId, {
            role: 'assistant',
            content: assistantText,
            timestamp: Date.now(),
          });
        }
      } catch (err) {
        console.error('[agent] could not save the final answer', err);
        status = 'failed';
        error = 'The task finished, but its answer could not be saved.';
      }
      runs.delete(runId);
      win.webContents.send(IPC.AGENT_STEP, {
        runId,
        step: status === 'failed'
          ? { kind: 'error', message: error ?? 'The task could not finish.', ts: Date.now() }
          : { kind: 'done', ts: Date.now() },
      });
      win.webContents.send(IPC.AGENT_RESULT, {
        runId,
        conversationId: req.conversationId,
        status,
        text: assistantText,
        ...(error ? { error } : {}),
      } satisfies AgentResultEvent);
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
  tabManager.clearBrowsingActivity(runId);
  // Deny anything still waiting on the user. Without this, a run cancelled
  // while an "Allow Access" prompt is open leaves that promise unresolved and
  // the agent loop parked on it forever.
  for (const resolve of run.pendingConfirms.values()) resolve(false);
  run.pendingConfirms.clear();
  runs.delete(runId);
}

export function controlAllAgentRuns(command: TaskCommand): void {
  for (const id of runs.keys()) controlAgentRun(id, command);
}

export function controlAgentRun(runId: string, command: string): void {
  if (!['pause', 'resume', 'step', 'replan', 'follow', 'unfollow'].includes(command)) throw new Error('Unknown task control');
  const run = runs.get(runId);
  run?.control.command(command as TaskCommand);
  run?.notifyControl?.();
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
    case 'source': {
      const source = step.data as { url: string; title?: string; text: string };
      return { kind: 'source', url: source.url, title: source.title ?? '', text: source.text, ts };
    }
    case 'warning': return { kind: 'warning', message: step.detail ?? '', ts };
    case 'plan':
      return { kind: 'plan', detail: step.detail ?? '', goals: structuredClone((step.data as { goals?: { id: string; goal: string; status: string }[] })?.goals ?? []), ts };
    case 'thinking':
      return { kind: 'thinking', detail: step.detail, ts };
    case 'tool_call':
      return {
        kind: 'tool_call',
        callId: step.callId,
        toolName: step.toolName ?? 'unknown',
        detail: step.detail ?? '',
        input: step.data,
        ts,
      };
    case 'tool_result':
      return {
        kind: 'tool_result',
        callId: step.callId,
        durationMs: step.durationMs,
        toolName: step.toolName ?? 'unknown',
        output: step.data,
        ts,
      };
    case 'text':
      return { kind: 'text', text: step.detail ?? '', ts };
    case 'error':
      return {
        kind: 'error',
        callId: step.callId,
        durationMs: step.durationMs,
        toolName: step.toolName,
        message: step.detail ?? '',
        ...((step.data as { code?: string } | undefined)?.code ? { code: (step.data as { code: string }).code } : {}),
        ts,
      };
    case 'budget': {
      const d = (step.data ?? {}) as { used?: number; total?: number; exhausted?: boolean };
      return {
        kind: 'budget',
        detail: step.detail ?? '',
        used: d.used ?? 0,
        total: d.total ?? 0,
        exhausted: !!d.exhausted,
        ts,
      };
    }
    case 'page_instructions': {
      const d = (step.data ?? {}) as { excerpt?: unknown; signals?: unknown };
      return {
        kind: 'page_instructions',
        callId: step.callId,
        source: step.detail ?? '',
        excerpt: typeof d.excerpt === 'string' ? d.excerpt : '',
        signals: Array.isArray(d.signals) ? d.signals.filter((s): s is string => typeof s === 'string') : [],
        ts,
      };
    }
    case 'done':
      return { kind: 'done', ts };
  }
}

export function hasActiveAgentRuns(): boolean { return runs.size > 0; }

/** The Stop Task shortcut: halts whatever is running, from wherever focus is. */
export function cancelAllAgentRuns(): void {
  for (const runId of [...runs.keys()]) cancelAgentRun(runId);
}
