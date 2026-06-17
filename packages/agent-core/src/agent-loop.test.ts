import { describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { runAgent, DEFAULT_MODEL } from './agent-loop.js';
import type { ToolContext } from './types.js';

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: vi.fn() },
  })),
}));

const AnthropicMock = vi.mocked(Anthropic, true);

function makeRuntime(): ToolContext['runtime'] {
  return {
    navigate: vi.fn(async (_id, url) => ({ url, title: 'Example' })),
    readPage: vi.fn(async () => ({ title: 'T', url: 'https://example.com', text: 'hello' })),
    click: vi.fn(async (_id, target) => ({ matched: target })),
    type: vi.fn(async (_id, target, _text) => ({ matched: target })),
    extract: vi.fn(async () => ({ data: { ok: true } })),
    screenshot: vi.fn(async () => ({ pngBase64: 'iVBORw0KGgo=' })),
    newTab: vi.fn(async (url) => ({ id: 't-new', title: 'New', url: url ?? 'about:blank', active: true })),
    switchTab: vi.fn(async (id) => ({ id, title: 'X', url: 'https://x', active: true })),
    listTabs: vi.fn(async () => [{ id: 't1', title: 'A', url: 'https://a', active: true }]),
    closeTab: vi.fn(async () => ({ closed: true })),
    goBack: vi.fn(async () => ({ url: 'https://prev' })),
    goForward: vi.fn(async () => ({ url: 'https://next' })),
    reload: vi.fn(async () => ({ url: 'https://r' })),
    scroll: vi.fn(async () => ({ scrolledTo: 600 })),
    pressKey: vi.fn(async (_id, key) => ({ pressed: key })),
    waitFor: vi.fn(async () => ({ matched: true })),
    confirmDestructive: vi.fn(async () => true),
  };
}

function makeContext(): ToolContext {
  return {
    activeTabId: 't1',
    signal: new AbortController().signal,
    runtime: makeRuntime(),
  };
}

describe('runAgent', () => {
  it('executes a tool use and returns final assistant text', async () => {
    const create = vi.fn();
    AnthropicMock.mockImplementation(() => ({ messages: { create } } as any));

    create.mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use',
          id: 'tool-use-1',
          name: 'navigate',
          input: { url: 'https://example.com' },
        },
      ],
      stop_reason: 'tool_use',
    });
    create.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'All done.' }],
      stop_reason: 'stop',
    });

    const steps: unknown[] = [];
    const result = await runAgent({
      apiKey: 'test-key',
      model: DEFAULT_MODEL,
      systemPrompt: 'system prompt',
      history: [],
      userMessage: 'Open example.com',
      context: makeContext(),
      onStep: (step) => steps.push(step),
    });

    expect(result).toBe('All done.');
    expect(create).toHaveBeenCalledTimes(2);

    const secondCall = create.mock.calls[1]![0];
    const userMessages = secondCall.messages.filter((msg: any) => msg.role === 'user');
    const lastUserMessage = userMessages[userMessages.length - 1];
    // The Anthropic API requires tool_result.content to be a string (or
    // content blocks), so structured tool output is JSON-stringified.
    expect(lastUserMessage.content[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'tool-use-1',
      content: JSON.stringify({ url: 'https://example.com', title: 'Example' }),
    });

    expect(steps.some((step) => (step as any).type === 'tool_call')).toBe(true);
    expect(steps.some((step) => (step as any).type === 'tool_result')).toBe(true);
  });
});
