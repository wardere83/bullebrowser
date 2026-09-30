import type { z } from 'zod';

export type ProviderId = 'anthropic' | 'openai';

export type ClaudeModelId =
  | 'claude-opus-4-7'
  | 'claude-sonnet-4-6'
  | 'claude-haiku-4-5-20251001';

export type OpenAiModelId = 'gpt-4o' | 'gpt-4o-mini';

export type ModelId = ClaudeModelId | OpenAiModelId;

export function providerFor(model: ModelId): ProviderId {
  return model.startsWith('claude') ? 'anthropic' : 'openai';
}

// What the user picks between. The labels are deliberately white-labelled —
// no vendor names anywhere client-facing — so the underlying model can be
// swapped or upgraded without the product's surface changing. The `provider`
// field is what actually routes the call; `label` is the only part a user sees.
export const ASSISTANTS: { id: ModelId; label: string; provider: ProviderId }[] = [
  { id: 'claude-opus-4-7', label: 'BulleBrowser Pro', provider: 'anthropic' },
  { id: 'claude-sonnet-4-6', label: 'BulleBrowser Balanced', provider: 'anthropic' },
  { id: 'claude-haiku-4-5-20251001', label: 'BulleBrowser Fastest', provider: 'anthropic' },
  { id: 'gpt-4o', label: 'BulleBrowser Open', provider: 'openai' },
  { id: 'gpt-4o-mini', label: 'BulleBrowser Open Fast', provider: 'openai' },
];

// Client-facing name for a provider's credential. Used in "connect your key"
// copy, which must not name the vendor either.
export function assistantLabelFor(model: ModelId): string {
  return ASSISTANTS.find((a) => a.id === model)?.label ?? 'BulleBrowser AI';
}

export type ToolName =
  | 'getActiveTab'
  | 'listTabs'
  | 'getPageText'
  | 'getPageMetadata'
  | 'getSelection'
  | 'listLinks'
  | 'queryDom'
  | 'summarizePage'
  | 'extractStructuredData'
  | 'navigate'
  | 'clickElement'
  | 'typeIntoField'
  | 'read_page'
  | 'click'
  | 'type'
  | 'extract'
  | 'screenshot'
  | 'new_tab'
  | 'switch_tab'
  | 'list_tabs'
  | 'close_tab'
  | 'go_back'
  | 'go_forward'
  | 'reload'
  | 'scroll'
  | 'press_key'
  | 'wait_for'
  | 'select_option'
  | 'find_elements';

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
  runtime: ToolRuntime;
}

export interface ToolRuntime {
  navigate(tabId: string, url: string): Promise<{ url: string; title: string }>;
  readPage(tabId: string): Promise<{ title: string; url: string; text: string }>;
  // `url` is where the page ended up once whatever the click triggered settled.
  click(tabId: string, target: string): Promise<{ matched: string; url?: string }>;
  type(tabId: string, target: string, text: string): Promise<{ matched: string }>;
  extract(
    tabId: string,
    schema: Record<string, unknown>,
  ): Promise<{ data: unknown }>;
  screenshot(tabId: string): Promise<{ pngBase64: string }>;
  newTab(url?: string): Promise<TabSummary>;
  switchTab(tabId: string): Promise<TabSummary>;
  listTabs(): Promise<TabSummary[]>;
  closeTab(tabId: string): Promise<{ closed: boolean }>;
  goBack(tabId: string): Promise<{ url: string }>;
  goForward(tabId: string): Promise<{ url: string }>;
  reload(tabId: string): Promise<{ url: string }>;
  scroll(
    tabId: string,
    options: { direction: 'up' | 'down' | 'top' | 'bottom'; amount?: number },
  ): Promise<{ scrolledTo: number }>;
  pressKey(tabId: string, key: KeyName): Promise<{ pressed: string }>;
  waitFor(
    tabId: string,
    condition: { selector?: string; networkIdle?: boolean; timeoutMs?: number },
  ): Promise<{ matched: boolean }>;
  confirmDestructive(message: string): Promise<boolean>;

  // Optional richer browser adapters for future native wiring.
  getSelection?(tabId: string): Promise<{ text: string }>;
  listLinks?(tabId: string): Promise<{ text: string; href: string }[]>;
  queryDom?(tabId: string, selector: string): Promise<{ matches: number }>;

  // Choose an option in a <select> (by its visible label or value).
  selectOption?(tabId: string, target: string, option: string): Promise<{ matched: string }>;
  // Visible interactive elements, each tagged with a stable ref ("@12") that
  // click / type / select_option accept as their target.
  findElements?(tabId: string, query?: string): Promise<{ elements: string[] }>;
  // What a click (target) or a key press on the focused element (target null)
  // would actually act on, so the consent policy judges the real element —
  // not just the words the model happened to use to name it.
  inspectTarget?(tabId: string, target: string | null): Promise<TargetFacts>;
}

export interface TargetFacts {
  /** Visible label of the element (text, aria-label, value). */
  label: string;
  /** True when acting on it submits a form that carries the user's data
   *  (anything beyond a lone search box). */
  submitsForm: boolean;
}

export const KEY_NAMES = [
  'Enter',
  'Tab',
  'Escape',
  'Backspace',
  'Delete',
  'Space',
  'ArrowDown',
  'ArrowUp',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageDown',
  'PageUp',
] as const;
export type KeyName = (typeof KEY_NAMES)[number];

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

// A tool supplied by the host at run time — e.g. a CRM API endpoint exposed to
// the agent for the API-first integration. The agent loop only routes calls to
// it; the host's execute() does the work (makes the authenticated HTTP request
// server-side). This is how the agent operates a CRM through its API rather than
// by driving the page.
export interface ApiTool {
  name: string;
  description: string;
  /** JSON Schema (object) describing the arguments. */
  inputSchema: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => Promise<unknown>;
  /** Endpoints that write or delete data set this so the run confirms first. */
  destructive?: boolean;
}

export interface AgentInput {
  apiKey?: string;
  model: ModelId;
  systemPrompt: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  userMessage: string;
  context: ToolContext;
  onStep: AgentStepHandler;
  // Extra tools offered to the model alongside the built-in browser tools —
  // typically CRM API endpoints. Executed by their own execute(), not the
  // browser, so they bypass the browsing-consent gate.
  extraTools?: ApiTool[];
  // Asked once per run, immediately before the first tool that would touch
  // the web. Returning false doesn't fail the run — the agent simply answers
  // from its own knowledge instead of browsing. Omit to allow browsing
  // without asking (headless / test callers).
  requestBrowseAccess?: () => Promise<boolean>;
}

export interface PlanStep {
  id: string;
  toolName: ToolName;
  input: Record<string, unknown>;
  expected: string;
}

export interface ExecutionPlan {
  goal: string;
  rationale: string;
  steps: PlanStep[];
}

export interface VerificationResult {
  ok: boolean;
  reason?: string;
}

export interface PolicyDecision {
  allowed: boolean;
  reason?: string;
  requiresConfirmation: boolean;
}

export const MAX_TOOL_CALLS_PER_TASK = 25;
