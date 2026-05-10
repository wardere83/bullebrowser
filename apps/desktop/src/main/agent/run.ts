// Coordinates one user-initiated agent task: builds the system prompt
// (skill-aware), wires the ToolContext to the active tab, runs the loop,
// and forwards every step over IPC to the renderer.

import { randomUUID } from 'node:crypto';
import { type BrowserWindow } from 'electron';
import {
  DEFAULT_MODEL,
  findSkill,
  runAgent,
  type AgentStep,
  type ToolContext,
} from '@bullebrowser/agent-core';
import { IPC, type AgentRunRequest } from '../../shared/ipc.js';
import type { AgentStepEvent } from '../../shared/agent-events.js';
import { conversationStore } from '../storage/conversations.js';
import { tabManager } from '../tabs/manager.js';
import { getApiKey } from '../storage/secrets.js';
import { DesktopToolRuntime } from './runtime.js';

interface ActiveRun {
  controller: AbortController;
  pendingConfirms: Map<string, (approved: boolean) => void>;
}

const runs = new Map<string, ActiveRun>();

const BASE_SYSTEM = [
  'You are the BulleBrowser agent. You have control of the user\'s desktop browser.',
  'You can navigate, read pages, click, type, extract structured data, and manage tabs.',
  'Operate carefully: prefer reading before clicking, prefer extract over guessing,',
  'and never submit forms or download files without explicit user confirmation.',
  'Cite URLs in your final answer. If you reach the 25 tool-call limit, summarize',
  'what you have so far and ask the user how to proceed.',
].join('\n');

export async function startAgentRun(
  win: BrowserWindow,
  req: AgentRunRequest,
): Promise<{ runId: string }> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error(
      'No Anthropic API key configured. Open Settings → AI to add one.',
    );
  }
  const conversation = conversationStore.get(req.conversationId);
  if (!conversation) throw new Error('Conversation not found');

  const userMsg = {
    role: 'user' as const,
    content: req.userMessage,
    timestamp: Date.now(),
  };
  conversationStore.appendMessage(req.conversationId, userMsg);

  const runId = randomUUID();
  const controller = new AbortController();
  const pendingConfirms = new Map<string, (approved: boolean) => void>();
  runs.set(runId, { controller, pendingConfirms });

  let activeTabId = tabManager.getActiveId();
  if (!activeTabId) {
    const created = await tabManager.create();
    activeTabId = created.id;
  }

  const runtime = new DesktopToolRuntime({
    request: (message: string) =>
      new Promise<boolean>((resolve) => {
        const id = randomUUID();
        pendingConfirms.set(id, resolve);
        win.webContents.send(IPC.AGENT_CONFIRM_REQUEST, { runId, id, message });
      }),
  });

  const skill = req.skillId ? findSkill(req.skillId) : undefined;
  const systemPrompt = skill ? `${BASE_SYSTEM}\n\n${skill.systemPrompt}` : BASE_SYSTEM;

  const ctx: ToolContext = {
    activeTabId,
    signal: controller.signal,
    runtime,
  };

  // Fire and forget — we don't await; results stream over IPC.
  void (async () => {
    let assistantText = '';
    try {
      assistantText = await runAgent({
        apiKey,
        model: req.model ?? DEFAULT_MODEL,
        systemPrompt,
        history: conversation.messages
          .filter((m) => m !== userMsg)
          .map((m) => ({ role: m.role, content: m.content })),
        userMessage: req.userMessage,
        context: ctx,
        onStep: (step) => {
          win.webContents.send(IPC.AGENT_STEP, {
            runId,
            step: stepToEvent(step),
          });
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Agent run failed';
      win.webContents.send(IPC.AGENT_STEP, {
        runId,
        step: { kind: 'error', message, ts: Date.now() } satisfies AgentStepEvent,
      });
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

export function cancelAgentRun(runId: string) {
  const run = runs.get(runId);
  if (!run) return;
  run.controller.abort();
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
