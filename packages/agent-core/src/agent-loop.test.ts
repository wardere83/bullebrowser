// Integration test for the agent loop. Mocks the Anthropic SDK so we can
// drive the full request/response/tool-use cycle without an API key.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runAgent } from './agent-loop.js';
import { MAX_TOOL_CALLS_PER_TASK, type ToolContext, type ToolRuntime } from './types.js';

// --- Anthropic SDK mock ---

const createMock = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: { create: (...args: unknown[]) => createMock(...args) },
    })),
  };
});

function textResponse(text: string) {
  return {
    id: 'msg_1',
    role: 'assistant',
    type: 'message',
    model: 'claude-opus-4-7',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
    content: [{ type: 'text', text }],
  };
}

function toolUseResponse(blocks: { id: string; name: string; input: unknown }[]) {
  return {
    id: 'msg_tu',
    role: 'assistant',
    type: 'message',
    model: 'claude-opus-4-7',
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
    content: blocks.map((b) => ({
      type: 'tool_use',
      id: b.id,
      name: b.name,
      input: b.input,
    })),
  };
}

function makeRuntime(overrides: Partial<ToolRuntime> = {}): ToolRuntime {
  return {
    navigate: vi.fn(async (_id, url) => ({ url, title: 'T' })),
    readPage: vi.fn(async () => ({ title: 'T', url: 'https://x', text: 'hi' })),
    click: vi.fn(async (_id, target) => ({ matched: target })),
    type: vi.fn(async (_id, target) => ({ matched: target })),
    extract: vi.fn(async () => ({ data: {} })),
    screenshot: vi.fn(async () => ({ pngBase64: '' })),
    newTab: vi.fn(async (url) => ({ id: 't', title: 'T', url: url ?? '', active: true })),
    switchTab: vi.fn(async (id) => ({ id, title: 'T', url: '', active: true })),
    listTabs: vi.fn(async () => []),
    waitFor: vi.fn(async () => ({ matched: true })),
    confirmDestructive: vi.fn(async () => true),
    ...overrides,
  };
}

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    activeTabId: 't1',
    signal: new AbortController().signal,
    runtime: makeRuntime(),
    ...overrides,
  };
}

beforeEach(() => createMock.mockReset());
afterEach(() => vi.clearAllMocks());

describe('runAgent', () => {
  it('returns assistant text and stops on end_turn', async () => {
    createMock.mockResolvedValueOnce(textResponse('All done.'));
    const steps: string[] = [];
    const out = await runAgent({
      apiKey: 'sk-ant-test',
      model: 'claude-opus-4-7',
      systemPrompt: 'sys',
      history: [],
      userMessage: 'hi',
      context: makeCtx(),
      onStep: (s) => { if (s.detail) steps.push(`${s.type}:${s.detail.slice(0, 40)}`); },
    });
    expect(out).toBe('All done.');
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(steps.some((s) => s.startsWith('text:'))).toBe(true);
    expect(steps.some((s) => s.startsWith('thinking:'))).toBe(true);
  });

  it('dispatches tool_use blocks and continues the loop', async () => {
    createMock
      .mockResolvedValueOnce(
        toolUseResponse([{ id: 'tu_1', name: 'navigate', input: { url: 'https://example.com' } }]),
      )
      .mockResolvedValueOnce(textResponse('Navigated.'));

    const ctx = makeCtx();
    const out = await runAgent({
      apiKey: 'sk-ant-test',
      model: 'claude-opus-4-7',
      systemPrompt: 'sys',
      history: [],
      userMessage: 'open example',
      context: ctx,
      onStep: () => {},
    });
    expect(out).toBe('Navigated.');
    expect(ctx.runtime.navigate).toHaveBeenCalledWith('t1', 'https://example.com');
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it('reports tool errors as is_error tool_result without crashing', async () => {
    const runtime = makeRuntime({
      navigate: vi.fn(async () => { throw new Error('boom'); }),
    });
    createMock
      .mockResolvedValueOnce(
        toolUseResponse([{ id: 'tu_1', name: 'navigate', input: { url: 'https://x.com' } }]),
      )
      .mockResolvedValueOnce(textResponse('Recovered.'));

    const errors: string[] = [];
    const out = await runAgent({
      apiKey: 'sk-ant-test',
      model: 'claude-opus-4-7',
      systemPrompt: 'sys',
      history: [],
      userMessage: 'go',
      context: makeCtx({ runtime }),
      onStep: (s) => { if (s.type === 'error' && s.detail) errors.push(s.detail); },
    });
    expect(out).toBe('Recovered.');
    expect(errors).toContain('boom');

    // The second SDK call must include the tool_result with is_error: true
    const secondCallArgs = createMock.mock.calls[1]?.[0] as { messages: unknown[] } | undefined;
    expect(secondCallArgs).toBeDefined();
    const msgs = secondCallArgs!.messages;
    const lastMsg = msgs[msgs.length - 1] as {
      content: { type: string; is_error?: boolean }[];
    };
    expect(lastMsg.content.some((c) => c.type === 'tool_result' && c.is_error === true)).toBe(true);
  });

  it('aborts cleanly when the AbortSignal fires before the SDK call', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runAgent({
        apiKey: 'sk-ant-test',
        model: 'claude-opus-4-7',
        systemPrompt: 'sys',
        history: [],
        userMessage: 'x',
        context: makeCtx({ signal: controller.signal }),
        onStep: () => {},
      }),
    ).rejects.toThrow('cancelled');
    expect(createMock).not.toHaveBeenCalled();
  });

  it('blocks destructive tools when confirmDestructive returns false', async () => {
    const runtime = makeRuntime({
      confirmDestructive: vi.fn(async () => false),
      click: vi.fn(async () => ({ matched: 'should-not-run' })),
    });
    createMock
      .mockResolvedValueOnce(
        toolUseResponse([{ id: 'tu_1', name: 'click', input: { target: 'Submit' } }]),
      )
      .mockResolvedValueOnce(textResponse('Stopped.'));

    await runAgent({
      apiKey: 'sk-ant-test',
      model: 'claude-opus-4-7',
      systemPrompt: 'sys',
      history: [],
      userMessage: 'click submit',
      context: makeCtx({ runtime }),
      onStep: () => {},
    });
    expect(runtime.confirmDestructive).toHaveBeenCalledTimes(1);
    expect(runtime.click).not.toHaveBeenCalled();
  });

  it('stops at the MAX_TOOL_CALLS_PER_TASK cap and returns gracefully', async () => {
    // Make the SDK respond with a single tool_use on every call.
    createMock.mockImplementation(async () =>
      toolUseResponse([{ id: `tu_${Math.random()}`, name: 'read_page', input: {} }]),
    );

    const errors: string[] = [];
    const result = await runAgent({
      apiKey: 'sk-ant-test',
      model: 'claude-opus-4-7',
      systemPrompt: 'sys',
      history: [],
      userMessage: 'loop forever',
      context: makeCtx(),
      onStep: (s) => { if (s.type === 'error' && s.detail) errors.push(s.detail); },
    });
    expect(typeof result).toBe('string');
    // Must produce the cap-reached error message and not loop indefinitely.
    expect(errors.some((e) => e.includes(`${MAX_TOOL_CALLS_PER_TASK}`))).toBe(true);
    expect(createMock.mock.calls.length).toBeLessThanOrEqual(MAX_TOOL_CALLS_PER_TASK + 1);
  });

  it('rejects unknown tool names with a tool_error result', async () => {
    createMock
      .mockResolvedValueOnce(
        toolUseResponse([{ id: 'tu_1', name: 'mystery_tool', input: {} }]),
      )
      .mockResolvedValueOnce(textResponse('ok'));
    const errors: string[] = [];
    await runAgent({
      apiKey: 'sk-ant-test',
      model: 'claude-opus-4-7',
      systemPrompt: 'sys',
      history: [],
      userMessage: 'try unknown',
      context: makeCtx(),
      onStep: (s) => { if (s.type === 'error' && s.detail) errors.push(s.detail); },
    });
    expect(errors.some((e) => e.includes('Unknown tool'))).toBe(true);
  });

  it('forwards prior message history into the SDK request', async () => {
    createMock.mockResolvedValueOnce(textResponse('ack'));
    await runAgent({
      apiKey: 'sk-ant-test',
      model: 'claude-opus-4-7',
      systemPrompt: 'sys',
      history: [
        { role: 'user', content: 'previous user message' },
        { role: 'assistant', content: 'previous assistant reply' },
      ],
      userMessage: 'follow-up',
      context: makeCtx(),
      onStep: () => {},
    });
    const args = createMock.mock.calls[0]?.[0] as { messages: { role: string; content: string }[] };
    expect(args.messages.length).toBe(3);
    expect(args.messages[0]?.content).toBe('previous user message');
    expect(args.messages[1]?.content).toBe('previous assistant reply');
    expect(args.messages[2]?.content).toBe('follow-up');
  });
});
