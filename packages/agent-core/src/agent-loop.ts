// The agent loop. Receives messages, calls Anthropic with tool-use,
// dispatches tool calls into the desktop runtime via ToolContext, and
// streams steps back to the renderer through onStep.

import Anthropic from '@anthropic-ai/sdk';
import {
  MAX_TOOL_CALLS_PER_TASK,
  type AgentStepHandler,
  type ToolContext,
} from './types.js';
import { getTool, toAnthropicTools } from './tools/index.js';

export type ClaudeModelId =
  | 'claude-opus-4-7'
  | 'claude-sonnet-4-6'
  | 'claude-haiku-4-5-20251001';

export const DEFAULT_MODEL: ClaudeModelId = 'claude-opus-4-7';

export interface AgentInput {
  apiKey: string;
  model: ClaudeModelId;
  systemPrompt: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  userMessage: string;
  context: ToolContext;
  onStep: AgentStepHandler;
}

interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export async function runAgent(input: AgentInput): Promise<string> {
  const client = new Anthropic({ apiKey: input.apiKey });
  const tools = toAnthropicTools();

  const messages: AnthropicMessage[] = [
    ...input.history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: input.userMessage },
  ];

  let toolCallCount = 0;
  let finalText = '';

  while (toolCallCount <= MAX_TOOL_CALLS_PER_TASK) {
    if (input.context.signal.aborted) {
      input.onStep({ type: 'error', detail: 'Cancelled by user.' });
      throw new Error('cancelled');
    }

    input.onStep({ type: 'thinking', detail: 'Thinking…' });

    const response = await client.messages.create(
      {
        model: input.model,
        max_tokens: 4096,
        system: input.systemPrompt,
        tools: tools as unknown as Anthropic.Messages.ToolUnion[],
        messages: messages as unknown as Anthropic.Messages.MessageParam[],
      },
      { signal: input.context.signal },
    );

    const blocks = response.content as ContentBlock[];
    const toolUses = blocks.filter((b) => b.type === 'tool_use');
    const textBlocks = blocks.filter((b) => b.type === 'text');

    for (const t of textBlocks) {
      if (t.text) {
        finalText += (finalText ? '\n\n' : '') + t.text;
        input.onStep({ type: 'text', detail: t.text });
      }
    }

    if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
      input.onStep({ type: 'done' });
      return finalText;
    }

    messages.push({ role: 'assistant', content: blocks });
    const toolResults: ContentBlock[] = [];

    for (const tu of toolUses) {
      if (input.context.signal.aborted) throw new Error('cancelled');
      toolCallCount += 1;
      if (toolCallCount > MAX_TOOL_CALLS_PER_TASK) {
        input.onStep({
          type: 'error',
          detail: `Reached the ${MAX_TOOL_CALLS_PER_TASK} tool-call limit. Stopping.`,
        });
        return finalText;
      }
      const tool = getTool(tu.name ?? '');
      input.onStep({
        type: 'tool_call',
        toolName: tu.name as never,
        detail: describeToolCall(tu.name ?? '', tu.input),
        data: tu.input,
      });

      let resultText: string;
      let isError = false;
      try {
        if (!tool) throw new Error(`Unknown tool: ${tu.name}`);
        if (tool.destructive) {
          const ok = await input.context.runtime.confirmDestructive(
            describeToolCall(tu.name ?? '', tu.input),
          );
          if (!ok) throw new Error('User declined the destructive action.');
        }
        const parsed = tool.inputSchema.parse(tu.input ?? {});
        const out = await tool.execute(parsed, input.context);
        resultText = JSON.stringify(out);
        input.onStep({ type: 'tool_result', toolName: tu.name as never, data: out });
      } catch (err) {
        isError = true;
        resultText =
          err instanceof Error ? err.message : 'Unknown error executing tool';
        input.onStep({ type: 'error', toolName: tu.name as never, detail: resultText });
      }
      toolResults.push({
        type: 'tool_result',
        ...({ tool_use_id: tu.id, content: resultText, is_error: isError } as Record<
          string,
          unknown
        >),
      } as ContentBlock);
    }

    messages.push({ role: 'user', content: toolResults });
  }

  input.onStep({ type: 'done' });
  return finalText;
}

function describeToolCall(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return name;
  const fields = Object.entries(input as Record<string, unknown>)
    .map(([k, v]) => `${k}=${formatValue(v)}`)
    .join(', ');
  return `${name}(${fields})`;
}

function formatValue(v: unknown): string {
  if (typeof v === 'string') return v.length > 60 ? `${v.slice(0, 57)}…` : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v).slice(0, 60);
}
