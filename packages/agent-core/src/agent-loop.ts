import { runLocalAgent } from './local-agent.js';
// The BulleBrowser agent loop.
//
// This is a real Claude tool-use loop: the model is given the browser tool
// surface (navigate, read_page, click, type, …) and driven in a
// perceive → decide → act → observe cycle. Claude chooses which tools to call
// based on the running results, so the agent can actually browse — search,
// follow links, read multiple tabs — and synthesize a grounded answer, rather
// than executing a fixed, pre-baked plan.
//
// The desktop main process injects a ToolRuntime (via ToolContext) that maps
// each tool onto the active WebContentsView, and forwards every step to the
// renderer through `onStep`.

import Anthropic from '@anthropic-ai/sdk';
import { SessionMemoryStore } from './memory.js';
import { PrivacyPolicyEngine } from './policy.js';
import { retrieveContext } from './retrieval.js';
import { getTool, zodToJsonSchema } from './tools/index.js';
import {
  RETRY_DELAYS_MS,
  RETRYABLE_TOOLS,
  ToolError,
  errorPayload,
  toToolError,
  type ToolErrorCode,
} from './errors.js';
import { neutralize, neutralizeDeep, wrapUntrusted, UNTRUSTED_RULES } from './untrusted.js';
import { requiredLevel } from './permissions.js';
import { StepBudget } from './budget.js';
import { PRODUCT_IDENTITY_INSTRUCTIONS, productQuestionReply, protectAssistantIdentity, protectConversationIdentity } from './product-identity.js';
import {
  createOpenAiCompletion,
  parseToolArguments,
  toOpenAiTools,
  type OpenAiMessage,
} from './openai-loop.js';
import {
  providerFor,
  type AgentInput,
  type AgentStepHandler,
  type ApiTool,
  type ModelId,
  type PlanStep,
  type ActionPreview,
  type PermissionLevel,
  type TargetFacts,
  type ToolContext,
  type ToolName,
} from './types.js';

export const DEFAULT_MODEL: ModelId = 'claude-opus-4-7';

// How much of the active tab's text is handed to the model up front.
const PAGE_SNIPPET_CHARS = 6_000;

// Tool results older than this many turns are cut down before each request.
// Every result otherwise rides along on every later turn, so a run that reads
// ten long pages resends all ten each time — slow, costly, and eventually
// over the context limit. The model can re-read a page if it needs it again.
const KEEP_RECENT_RESULT_TURNS = 3;
const ELIDED_RESULT_CHARS = 1_200;

// Max tokens for each model turn. Well under the SDK's non-streaming HTTP
// timeout while leaving room for a substantial final report.
const MAX_TOKENS_PER_TURN = 4096;

// The tools we expose to the model. This is a curated subset of the registry:
// the primary, well-described tools (using the same names referenced in the
// system prompt) rather than every legacy alias, so the model isn't offered
// three ways to do the same thing.
const AGENT_TOOL_NAMES: ToolName[] = [
  'navigate',
  'read_page',
  'find_elements',
  'getPageMetadata',
  'list_tabs',
  'new_tab',
  'switch_tab',
  'close_tab',
  'go_back',
  'go_forward',
  'reload',
  'click',
  'type',
  'select_option',
  'press_key',
  'scroll',
  'wait_for',
  'extract',
  'listLinks',
  'getSelection',
  'screenshot',
];

// Tools that read or drive the live web. The first time the model reaches for
// one of these, the user is asked for access ("Allow Access") — browsing on
// someone's real, logged-in browser is a meaningful thing to consent to.
// Everything else (answering from knowledge, listing tabs) needs no gate.
const BROWSING_TOOL_NAMES = new Set<ToolName>([
  'navigate',
  'read_page',
  'getPageMetadata',
  'find_elements',
  'click',
  'type',
  'select_option',
  'press_key',
  'scroll',
  'wait_for',
  'extract',
  'listLinks',
  'getSelection',
  'screenshot',
  'new_tab',
  'go_back',
  'go_forward',
  'reload',
]);

function buildToolDefs(): Anthropic.Tool[] {
  const defs: Anthropic.Tool[] = [];
  for (const name of AGENT_TOOL_NAMES) {
    const tool = getTool(name);
    if (!tool) continue;
    defs.push({
      name: tool.name,
      description: tool.description,
      input_schema: zodToJsonSchema(tool.inputSchema) as Anthropic.Tool.InputSchema,
    });
  }
  return defs;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}… [truncated]` : value;
}

// Compact, IPC-safe preview of a tool's output for the step stream. Keeps large
// blobs (screenshot base64, full page text) out of the renderer feed.
function previewOutput(output: unknown): unknown {
  if (output && typeof output === 'object') {
    const rec = output as Record<string, unknown>;
    if (typeof rec.pngBase64 === 'string') {
      return { pngBase64: `<png ${rec.pngBase64.length} bytes>` };
    }
    if (typeof rec.text === 'string') {
      return { ...rec, text: truncate(rec.text, 400) };
    }
  }
  if (typeof output === 'string') return truncate(output, 400);
  return output;
}

// Provider-neutral result of running one tool. Both the Claude and the ChatGPT
// loop go through executeToolCall and then adapt this to their own wire format,
// so the consent gate, the policy checks and the step reporting exist once
// rather than once per provider.
export interface ToolCallOutcome {
  text: string;
  isError: boolean;
  /** Base64 PNG, set only for a successful screenshot. */
  imagePngBase64?: string;
  /** Set when the call failed. */
  errorCode?: ToolErrorCode;
}

/** One executed tool call, for the run log. */
export interface ToolCallRecord {
  callId: string;
  name: string;
  input: Record<string, unknown>;
  ok: boolean;
  errorCode?: ToolErrorCode;
  /** The result as the model saw it (truncated). */
  result: string;
  attempts: number;
  startedAt: number;
  durationMs: number;
}

export interface ToolCallHooks {
  /** Called after every call with its full record. */
  onRecord?: (record: ToolCallRecord) => void;
}

// Everything a browser tool returns is page-derived (text, titles, labels,
// URLs, even error messages that quote what is on the page), and so is what
// a host API tool returns. All of it reaches the model only inside the
// untrusted-data wrapper.
function sealed(text: string, source: string): string {
  return wrapUntrusted(text, source);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('cancelled'));
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error('cancelled'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function executeToolCall(
  callId: string,
  rawName: string,
  rawInput: unknown,
  context: ToolContext,
  policy: PrivacyPolicyEngine,
  onStep: AgentStepHandler,
  gate: BrowseGate,
  extraTools: Map<string, ApiTool> = new Map(),
  hooks: ToolCallHooks = {},
): Promise<ToolCallOutcome> {
  const name = rawName as ToolName;
  const input = (rawInput ?? {}) as Record<string, unknown>;
  const startedAt = Date.now();
  let attempts = 0;

  const record = (outcome: ToolCallOutcome): ToolCallOutcome => {
    hooks.onRecord?.({
      callId,
      name,
      input: policy.redact(input) as Record<string, unknown>,
      ok: !outcome.isError,
      ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}),
      result: truncate(outcome.imagePngBase64 ? '[screenshot]' : outcome.text, 4000),
      attempts,
      startedAt,
      durationMs: Date.now() - startedAt,
    });
    return outcome;
  };
  const fail = (error: unknown): ToolCallOutcome => {
    const err = toToolError(error);
    onStep({ type: 'error', toolName: name, detail: err.message, data: { code: err.code, retryable: err.retryable } });
    return record({
      text: sealed(JSON.stringify(neutralizeDeep(errorPayload(err))), name),
      isError: true,
      errorCode: err.code,
    });
  };

  onStep({
    type: 'tool_call',
    toolName: name,
    detail: `${name}(${truncate(JSON.stringify(input), 200)})`,
    data: policy.redact(input),
  });

  // Host-supplied API tools run before the browser registry: they aren't
  // browser actions, so they skip the browse-consent gate, but a data-writing
  // endpoint still asks the user first.
  const apiTool = extraTools.get(name);
  if (apiTool) {
    if (apiTool.destructive) {
      const approved = await context.runtime.confirmDestructive(
        `Confirm action: ${name} ${truncate(JSON.stringify(input), 300)}`,
        { summary: `Call ${name}`, fields: Object.entries(input).map(([k, v]) => ({ label: k, value: truncate(typeof v === 'string' ? v : JSON.stringify(v), 300) })) },
      );
      if (!approved) return fail(new ToolError('USER_DECLINED', `The user declined ${name}.`));
    }
    attempts = 1;
    try {
      const output = await apiTool.execute(input);
      onStep({ type: 'tool_result', toolName: name, data: policy.redact(previewOutput(output)) });
      const text = typeof output === 'string' ? output : JSON.stringify(neutralizeDeep(output));
      return record({ text: sealed(truncate(text, 100_000), `api:${name}`), isError: false });
    } catch (error) {
      return fail(error);
    }
  }

  const tool = getTool(name);
  if (!tool) return fail(new ToolError('VALIDATION_ERROR', `Unknown tool: ${name}`));

  // Browsing consent, asked once per run on the first web-touching tool.
  if (BROWSING_TOOL_NAMES.has(name) && !(await gate.allowed())) {
    return fail(
      new ToolError(
        'USER_DECLINED',
        'The user declined browser access for this task. Do not call any browsing tool again. ' +
          'Answer from your own knowledge instead, and say plainly that you could not check the live page.',
      ),
    );
  }

  // Validate before anything is asked of the user or the page.
  let parsed: unknown;
  try {
    parsed = tool.inputSchema.parse(input);
  } catch (error) {
    return fail(new ToolError('VALIDATION_ERROR', error instanceof Error ? error.message : 'Invalid input.'));
  }

  // Privacy / safety policy: block sensitive actions outright, and require an
  // explicit user confirmation for destructive ones (submit, purchase, delete…).
  // Clicks and Enter are judged on the element they will really hit: a click
  // named by selector ("#btn-2") or an Enter in a sign-up form says nothing
  // risky in its input, yet submits the user's data all the same.
  const facts = await inspectForPolicy(name, input, context);
  const step: PlanStep = {
    id: callId,
    toolName: name,
    input: facts ? { ...input, _facts: facts } : input,
    expected: '',
  };
  const decision = policy.evaluateToolStep(step);
  if (!decision.allowed) return fail(new ToolError('BLOCKED_BY_POLICY', decision.reason ?? 'Blocked by policy.'));

  // What a consequential action will send, for the confirmation card.
  const preview = decision.requiresConfirmation ? await previewFor(name, input, context) : undefined;

  // Per-site permission: does this site allow this kind of action?
  let confirmed = false;
  const need = requiredLevel(name, input, facts);
  if (need !== 'read' && context.runtime.checkPermission) {
    const verdict = await context.runtime.checkPermission(context.activeTabId, need, {
      action: describeAction(name, input, facts),
      ...(preview ? { preview } : {}),
    });
    if (verdict === 'denied') {
      return fail(
        new ToolError('PERMISSION_DENIED', `This site is not allowed to ${PERMISSION_VERBS[need]} — the user did not grant it.`),
      );
    }
    confirmed = verdict === 'confirmed';
  }

  if (decision.requiresConfirmation && !confirmed) {
    const approved = await context.runtime.confirmDestructive(`Confirm action: ${name} ${JSON.stringify(input)}`, preview);
    if (!approved) return fail(new ToolError('USER_DECLINED', `The user declined this ${name}.`));
  }

  // Run it, retrying the actions that are safe to repeat when the failure is
  // a known-transient one (element replaced mid-action, page mid-navigation,
  // target closed, network changed). Everything else fails straight away.
  const retryable = RETRYABLE_TOOLS.has(name);
  for (;;) {
    attempts += 1;
    try {
      const output = await tool.execute(parsed, context);
      onStep({ type: 'tool_result', toolName: name, data: policy.redact(previewOutput(output)) });

      // Hand a screenshot back as a real image so the model can see the page,
      // rather than dumping a giant base64 string into a text result.
      if (name === 'screenshot' && output && typeof output === 'object' && 'pngBase64' in output) {
        const png = (output as { pngBase64: string }).pngBase64;
        if (png) return record({ text: 'Screenshot captured.', isError: false, imagePngBase64: png });
        return fail(new ToolError('UNKNOWN', 'The screenshot came back empty.'));
      }

      const text = typeof output === 'string' ? neutralize(output) : JSON.stringify(neutralizeDeep(output));
      return record({ text: sealed(truncate(text, 100_000), name), isError: false });
    } catch (error) {
      const err = toToolError(error);
      const delay = RETRY_DELAYS_MS[attempts - 1];
      if (!retryable || !err.retryable || delay === undefined || context.signal.aborted) return fail(err);
      onStep({ type: 'thinking', detail: `Retrying ${name} (${err.code})…` });
      try {
        await sleep(delay, context.signal);
      } catch {
        return fail(err);
      }
    }
  }
}

const PERMISSION_VERBS: Record<PermissionLevel, string> = {
  read: 'read pages',
  click: 'click',
  type: 'type or choose values',
  full: 'submit, upload or download',
};

function describeAction(name: ToolName, input: Record<string, unknown>, facts: TargetFacts | null): string {
  const what = facts?.label ? `"${truncate(facts.label, 60)}"` : typeof input.target === 'string' ? `"${truncate(input.target, 60)}"` : '';
  switch (name) {
    case 'type':
    case 'typeIntoField':
      return `type into ${what || 'a field'}`;
    case 'select_option':
      return `choose "${truncate(String(input.option ?? ''), 40)}" in ${what || 'a dropdown'}`;
    case 'press_key':
      return facts?.submitsForm ? `submit a form (press ${String(input.key)})` : `press ${String(input.key)}`;
    case 'upload_file':
      return `upload "${truncate(String(input.name ?? ''), 60)}"`;
    default:
      return facts?.submitsForm ? `submit a form via ${what}` : `click ${what || 'an element'}`;
  }
}

async function previewFor(
  name: ToolName,
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<ActionPreview | undefined> {
  if (!context.runtime.previewAction) return undefined;
  const target =
    name === 'press_key' ? null : typeof input.target === 'string' ? input.target : null;
  if (name !== 'press_key' && target === null && name !== 'upload_file') return undefined;
  try {
    const p = await context.runtime.previewAction(context.activeTabId, target);
    if (name === 'upload_file' && typeof input.name === 'string') {
      return { ...p, files: [...(p.files ?? []), { name: input.name }] };
    }
    return p;
  } catch {
    return undefined;
  }
}

async function inspectForPolicy(
  name: ToolName,
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<TargetFacts | null> {
  const inspect = context.runtime.inspectTarget?.bind(context.runtime);
  if (!inspect) return null;
  let target: string | null;
  let key: 'Enter' | 'Space' | undefined;
  if (name === 'click' || name === 'clickElement') target = String(input.target ?? '');
  else if (name === 'press_key' && (input.key === 'Enter' || input.key === 'Space')) {
    target = null;
    key = input.key;
  } else return null;
  try {
    return await inspect(context.activeTabId, target, key);
  } catch (error) {
    // Nothing matched: the action itself will fail and say so.
    if (error instanceof Error && /^No (element|input) matched/.test(error.message)) return null;
    // Anything else (a frame that didn't answer, a page mid-reload) means we
    // don't know what this will press — fail closed and ask the user.
    return { label: 'an element that could not be inspected', submitsForm: true };
  }
}

// Adapt a neutral outcome to Anthropic's tool_result. The Messages API requires
// content to be a string or an array of content blocks — never a raw object.
function toAnthropicToolResult(
  id: string,
  outcome: ToolCallOutcome,
): Anthropic.ToolResultBlockParam {
  if (outcome.imagePngBase64) {
    return {
      type: 'tool_result',
      tool_use_id: id,
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: outcome.imagePngBase64 },
        },
      ],
    };
  }
  return {
    type: 'tool_result',
    tool_use_id: id,
    content: outcome.text,
    ...(outcome.isError ? { is_error: true } : {}),
  };
}

// Asks for browsing access at most once per run and remembers the answer, so
// a task that visits ten pages prompts the user once rather than ten times.
// Concurrent tool calls in the same turn share the single in-flight request.
interface BrowseGate {
  allowed(): Promise<boolean>;
}

function createBrowseGate(request?: () => Promise<boolean>): BrowseGate {
  if (!request) return { allowed: async () => true };
  let pending: Promise<boolean> | null = null;
  return {
    allowed: () => {
      pending ??= request();
      return pending;
    },
  };
}

export async function runAgent(input: AgentInput): Promise<string> {
  const { context, onStep } = input;

  if (context.signal.aborted) {
    onStep({ type: 'error', detail: 'Cancelled by user.' });
    throw new Error('cancelled');
  }

  const productReply = productQuestionReply(input.userRequest ?? input.userMessage, input.history);
  if (productReply) {
    onStep({ type: 'text', detail: productReply });
    onStep({ type: 'done' });
    return productReply;
  }
  input = { ...input, history: protectConversationIdentity(input.history) };
  const provider = providerFor(input.model);

  const policy = new PrivacyPolicyEngine();
  const memory = new SessionMemoryStore();
  const gate = createBrowseGate(input.requestBrowseAccess);

  if (!input.apiKey) {
    onStep({ type: 'thinking', detail: 'BulleBrowser Agentic AI is working…' });
    return runLocalAgent(input, (name, args) => executeToolCall(
      `local-${name}`, name, args, context, policy, onStep, gate, new Map(),
      { onRecord: input.onToolRecord },
    ));
  }

  // Context from the page the user is already looking at is not gated: it's
  // the tab in front of them, and the panel is expected to know it. The
  // consent gate covers the agent going *off* and driving the browser itself.
  onStep({ type: 'thinking', detail: 'Reading the current page…' });
  const perceived = await retrieveContext(context, memory);

  // The page in front of the user, so "summarize this" or "what does this say
  // about X" can be answered straight away instead of spending a read_page
  // first. Its title, address and text are all page-derived, so they travel
  // as sealed data alongside the user's message — never in the system prompt.
  const pageContext = perceived.url
    ? wrapUntrusted(
        [
          `Active tab: ${perceived.title ?? 'Untitled'} — ${perceived.url}`,
          perceived.unreadableReason
            ? `(This page is open but its text could not be read: ${perceived.unreadableReason}. ` +
              'Do not assume the tab is empty; tell the user if the task depends on reading it.)'
            : '',
          perceived.textSnippet
            ? `Opening text of the page (call read_page for the rest if it is longer):\n${perceived.textSnippet.slice(0, PAGE_SNIPPET_CHARS)}`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
        'active_tab',
      )
    : '';
  const contextNote = perceived.url
    ? '\n\nThe active tab (its title, address and opening text) is given as untrusted data in the ' +
      "user's latest message."
    : '\n\nCurrent browser context: no page is loaded yet. Use `navigate` (for ' +
      'example to a search engine) to begin.';
  const system = `${input.systemPrompt}\n\n${PRODUCT_IDENTITY_INSTRUCTIONS}\n\n${UNTRUSTED_RULES}${contextNote}`;
  const budget = new StepBudget(input.budget);
  const userTurnText = pageContext ? `${pageContext}\n\n${input.userMessage}` : input.userMessage;

  // Merge host-supplied API tools in with the built-in browser tools so the
  // model can call either. The map routes execution; the defs advertise them.
  const extraTools = new Map((input.extraTools ?? []).map((t) => [t.name, t]));
  const toolDefs: Anthropic.Tool[] = [
    ...buildToolDefs(),
    ...(input.extraTools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    })),
  ];

  if (provider === 'openai') {
    return runOpenAiTurns({ input, system, toolDefs, policy, gate, extraTools, budget, userTurnText });
  }

  const client = new Anthropic({ apiKey: input.apiKey });

  // Adaptive thinking lets the model reason between tool calls, which markedly
  // improves multi-step browsing. Supported on the Opus/Sonnet tiers but not on
  // Haiku, so gate on the model. When on, give max_tokens extra headroom since
  // thinking tokens count against it.
  const supportsThinking = !input.model.startsWith('claude-haiku');
  const maxTokens = supportsThinking ? 8192 : MAX_TOKENS_PER_TURN;
  const thinking: Anthropic.ThinkingConfigParam | undefined = supportsThinking
    ? { type: 'adaptive' }
    : undefined;

  const messages: Anthropic.MessageParam[] = [
    ...input.history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userTurnText },
  ];

  let finalText = '';

  // Each iteration is one model turn. The loop bound is a hard safety backstop;
  // the real limit is the step budget, charged per tool call below.
  for (let turn = 0; turn < budget.total * 2 + 5; turn++) {
    if (context.signal.aborted) throw new Error('cancelled');

    onStep({ type: 'thinking', detail: 'Thinking…' });

    // Pass the abort signal to the SDK so Stop interrupts a model call that's
    // already in flight. Without it, cancelling was only checked between turns
    // — the user hit Stop and then waited out the whole current response.
    elideOldToolResults(messages);
    const response = await withTurnSignal(context.signal, (signal) =>
      client.messages.create(
        {
          model: input.model,
          max_tokens: maxTokens,
          ...(thinking ? { thinking } : {}),
          system,
          tools: toolDefs,
          messages,
        },
        { signal },
      ),
    );

    const turnText = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n\n')
      .trim();
    const safeText = protectAssistantIdentity(`${finalText} ${turnText}`.trim());
    if (safeText !== `${finalText} ${turnText}`.trim()) {
      onStep({ type: 'text', detail: safeText });
      onStep({ type: 'done' });
      return safeText;
    }
    if (turnText) onStep({ type: 'text', detail: turnText });

    // The model hit the per-turn token cap mid-answer. Preserve what it wrote,
    // ask it to continue, and accumulate — otherwise the reply is silently
    // truncated. (Bounded by the outer turn limit.)
    if (response.stop_reason === 'max_tokens') {
      finalText = finalText ? `${finalText} ${turnText}`.trim() : turnText;
      messages.push({ role: 'assistant', content: response.content });
      messages.push({
        role: 'user',
        content:
          'Your previous message was cut off at the length limit. Continue from exactly ' +
          'where you stopped — do not repeat text you already wrote.',
      });
      continue;
    }

    if (response.stop_reason !== 'tool_use') {
      // Terminal turn (end_turn / stop_sequence): this is the final answer.
      finalText = finalText ? `${finalText} ${turnText}`.trim() : turnText;
      break;
    }

    // Preserve the full assistant turn (text + tool_use blocks) so the next
    // request carries the model's own reasoning and tool calls.
    messages.push({ role: 'assistant', content: response.content });

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      if (context.signal.aborted) throw new Error('cancelled');
      const charge = budget.charge(toolUse.name);
      if (!charge.ok) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: budgetExhausted(budget, onStep),
          is_error: true,
        });
        continue;
      }
      const outcome = await executeToolCall(
        toolUse.id,
        toolUse.name,
        toolUse.input,
        context,
        policy,
        onStep,
        gate,
        extraTools,
        { onRecord: input.onToolRecord },
      );
      if (charge.warn) budgetWarning(budget, outcome, onStep);
      toolResults.push(toAnthropicToolResult(toolUse.id, outcome));
    }

    messages.push({ role: 'user', content: toolResults });
  }

  onStep({ type: 'done' });
  return finalText || NO_ANSWER;
}

// Shrink tool results from all but the last few tool-result turns, in place.
// Keeps each block's tool_use_id (the API pairs them) and the head of its text.
export function elideOldToolResults(messages: Anthropic.MessageParam[]): void {
  const resultTurns = messages
    .map((m, i) => ({ m, i }))
    .filter(
      ({ m }) =>
        m.role === 'user' &&
        Array.isArray(m.content) &&
        m.content.some((b) => b.type === 'tool_result'),
    );
  for (const { m } of resultTurns.slice(0, -KEEP_RECENT_RESULT_TURNS)) {
    for (const block of m.content as Anthropic.ContentBlockParam[]) {
      if (block.type !== 'tool_result') continue;
      if (Array.isArray(block.content)) {
        block.content = '[Screenshot from an earlier step, removed to save space.]';
      } else if (typeof block.content === 'string' && block.content.length > ELIDED_RESULT_CHARS) {
        block.content =
          `${block.content.slice(0, ELIDED_RESULT_CHARS)}… [older result shortened to save space; ` +
          'call the tool again if you need the rest]';
      }
    }
  }
}

// One child signal per model call. The SDK adds an abort listener to the
// signal it is given and a run makes many calls, so handing it the run's own
// signal piled up listeners (MaxListenersExceededWarning); the child is
// dropped after each call, taking its listener with it.
async function withTurnSignal<T>(
  outer: AbortSignal,
  call: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const turn = new AbortController();
  const onAbort = () => turn.abort();
  outer.addEventListener('abort', onAbort, { once: true });
  try {
    return await call(turn.signal);
  } finally {
    outer.removeEventListener('abort', onAbort);
  }
}

// The budget ran out: the call does not run, and the model is told to stop.
const exhaustedNoted = new WeakSet<StepBudget>();
function budgetExhausted(budget: StepBudget, onStep: AgentStepHandler): string {
  if (!exhaustedNoted.has(budget)) {
    exhaustedNoted.add(budget);
    onStep({
      type: 'budget',
      detail: `Step budget used up (${budget.total}).`,
      data: { used: budget.used, total: budget.total, exhausted: true },
    });
  }
  return JSON.stringify(
    errorPayload(new ToolError('BUDGET_EXHAUSTED', `The step budget (${budget.total}) is used up.`)),
  );
}

// 75% used: tell the model (appended to this result, outside the page-data
// wrapper — it is the browser speaking) and the user.
function budgetWarning(budget: StepBudget, outcome: ToolCallOutcome, onStep: AgentStepHandler): void {
  outcome.text = `${outcome.text}\n\n${budget.warningNote()}`;
  onStep({
    type: 'budget',
    detail: `75% of the step budget used (${budget.used} of ${budget.total}).`,
    data: { used: budget.used, total: budget.total, exhausted: false },
  });
}

const NO_ANSWER =
  'I ran out of step budget before reaching a final answer. ' +
  'Raise the budget and ask me to continue, or narrow the task.';

// The ChatGPT loop. Deliberately mirrors the Claude loop above turn for turn —
// same tools, same consent gate, same policy, same limits — differing only where
// the wire format forces it.
async function runOpenAiTurns(args: {
  input: AgentInput;
  system: string;
  toolDefs: Anthropic.Tool[];
  policy: PrivacyPolicyEngine;
  gate: BrowseGate;
  extraTools: Map<string, ApiTool>;
  budget: StepBudget;
  userTurnText: string;
}): Promise<string> {
  const { input, system, toolDefs, policy, gate, extraTools, budget, userTurnText } = args;
  const { context, onStep } = input;

  const tools = toOpenAiTools(
    toolDefs.map((d) => ({
      name: d.name,
      description: d.description ?? '',
      input_schema: d.input_schema as unknown as Record<string, unknown>,
    })),
  );

  const messages: OpenAiMessage[] = [
    { role: 'system', content: system },
    ...input.history.map((m) => ({ role: m.role, content: m.content }) as OpenAiMessage),
    { role: 'user', content: userTurnText },
  ];

  let finalText = '';

  for (let turn = 0; turn < budget.total * 2 + 5; turn++) {
    if (context.signal.aborted) throw new Error('cancelled');
    onStep({ type: 'thinking', detail: 'Thinking…' });

    const response = await createOpenAiCompletion(
      input.apiKey as string,
      { model: input.model, messages, tools, tool_choice: 'auto', max_tokens: MAX_TOKENS_PER_TURN },
      context.signal,
    );

    const choice = response.choices?.[0];
    if (!choice) throw new Error('OpenAI returned no choices.');
    const turnText = (choice.message.content ?? '').trim();
    const safeText = protectAssistantIdentity(`${finalText} ${turnText}`.trim());
    if (safeText !== `${finalText} ${turnText}`.trim()) {
      onStep({ type: 'text', detail: safeText });
      onStep({ type: 'done' });
      return safeText;
    }
    if (turnText) onStep({ type: 'text', detail: turnText });

    const calls = choice.message.tool_calls ?? [];
    if (calls.length === 0) {
      finalText = finalText ? `${finalText} ${turnText}`.trim() : turnText;
      break;
    }

    // Echo the assistant turn back verbatim; OpenAI requires the tool_calls it
    // issued to be present before their results.
    messages.push({ role: 'assistant', content: choice.message.content ?? '', tool_calls: calls });

    // Every tool_call must get a matching 'tool' message or the next request is
    // rejected — so this loop must not skip any call, even past the limit.
    const images: string[] = [];
    for (const call of calls) {
      if (context.signal.aborted) throw new Error('cancelled');
      const charge = budget.charge(call.function?.name ?? '');
      if (!charge.ok) {
        messages.push({ role: 'tool', tool_call_id: call.id, content: budgetExhausted(budget, onStep) });
        continue;
      }

      const { name, input: parsedInput, error } = parseToolArguments(call);
      if (error) {
        onStep({ type: 'error', toolName: name, detail: error });
        messages.push({ role: 'tool', tool_call_id: call.id, content: error });
        continue;
      }

      const outcome = await executeToolCall(
        call.id,
        name,
        parsedInput,
        context,
        policy,
        onStep,
        gate,
        extraTools,
        { onRecord: input.onToolRecord },
      );
      if (charge.warn) budgetWarning(budget, outcome, onStep);
      messages.push({ role: 'tool', tool_call_id: call.id, content: outcome.text });
      // There is no image tool_result in this API, so a screenshot follows as a
      // user message once all the tool replies are in.
      if (outcome.imagePngBase64) images.push(outcome.imagePngBase64);
    }

    for (const png of images) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: 'Here is the screenshot you requested.' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } },
        ],
      });
    }
  }

  onStep({ type: 'done' });
  return finalText || NO_ANSWER;
}
