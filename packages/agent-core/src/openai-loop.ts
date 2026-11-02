// The ChatGPT (OpenAI) side of the agent.
//
// Same contract as the Claude loop in agent-loop.ts — same tools, same consent
// gate, same policy — but spoken in OpenAI's Chat Completions dialect. It talks
// to the REST API over fetch rather than pulling in the openai SDK: the wire
// format for tool calling is small and stable, and adding a dependency would
// churn the frozen lockfile that CI installs from.
//
// Shape differences that matter here:
//   • tools are {type:'function', function:{name, description, parameters}}
//   • the model answers with message.tool_calls[], arguments as a JSON *string*
//   • results go back as {role:'tool', tool_call_id, content} — one per call,
//     and every call in a turn must be answered or the next request 400s
//   • there is no tool_result image block, so a screenshot has to follow as a
//     separate user message

import type { ToolName } from './types.js';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

export interface OpenAiToolDef {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | Array<Record<string, unknown>> | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

export interface OpenAiResponse {
  /** The exact model that answered: a dated snapshot of the one requested. */
  model?: string;
  choices: Array<{
    finish_reason: string;
    // `refusal` takes the place of `content` when the model declines a request
    // that asked for a fixed output shape.
    message: { content: string | null; refusal?: string | null; tool_calls?: OpenAiToolCall[] };
  }>;
  /** `prompt_tokens` includes the cached part reported in the details. */
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

// Mirrors the SDK's error shape closely enough that describeAgentError in the
// desktop app maps OpenAI failures onto the same messages as Anthropic's.
export class OpenAiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'OpenAiError';
  }
}

export async function createOpenAiCompletion(
  apiKey: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
  // Another address for the same endpoint: a gateway, or a test server.
  url: string = OPENAI_URL,
  transport: typeof fetch = fetch,
  onTool?: (call: OpenAiToolCall) => void,
): Promise<OpenAiResponse> {
  const response = await transport(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(onTool ? { ...body, stream: true, stream_options: { include_usage: true } } : body),
    signal,
  });

  if (!response.ok) {
    // Surface OpenAI's own message where there is one; it is far more useful
    // than "Request failed with status 400".
    let detail = '';
    try {
      const parsed = (await response.json()) as { error?: { message?: string } };
      detail = parsed.error?.message ?? '';
    } catch {
      detail = await response.text().catch(() => '');
    }
    throw new OpenAiError(detail || `OpenAI request failed (${response.status}).`, response.status);
  }

  if (onTool && response.headers?.get('content-type')?.includes('text/event-stream')) return consumeOpenAiStream(response, onTool);
  return (await response.json()) as OpenAiResponse;
}

export function toOpenAiTools(
  defs: { name: string; description: string; input_schema: Record<string, unknown> }[],
): OpenAiToolDef[] {
  return defs.map((d) => ({
    type: 'function',
    function: { name: d.name, description: d.description, parameters: d.input_schema },
  }));
}

// OpenAI hands tool arguments back as a JSON string, and a model can emit
// malformed JSON. Fail per-call rather than tearing down the run.
export function parseToolArguments(call: OpenAiToolCall): {
  name: ToolName;
  input: Record<string, unknown>;
  error?: string;
} {
  const name = call.function.name as ToolName;
  const raw = call.function.arguments?.trim();
  if (!raw) return { name, input: {} };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { name, input: {}, error: `Tool arguments must be a JSON object, got: ${raw}` };
    }
    return { name, input: parsed as Record<string, unknown> };
  } catch {
    return { name, input: {}, error: `Tool arguments were not valid JSON: ${raw}` };
  }
}


/** Assemble SSE deltas without waiting for the terminal model turn to dispatch complete calls. */
export async function consumeOpenAiStream(response: Response, onTool: (call: OpenAiToolCall) => void): Promise<OpenAiResponse> {
  if (!response.body) throw new Error('OpenAI returned an empty stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const calls = new Map<number, OpenAiToolCall>();
  const dispatched = new Set<number>();
  let nextDispatch = 0;
  let pending = '', content = '', finish = '', model: string | undefined;
  let usage: OpenAiResponse['usage'];
  const processLine = (line: string) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    const event = JSON.parse(data);
    if (event.error) throw new Error('The model stream reported an error.');
    if (event.model) model = event.model;
    if (event.usage) usage = event.usage;
    const choice = event.choices?.find((item: { index: number }) => item.index === 0);
    if (!choice) return;
    if (choice.finish_reason) finish = choice.finish_reason;
    const delta = choice.delta ?? {};
    if (typeof delta.content === 'string') content += delta.content;
    if (typeof delta.refusal === 'string') content += delta.refusal;
    for (const part of delta.tool_calls ?? []) {
      if (!Number.isInteger(part.index) || part.index < 0 || part.index > 1024) throw new Error('Invalid streamed tool index.');
      const call = calls.get(part.index) ?? { id: '', type: 'function', function: { name: '', arguments: '' } };
      if (dispatched.has(part.index) && (part.id || part.function?.name || part.function?.arguments?.trim())) throw new Error('A dispatched tool call changed in the stream.');
      if (part.id) call.id += part.id;
      if (part.function?.name) call.function.name += part.function.name;
      if (part.function?.arguments) call.function.arguments += part.function.arguments;
      calls.set(part.index, call);
      // Preserve provider call order across interleaved argument fragments.
      for (;;) {
        const ready = calls.get(nextDispatch);
        if (!ready?.id || !ready.function.name || !ready.function.arguments.trim() || parseToolArguments(ready).error) break;
        dispatched.add(nextDispatch++);
        onTool(structuredClone(ready));
      }
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      let end: number;
      while ((end = pending.indexOf('\n')) >= 0) { processLine(pending.slice(0, end).replace(/\r$/, '')); pending = pending.slice(end + 1); }
      if (done) break;
    }
    if (pending.trim()) processLine(pending);
    if (!finish) throw new Error('The assistant stream ended before a complete turn.');
    const ordered = [...calls.entries()].sort(([a], [b]) => a - b);
    for (const [index, call] of ordered) {
      if (!call.id || !call.function.name) throw new Error('Incomplete streamed tool call.');
      if (!dispatched.has(index)) onTool(call);
    }
    return { model, usage, choices: [{ finish_reason: finish, message: { content, ...(calls.size ? { tool_calls: ordered.map(([, call]) => call) } : {}) } }] };
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
