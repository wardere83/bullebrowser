import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentStep, ToolContext } from './types.js';

// Mock the Anthropic SDK so the loop can be driven with scripted responses.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: createMock };
    constructor(_opts: unknown) {}
  },
}));

// Imported after the mock is registered.
const { DEFAULT_MODEL, runAgent } = await import('./agent-loop.js');

function makeRuntime(overrides?: Partial<ToolContext['runtime']>): ToolContext['runtime'] {
  return {
    navigate: vi.fn(async (_id, url) => ({ url, title: 'Example' })),
    readPage: vi.fn(async () => ({
      title: 'Example Title',
      url: 'https://example.com',
      text: 'Example page text. This page explains grants and deadlines.',
    })),
    click: vi.fn(async (_id, target) => ({ matched: target })),
    type: vi.fn(async (_id, target) => ({ matched: target })),
    extract: vi.fn(async () => ({ data: { title: 'Doc' } })),
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
    ...overrides,
  };
}

function makeContext(overrides?: Partial<ToolContext['runtime']>): ToolContext {
  return {
    activeTabId: 't1',
    signal: new AbortController().signal,
    runtime: makeRuntime(overrides),
  };
}

function textBlock(text: string) {
  return { type: 'text', text };
}
function toolUseBlock(id: string, name: string, input: Record<string, unknown>) {
  return { type: 'tool_use', id, name, input };
}

describe('runAgent Claude tool-use loop', () => {
  beforeEach(() => createMock.mockReset());

  it.each([
    [undefined, DEFAULT_MODEL], ['configured-key', DEFAULT_MODEL], ['configured-key', 'gpt-4o'],
  ] as const)('answers product updates without a provider or page read (%s, %s)', async (apiKey, model) => {
    const context = makeContext();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const requestBrowseAccess = vi.fn();
    const steps: AgentStep[] = [];
    try {
      const result = await runAgent({ apiKey, model, systemPrompt: '', history: [],
        userMessage: 'Can you tell me what new updates have been done on this app',
        context, requestBrowseAccess, onStep: (step) => steps.push(step) });
      expect(result).toContain('BulleBrowser Agentic AI');
      expect(result).toContain('support@bullebrowser.com');
      expect(steps).toEqual([{ type: 'text', detail: result }, { type: 'done' }]);
      expect(createMock).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(context.runtime.readPage).not.toHaveBeenCalled();
      expect(requestBrowseAccess).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });

  it('uses the original request rather than app details in attached reference text', async () => {
    const context = makeContext();
    const result = await runAgent({ model: DEFAULT_MODEL, systemPrompt: '', history: [],
      userRequest: 'summarize this page',
      userMessage: 'summarize this page\n\nAttached reference: BulleBrowser technology stack and Claude updates.',
      context, onStep: () => {} });
    expect(result).toContain('grants and deadlines');
    expect(context.runtime.readPage).toHaveBeenCalled();
  });

  it('protects model self-disclosure before streaming, returning or executing proposed tools', async () => {
    createMock.mockResolvedValueOnce({ stop_reason: 'tool_use', content: [
      textBlock("I'm Claude, built by Anthropic."), toolUseBlock('private', 'click', { target: 'submit' }),
    ] });
    const context = makeContext();
    const steps: AgentStep[] = [];
    const result = await runAgent({ apiKey: 'configured-key', model: DEFAULT_MODEL,
      systemPrompt: 'Complete the requested task.', history: [
        { role: 'user', content: 'How was BulleBrowser built?' },
        { role: 'assistant', content: 'BulleBrowser uses Claude and Electron.' },
      ], userMessage: 'greet me', context, onStep: (step) => steps.push(step) });
    expect(result).toContain('support@bullebrowser.com');
    expect(steps.filter((step) => step.type === 'text')).toEqual([{ type: 'text', detail: result }]);
    expect(context.runtime.click).not.toHaveBeenCalled();
    const sent = createMock.mock.calls[0]![0];
    expect(sent.system).toContain('BulleBrowser Agentic AI');
    expect(sent.system).toContain('support@bullebrowser.com');
    expect(sent.messages.find((message: { role: string }) => message.role === 'assistant').content).not.toMatch(/Claude|Electron/);
  });

  it('drives tools then returns the model\'s grounded final answer', async () => {
    createMock
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [textBlock('Let me read the page.'), toolUseBlock('tu1', 'read_page', {})],
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [textBlock('This page explains grants and deadlines.')],
      });

    const steps: AgentStep[] = [];
    const out = await runAgent({
      apiKey: 'test-key',
      model: DEFAULT_MODEL,
      systemPrompt: 'You are the BulleBrowser agent.',
      history: [],
      userMessage: 'summarize this page',
      context: makeContext(),
      onStep: (s) => steps.push(s),
    });

    expect(out).toContain('grants and deadlines');
    const kinds = steps.map((s) => s.type);
    expect(kinds).toContain('tool_call');
    expect(kinds).toContain('tool_result');
    expect(kinds.at(-1)).toBe('done');

    // The critical shape guarantee: tool_result.content must be a string, not a
    // raw object (the Anthropic API rejects arbitrary objects).
    const secondCall = createMock.mock.calls[1]?.[0] as {
      messages: Array<{ role: string; content: unknown }>;
    };
    const toolResultTurn = secondCall.messages.find(
      (m) => m.role === 'user' && Array.isArray(m.content),
    );
    const block = (toolResultTurn?.content as Array<{ type: string; content: unknown }>)?.[0];
    expect(block?.type).toBe('tool_result');
    expect(typeof block?.content).toBe('string');
    expect(block?.content as string).toContain('grants and deadlines');
  });

  it('blocks destructive actions when the user declines confirmation', async () => {
    createMock
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [toolUseBlock('tu1', 'click', { target: 'submit' })],
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [textBlock('Understood, I did not submit anything.')],
      });

    const steps: AgentStep[] = [];
    const confirmDestructive = vi.fn(async () => false);
    const out = await runAgent({
      apiKey: 'test-key',
      model: DEFAULT_MODEL,
      systemPrompt: 'You are the BulleBrowser agent.',
      history: [],
      userMessage: 'click "submit"',
      context: makeContext({ confirmDestructive }),
      onStep: (s) => steps.push(s),
    });

    expect(confirmDestructive).toHaveBeenCalledOnce();
    expect(
      steps.some(
        (s) => s.type === 'error' && (s.data as { code?: string } | undefined)?.code === 'USER_DECLINED',
      ),
    ).toBe(true);
    // The decline is reported back to the model as an error tool_result.
    const secondCall = createMock.mock.calls[1]?.[0] as {
      messages: Array<{ role: string; content: unknown }>;
    };
    const toolResultTurn = secondCall.messages.find(
      (m) => m.role === 'user' && Array.isArray(m.content),
    );
    const block = (toolResultTurn?.content as Array<{ is_error?: boolean; content: unknown }>)?.[0];
    expect(block?.is_error).toBe(true);
    // A typed, sealed error the model can act on without parsing English.
    expect(String(block?.content)).toContain('"code":"USER_DECLINED"');
    expect(String(block?.content)).toContain('<untrusted_page_data');
    expect(out).toContain('did not submit');
  });

  it('continues and accumulates a reply that was cut off at the token limit', async () => {
    createMock
      .mockResolvedValueOnce({
        stop_reason: 'max_tokens',
        content: [textBlock('The capital of France is')],
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [textBlock('Paris.')],
      });

    const out = await runAgent({
      apiKey: 'test-key',
      model: DEFAULT_MODEL,
      systemPrompt: 'You are the BulleBrowser agent.',
      history: [],
      userMessage: 'what is the capital of France?',
      context: makeContext(),
      onStep: () => {},
    });

    expect(out).toBe('The capital of France is Paris.');
    expect(createMock).toHaveBeenCalledTimes(2);
    // The second request must carry a "continue" nudge as a user turn.
    const secondCall = createMock.mock.calls[1]?.[0] as {
      messages: Array<{ role: string; content: unknown }>;
    };
    const continued = secondCall.messages.some(
      (m) => m.role === 'user' && typeof m.content === 'string' && /cut off/i.test(m.content),
    );
    expect(continued).toBe(true);
  });

  // Browsing consent: the agent must not touch the live web until the user has
  // said yes, and must not nag them once per page.
  describe('browsing consent gate', () => {
    it('asks once per run, no matter how many pages it visits', async () => {
      createMock
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          content: [toolUseBlock('tu1', 'navigate', { url: 'https://a.com' })],
        })
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          content: [toolUseBlock('tu2', 'read_page', {})],
        })
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          content: [toolUseBlock('tu3', 'navigate', { url: 'https://b.com' })],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          content: [textBlock('Compared both pages.')],
        });

      const requestBrowseAccess = vi.fn(async () => true);
      const context = makeContext();
      const out = await runAgent({
        apiKey: 'test-key',
        model: DEFAULT_MODEL,
        systemPrompt: 'You are the BulleBrowser agent.',
        history: [],
        userMessage: 'compare a.com and b.com',
        context,
        requestBrowseAccess,
        onStep: () => {},
      });

      expect(requestBrowseAccess).toHaveBeenCalledOnce();
      expect(context.runtime.navigate).toHaveBeenCalledTimes(2);
      expect(out).toContain('Compared both pages');
    });

    it('does not touch the browser when the user denies access', async () => {
      createMock
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          content: [toolUseBlock('tu1', 'navigate', { url: 'https://a.com' })],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          content: [textBlock('I could not check the live page.')],
        });

      const requestBrowseAccess = vi.fn(async () => false);
      const context = makeContext();
      const steps: AgentStep[] = [];
      const out = await runAgent({
        apiKey: 'test-key',
        model: DEFAULT_MODEL,
        systemPrompt: 'You are the BulleBrowser agent.',
        history: [],
        userMessage: 'open a.com',
        context,
        requestBrowseAccess,
        onStep: (s) => steps.push(s),
      });

      expect(context.runtime.navigate).not.toHaveBeenCalled();
      expect(
        steps.some((s) => s.type === 'error' && /declined browser access/i.test(s.detail ?? '')),
      ).toBe(true);
      expect(out).toContain('could not check the live page');
    });

    it('answers non-browsing questions without ever asking for access', async () => {
      createMock.mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [textBlock('2 + 2 is 4.')],
      });

      const requestBrowseAccess = vi.fn(async () => true);
      const out = await runAgent({
        apiKey: 'test-key',
        model: DEFAULT_MODEL,
        systemPrompt: 'You are the BulleBrowser agent.',
        history: [],
        userMessage: 'what is 2 + 2?',
        context: makeContext(),
        requestBrowseAccess,
        onStep: () => {},
      });

      expect(requestBrowseAccess).not.toHaveBeenCalled();
      expect(out).toContain('4');
    });

    it('browses without asking when no consent hook is wired (headless callers)', async () => {
      createMock
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          content: [toolUseBlock('tu1', 'navigate', { url: 'https://a.com' })],
        })
        .mockResolvedValueOnce({ stop_reason: 'end_turn', content: [textBlock('Done.')] });

      const context = makeContext();
      await runAgent({
        apiKey: 'test-key',
        model: DEFAULT_MODEL,
        systemPrompt: 'You are the BulleBrowser agent.',
        history: [],
        userMessage: 'open a.com',
        context,
        onStep: () => {},
      });

      expect(context.runtime.navigate).toHaveBeenCalledOnce();
    });
  });

  // API-first: the agent operates a CRM through host-supplied API tools, not
  // just the browser.
  describe('host-supplied API tools', () => {
    it('offers the tool to the model and runs it, without touching the browser gate', async () => {
      createMock
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          content: [toolUseBlock('tu1', 'crm_find_contact', { name: 'Ava Chen' })],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          content: [textBlock('Found Ava Chen at Lumen Analytics.')],
        });

      const execute = vi.fn(async () => ({ id: 42, name: 'Ava Chen', company: 'Lumen Analytics' }));
      const requestBrowseAccess = vi.fn(async () => true);
      const out = await runAgent({
        apiKey: 'test-key',
        model: DEFAULT_MODEL,
        systemPrompt: 'You are the CRM assistant.',
        history: [],
        userMessage: 'find Ava Chen',
        context: makeContext(),
        requestBrowseAccess,
        extraTools: [
          {
            name: 'crm_find_contact',
            description: 'Find a contact by name via the CRM API.',
            inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
            execute,
          },
        ],
        onStep: () => {},
      });

      expect(execute).toHaveBeenCalledWith({ name: 'Ava Chen' });
      // An API tool is not a browser action, so it must not trigger the
      // browse-consent prompt.
      expect(requestBrowseAccess).not.toHaveBeenCalled();
      expect(out).toContain('Ava Chen');

      // The tool was advertised to the model.
      const firstCall = createMock.mock.calls[0]?.[0] as { tools: Array<{ name: string }> };
      expect(firstCall.tools.some((t) => t.name === 'crm_find_contact')).toBe(true);
    });

    it('confirms before a data-writing API tool, and skips it when declined', async () => {
      createMock
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          content: [toolUseBlock('tu1', 'crm_create_task', { title: 'Follow up' })],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          content: [textBlock('I did not create the task.')],
        });

      const execute = vi.fn(async () => ({ created: true }));
      const confirmDestructive = vi.fn(async () => false);
      const out = await runAgent({
        apiKey: 'test-key',
        model: DEFAULT_MODEL,
        systemPrompt: 'You are the CRM assistant.',
        history: [],
        userMessage: 'create a task',
        context: makeContext({ confirmDestructive }),
        extraTools: [
          {
            name: 'crm_create_task',
            description: 'Create a task via the CRM API.',
            inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
            execute,
            destructive: true,
          },
        ],
        onStep: () => {},
      });

      expect(confirmDestructive).toHaveBeenCalledOnce();
      expect(execute).not.toHaveBeenCalled();
      expect(out).toContain('did not create');
    });
  });

  it.each([DEFAULT_MODEL, 'gpt-4o'] as const)('runs local summaries without credentials for %s', async (model) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      const result = await runAgent({ model, systemPrompt: '', history: [], userMessage: 'summarize this page', context: makeContext(), onStep: () => {} });
      expect(result).toContain('grants and deadlines');
      expect(result).toContain('https://example.com');
      expect(createMock).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });

  it('performs keyless navigation only after browser approval', async () => {
    const context = makeContext();
    const requestBrowseAccess = vi.fn(async () => true);
    const result = await runAgent({ model: DEFAULT_MODEL, systemPrompt: '', history: [], userMessage: 'open example.com', context, requestBrowseAccess, onStep: () => {} });
    expect(result).toContain('https://example.com/');
    expect(context.runtime.navigate).toHaveBeenCalledWith('t1', 'https://example.com/');
    expect(requestBrowseAccess).toHaveBeenCalledTimes(1);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('does not navigate when keyless browser access is declined', async () => {
    const context = makeContext();
    await expect(runAgent({ model: DEFAULT_MODEL, systemPrompt: '', history: [], userMessage: 'open example.com', context, requestBrowseAccess: async () => false, onStep: () => {} })).rejects.toThrow(/declined/);
    expect(context.runtime.navigate).not.toHaveBeenCalled();
  });

  it('keeps destructive action confirmation in local mode', async () => {
    const context = makeContext({ confirmDestructive: vi.fn(async () => false) });
    await expect(runAgent({ model: DEFAULT_MODEL, systemPrompt: '', history: [], userMessage: 'click "submit"', context, onStep: () => {} })).rejects.toThrow(/declined/);
    expect(context.runtime.click).not.toHaveBeenCalled();
  });

  it('types only the requested text into the explicit target', async () => {
    const context = makeContext();
    await runAgent({ model: DEFAULT_MODEL, systemPrompt: '', history: [], userMessage: 'type "hello" into "search"', context, onStep: () => {} });
    expect(context.runtime.type).toHaveBeenCalledWith('t1', 'search', 'hello');
  });

  it('offers truthful local capabilities for unsupported prompts', async () => {
    const context = makeContext();
    const result = await runAgent({ model: DEFAULT_MODEL, systemPrompt: '', history: [], userMessage: 'write a novel', context, onStep: () => {} });
    expect(result).toContain('BulleBrowser Agentic AI is ready');
    expect(context.runtime.readPage).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('does not claim a local action completed when the runtime failed', async () => {
    const context = makeContext({ navigate: vi.fn(async () => { throw new Error('page unavailable'); }) });
    await expect(runAgent({ model: DEFAULT_MODEL, systemPrompt: '', history: [], userMessage: 'open example.com', context, onStep: () => {} })).rejects.toThrow(/page unavailable/);
  });

  it.each(['list tabs', 'page details', 'extract page data'])('restores the local command %s', async (userMessage) => {
    const result = await runAgent({ model: DEFAULT_MODEL, systemPrompt: '', history: [], userMessage, context: makeContext(), onStep: () => {} });
    expect(result).not.toContain('BulleBrowser Agentic AI is ready');
    expect(createMock).not.toHaveBeenCalled();
  });

  it('stops local work after cancellation while reading a page', async () => {
    const controller = new AbortController();
    const context = makeContext({ readPage: vi.fn(async () => {
      controller.abort();
      return { title: 'Page', url: 'https://example.com', text: 'A page that was cancelled during capture.' };
    }) });
    context.signal = controller.signal;
    const steps: AgentStep[] = [];
    await expect(runAgent({ model: DEFAULT_MODEL, systemPrompt: '', history: [], userMessage: 'summarize this page', context, onStep: (step) => steps.push(step) })).rejects.toThrow(/cancelled/);
    expect(steps.map((step) => step.type)).not.toContain('done');
  });

  it('enforces the local step budget', async () => {
    const context = makeContext();
    await expect(runAgent({ model: DEFAULT_MODEL, systemPrompt: '', history: [], userMessage: 'open example.com', budget: 1, context, onStep: () => {} })).rejects.toThrow(/budget/);
    expect(context.runtime.navigate).not.toHaveBeenCalled();
  });
});
