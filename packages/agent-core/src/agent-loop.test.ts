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

  it('surfaces a real error (does not fake an answer) when no key is set', async () => {
    await expect(
      runAgent({
        model: DEFAULT_MODEL,
        systemPrompt: 'x',
        history: [],
        userMessage: 'hello',
        context: makeContext(),
        onStep: () => {},
      }),
    ).rejects.toThrow(/BulleBrowser Pro needs its key/);
    expect(createMock).not.toHaveBeenCalled();
  });

  // Client-facing copy is white-labelled: it names the assistant and the key
  // prefix, never the vendor behind it.
  it('names the assistant whose key is missing, not the vendor', async () => {
    await expect(
      runAgent({
        model: 'gpt-4o',
        systemPrompt: 'x',
        history: [],
        userMessage: 'hello',
        context: makeContext(),
        onStep: () => {},
      }),
    // The selectable OpenAI assistant has its own white-labelled name. The
    // key error must still avoid exposing its underlying provider.
    ).rejects.toThrow(/BulleBrowser Open needs its key/);

    await expect(
      runAgent({
        model: 'gpt-4o',
        systemPrompt: 'x',
        history: [],
        userMessage: 'hello',
        context: makeContext(),
        onStep: () => {},
      }),
    ).rejects.not.toThrow(/OpenAI|ChatGPT|Anthropic|Claude/);
  });
});
