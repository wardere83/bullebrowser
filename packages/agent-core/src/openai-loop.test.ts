import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { parseToolArguments, toOpenAiTools } from './openai-loop.js';
import type { AgentStep, ToolContext } from './types.js';
import { runAgent } from './agent-loop.js';

function makeContext(): ToolContext {
  return {
    activeTabId: 't1',
    signal: new AbortController().signal,
    runtime: {
      navigate: vi.fn(async (_id, url) => ({ url, title: 'Example' })),
      readPage: vi.fn(async () => ({
        title: 'Example Title',
        url: 'https://example.com',
        text: 'Example page text about grants.',
      })),
      click: vi.fn(async (_id, target) => ({ matched: target })),
      type: vi.fn(async (_id, target) => ({ matched: target })),
      extract: vi.fn(async () => ({ data: {} })),
      screenshot: vi.fn(async () => ({ pngBase64: 'iVBORw0KGgo=' })),
      newTab: vi.fn(async () => ({ id: 't2', title: '', url: '', active: true })),
      switchTab: vi.fn(async (id) => ({ id, title: '', url: '', active: true })),
      listTabs: vi.fn(async () => [{ id: 't1', title: 'A', url: 'https://a', active: true }]),
      closeTab: vi.fn(async () => ({ closed: true })),
      goBack: vi.fn(async () => ({ url: '' })),
      goForward: vi.fn(async () => ({ url: '' })),
      reload: vi.fn(async () => ({ url: '' })),
      scroll: vi.fn(async () => ({ scrolledTo: 0 })),
      pressKey: vi.fn(async (_id, key) => ({ pressed: key })),
      waitFor: vi.fn(async () => ({ matched: true })),
      confirmDestructive: vi.fn(async () => true),
    },
  };
}

function reply(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function assistantToolCall(id: string, name: string, args: unknown) {
  return {
    choices: [
      {
        finish_reason: 'tool_calls',
        message: {
          content: null,
          tool_calls: [
            { id, type: 'function', function: { name, arguments: JSON.stringify(args) } },
          ],
        },
      },
    ],
  };
}

function assistantText(text: string) {
  return { choices: [{ finish_reason: 'stop', message: { content: text } }] };
}

describe('openai wire helpers', () => {
  it('maps tool defs into OpenAI function tools', () => {
    const out = toOpenAiTools([
      { name: 'navigate', description: 'Go somewhere', input_schema: { type: 'object' } },
    ]);
    expect(out[0]).toEqual({
      type: 'function',
      function: { name: 'navigate', description: 'Go somewhere', parameters: { type: 'object' } },
    });
  });

  it('parses JSON string arguments, and reports bad JSON without throwing', () => {
    expect(
      parseToolArguments({
        id: '1',
        type: 'function',
        function: { name: 'navigate', arguments: '{"url":"https://a.com"}' },
      }).input,
    ).toEqual({ url: 'https://a.com' });

    // A model can emit malformed JSON; that must fail the call, not the run.
    const bad = parseToolArguments({
      id: '2',
      type: 'function',
      function: { name: 'navigate', arguments: '{"url":' },
    });
    expect(bad.error).toMatch(/not valid JSON/);

    // Empty arguments are legitimate for zero-arg tools.
    expect(
      parseToolArguments({ id: '3', type: 'function', function: { name: 'read_page', arguments: '' } })
        .input,
    ).toEqual({});
  });
});

describe('runAgent with ChatGPT', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('protects unexpected self-identification before emitting the provider reply', async () => {
    fetchMock.mockResolvedValueOnce(reply(assistantText('I am ChatGPT, built by OpenAI.')));
    const steps: AgentStep[] = [];
    const result = await runAgent({ apiKey: 'sk-test', model: 'gpt-4o', systemPrompt: '',
      history: [], userMessage: 'greet me', context: makeContext(), onStep: (step) => steps.push(step) });
    expect(result).toContain('BulleBrowser Agentic AI');
    expect(result).toContain('support@bullebrowser.com');
    expect(steps.filter((step) => step.type === 'text')).toEqual([{ type: 'text', detail: result }]);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.messages[0].content).toContain('BulleBrowser Agentic AI');
    expect(body.messages[0].content).toContain('support@bullebrowser.com');
  });

  it('drives the browser tools and returns a grounded answer', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(assistantToolCall('c1', 'navigate', { url: 'https://example.com' })))
      .mockResolvedValueOnce(reply(assistantToolCall('c2', 'read_page', {})))
      .mockResolvedValueOnce(reply(assistantText('The page is about grants.')));

    const context = makeContext();
    const out = await runAgent({
      apiKey: 'sk-test',
      model: 'gpt-4o',
      systemPrompt: 'You are the BulleBrowser agent.',
      history: [],
      userMessage: 'open example.com and summarize',
      context,
      onStep: () => {},
    });

    expect(context.runtime.navigate).toHaveBeenCalledWith('t1', 'https://example.com/');
    expect(context.runtime.readPage).toHaveBeenCalled();
    expect(out).toContain('grants');

    // Every tool_call must be answered by a matching 'tool' message, or the
    // next request 400s.
    const lastBody = JSON.parse(fetchMock.mock.calls.at(-1)?.[1].body as string) as {
      messages: Array<{ role: string; tool_call_id?: string }>;
    };
    const toolReplies = lastBody.messages.filter((m) => m.role === 'tool');
    expect(toolReplies.map((m) => m.tool_call_id)).toEqual(['c1', 'c2']);
  });

  it('asks for browsing consent exactly once, and honors a refusal', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(assistantToolCall('c1', 'navigate', { url: 'https://example.com' })))
      .mockResolvedValueOnce(reply(assistantText('I could not check the live page.')));

    const gate = vi.fn(async () => false);
    const context = makeContext();
    const steps: AgentStep[] = [];
    await runAgent({
      apiKey: 'sk-test',
      model: 'gpt-4o',
      systemPrompt: 'x',
      history: [],
      userMessage: 'open example.com',
      context,
      requestBrowseAccess: gate,
      onStep: (s) => steps.push(s),
    });

    expect(gate).toHaveBeenCalledOnce();
    expect(context.runtime.navigate).not.toHaveBeenCalled();
    expect(steps.some((s) => s.type === 'error' && /declined browser access/i.test(s.detail ?? ''))).toBe(
      true,
    );
  });

  it('refuses a file:// URL through the same policy as Claude', async () => {
    fetchMock
      .mockResolvedValueOnce(
        reply(assistantToolCall('c1', 'navigate', { url: 'file:///etc/passwd' })),
      )
      .mockResolvedValueOnce(reply(assistantText('I cannot open local files.')));

    const context = makeContext();
    await runAgent({
      apiKey: 'sk-test',
      model: 'gpt-4o',
      systemPrompt: 'x',
      history: [],
      userMessage: 'read /etc/passwd',
      context,
      onStep: () => {},
    });
    expect(context.runtime.navigate).not.toHaveBeenCalled();
  });

  it('surfaces the API error message rather than a bare status', async () => {
    fetchMock.mockResolvedValueOnce(
      reply({ error: { message: 'Incorrect API key provided.' } }, false, 401),
    );
    await expect(
      runAgent({
        apiKey: 'sk-bad',
        model: 'gpt-4o',
        systemPrompt: 'x',
        history: [],
        userMessage: 'hi',
        context: makeContext(),
        onStep: () => {},
      }),
    ).rejects.toThrow(/Incorrect API key provided/);
  });
});
