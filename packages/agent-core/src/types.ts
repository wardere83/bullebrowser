// Shared types used by the agent loop and tool implementations.
// The actual tool runtime is injected by the desktop app's main process,
// so this package stays free of any Electron imports.

import type { z } from 'zod';

export type ToolName =
  | 'navigate'
  | 'read_page'
  | 'click'
  | 'type'
  | 'extract'
  | 'screenshot'
  | 'new_tab'
  | 'switch_tab'
  | 'list_tabs'
  | 'wait_for';

export interface ToolDefinition<TInput, TOutput> {
  name: ToolName;
  description: string;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  destructive?: boolean;
}

export interface TabSummary {
  id: string;
  title: string;
  url: string;
  active: boolean;
}

export interface ToolContext {
  activeTabId: string;
  signal: AbortSignal;
  // Implemented by the desktop main process; agent-core consumes it abstractly.
  runtime: ToolRuntime;
}

export interface ToolRuntime {
  navigate(tabId: string, url: string): Promise<{ url: string; title: string }>;
  readPage(tabId: string): Promise<{ title: string; url: string; text: string }>;
  click(tabId: string, target: string): Promise<{ matched: string }>;
  type(tabId: string, target: string, text: string): Promise<{ matched: string }>;
  extract(
    tabId: string,
    schema: Record<string, unknown>,
  ): Promise<{ data: unknown }>;
  screenshot(tabId: string): Promise<{ pngBase64: string }>;
  newTab(url?: string): Promise<TabSummary>;
  switchTab(tabId: string): Promise<TabSummary>;
  listTabs(): Promise<TabSummary[]>;
  waitFor(
    tabId: string,
    condition: { selector?: string; networkIdle?: boolean; timeoutMs?: number },
  ): Promise<{ matched: boolean }>;
  /** Ask the user to confirm a destructive action. Resolves true if approved. */
  confirmDestructive(message: string): Promise<boolean>;
}

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface AgentStep {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'text' | 'error' | 'done';
  toolName?: ToolName;
  detail?: string;
  data?: unknown;
}

export type AgentStepHandler = (step: AgentStep) => void;

export const MAX_TOOL_CALLS_PER_TASK = 25;
