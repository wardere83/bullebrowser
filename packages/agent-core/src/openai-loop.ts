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

import { StreamInterruptedError, UnreadableReplyError } from './stream-turn.js';
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

  if (onTool && response.headers?.get('content-type')?.toLowerCase().includes('text/event-stream')) {
    return consumeOpenAiStream(response, onTool);
  }
  const completion: OpenAiResponse = await response.json().catch((error: unknown) => {
    if (error instanceof SyntaxError) throw new UnreadableReplyError();
    throw error;
  });
  if (!Array.isArray(completion?.choices) || (onTool && !completion.choices.length)) throw new UnreadableReplyError();
  for (const choice of completion.choices) {
    if (typeof choice?.finish_reason !== 'string' || !choice.message ||
        (choice.message.content != null && typeof choice.message.content !== 'string') ||
        (choice.message.tool_calls != null && !Array.isArray(choice.message.tool_calls))) throw new UnreadableReplyError();
    if (choice.finish_reason !== 'length' && choice.message.tool_calls?.some((call) =>
      !call || typeof call.id !== 'string' || !call.id || typeof call.function?.name !== 'string' || !call.function.name)) {
      throw new UnreadableReplyError();
    }
  }
  return completion;
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
  const args = call.function.arguments;
  if (args === '') return { name, input: {} };
  const invalid = { name, input: {}, error: 'Tool arguments were not valid JSON. Send a complete object to run this step.' };
  if (typeof args !== 'string') return invalid;
  const raw = args.trim();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return invalid;
    }
    return { name, input: parsed as Record<string, unknown> };
  } catch {
    return invalid;
  }
}


/** Assemble SSE deltas without waiting for the terminal model turn to dispatch complete calls. */
export async function consumeOpenAiStream(response: Response, onTool: (call: OpenAiToolCall) => void): Promise<OpenAiResponse> {
  if (!response.body) throw new StreamInterruptedError();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const calls = new Map<number, OpenAiToolCall>();
  const dispatched = new Set<number>();
  let nextDispatch = 0;
  let pending = '', content = '', finish = '', model: string | undefined;
  let usage: OpenAiResponse['usage'];
  const dataLines: string[] = [];
  const processEvent = () => {
    const data = dataLines.join('\n').trim();
    dataLines.length = 0;
    if (!data || data === '[DONE]') return;
    let event;
    try { event = JSON.parse(data); } catch { throw new UnreadableReplyError(); }
    if (!event || typeof event !== 'object' ||
        (event.choices != null && !Array.isArray(event.choices))) throw new UnreadableReplyError();
    if (event.error) throw new Error('The model stream reported an error.');
    if (event.model) model = event.model;
    if (event.usage) usage = event.usage;
    const choice = event.choices?.find((item: { index: number } | null) => item?.index === 0);
    if (!choice) return;
    if (choice.finish_reason) finish = choice.finish_reason;
    const delta = choice.delta ?? {};
    if (typeof delta.content === 'string') content += delta.content;
    if (typeof delta.refusal === 'string') content += delta.refusal;
    if (delta.tool_calls != null && !Array.isArray(delta.tool_calls)) throw new UnreadableReplyError();
    for (const part of delta.tool_calls ?? []) {
      if (!part || !Number.isInteger(part.index) || part.index < 0 || part.index > 1024 ||
          (part.id != null && typeof part.id !== 'string') ||
          (part.function?.name != null && typeof part.function.name !== 'string') ||
          (part.function?.arguments != null && typeof part.function.arguments !== 'string')) throw new UnreadableReplyError();
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
  const processLine = (line: string) => {
    if (line === '') processEvent();
    else if (line === 'data' || line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      let end: number;
      while ((end = pending.search(/[\r\n]/)) >= 0) {
        // Hold a final CR until the next chunk in case this is a split CRLF.
        if (!done && pending[end] === '\r' && end + 1 === pending.length) break;
        processLine(pending.slice(0, end));
        pending = pending.slice(end + (pending.startsWith('\r\n', end) ? 2 : 1));
      }
      if (done) break;
    }
    if (pending) processLine(pending);
    // A dropped connection can leave an unfinished last event.
    if (dataLines.length) {
      try { processEvent(); } catch (error) {
        if (!(error instanceof UnreadableReplyError)) throw error;
        if (!finish) throw new StreamInterruptedError();
      }
    }
    if (!finish) throw new StreamInterruptedError();
    const ordered = [...calls.entries()].sort(([a], [b]) => a - b);
    for (const [index, call] of ordered) {
      if (!call.id || !call.function.name) {
        if (finish === 'length') break;
        throw new UnreadableReplyError();
      }
      // A clipped or malformed call blocks later calls that may depend on it.
      if ((finish === 'length' && !call.function.arguments.trim()) || parseToolArguments(call).error) break;
      if (!dispatched.has(index)) onTool(call);
    }
    return { model, usage, choices: [{ finish_reason: finish, message: { content, ...(calls.size ? { tool_calls: ordered.map(([, call]) => call) } : {}) } }] };
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
