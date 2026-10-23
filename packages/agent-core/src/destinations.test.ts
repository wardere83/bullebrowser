import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertAllowedDestination, BLOCKED_DESTINATION_MESSAGE, isBlockedDestination } from './destinations.js';
import { executeToolCall, runAgent } from './agent-loop.js';
import { PrivacyPolicyEngine } from './policy.js';
import { SessionMemoryStore } from './memory.js';
import { retrieveContext } from './retrieval.js';
import { tools } from './tools/index.js';
import { webSearchTool } from './search.js';
import { createDomToolRuntime } from './dom-runtime.js';
import type { AgentStep, ToolContext, ToolRuntime } from './types.js';

describe('prohibited destination matching', () => {
  it.each([
    'https://duckduckgo.com/?q=private', 'http://www.duckduckgo.com/',
    'https://html.duckduckgo.com/html/', 'https://lite.duckduckgo.com/lite/',
    'HTTPS://DUCKDUCKGO.COM./', 'https://duckduckgo.com...:443/',
    'https://%64uckduckgo.com/', 'https://duckduckgo%2Ecom/',
    'https://duckduckgo。com/', 'https://duckduckgo.com\t/',
    'https://example.org@duckduckgo.com/', '//duckduckgo.com/path',
    'duckduckgo.com', 'duckduckgo.com:443/path', 'duckduckgo.com.:443/path',
    'https://duck.com/', 'https://www.duck.com/', 'https://ddg.gg/',
    'https://go.ddg.gg/', 'wss://duckduckgo.com/socket',
    'blob:https://duckduckgo.com/id', 'filesystem:https://duckduckgo.com/temporary/a',
  ])('blocks canonical hostname variants: %s', (url) => {
    expect(isBlockedDestination(url)).toBe(true);
    expect(() => assertAllowedDestination(url)).toThrow(BLOCKED_DESTINATION_MESSAGE);
  });

  it.each([
    'https://api.search.brave.com/res/v1/web/search', 'https://www.grants.gov/',
    'https://notduckduckgo.com/', 'https://duckduckgo.com.example.org/',
    'https://duckduckgo.com@example.org/', 'https://example.org/duckduckgo.com',
    'https://example.org/?next=https://duckduckgo.com/', 'about:blank', '', 'not a URL',
  ])('does not reject unrelated destinations: %s', (url) => {
    expect(isBlockedDestination(url)).toBe(false);
    expect(() => assertAllowedDestination(url)).not.toThrow();
  });

  it('accepts parsed URLs and never echoes queries or credentials in its error', () => {
    expect(isBlockedDestination(new URL('https://duckduckgo.com/'))).toBe(true);
    try { assertAllowedDestination('https://secret:password@duckduckgo.com/?q=confidential'); }
    catch (error) {
      expect(error).toMatchObject({ code: 'BLOCKED_BY_POLICY', retryable: false, message: BLOCKED_DESTINATION_MESSAGE });
      expect(String(error)).not.toMatch(/confidential|password|secret/);
    }
  });

  it('enforces the same restriction in policy-only callers', () => {
    const policy = new PrivacyPolicyEngine();
    expect(policy.evaluateToolStep({ id: '1', toolName: 'navigate', input: { url: 'https://duckduckgo.com/' }, expected: '' }))
      .toEqual({ allowed: false, requiresConfirmation: false, reason: BLOCKED_DESTINATION_MESSAGE });
    expect(policy.allowExternalProvider({ url: 'https://duck.com/', text: 'Page' }).allowed).toBe(false);
  });
});

function context(url = 'https://agency.gov/'): ToolContext {
  const runtime: ToolRuntime = {
    navigate: vi.fn(async (_id, target) => ({ url: target, title: 'Source' })),
    readPage: vi.fn(async () => ({ url, title: 'Source', text: 'Source text' })),
    click: vi.fn(async () => ({ matched: 'link' })), type: vi.fn(async () => ({ matched: 'input' })),
    extract: vi.fn(async () => ({ data: {} })), screenshot: vi.fn(async () => ({ pngBase64: 'png' })),
    newTab: vi.fn(async (target) => ({ id: '2', title: 'Source', url: target ?? '', active: true })),
    switchTab: vi.fn(async (id) => ({ id, title: 'Source', url, active: true })),
    listTabs: vi.fn(async () => [{ id: '1', title: 'Source', url, active: true }]),
    closeTab: vi.fn(async () => ({ closed: true })), goBack: vi.fn(async () => ({ url })),
    goForward: vi.fn(async () => ({ url })), reload: vi.fn(async () => ({ url })),
    scroll: vi.fn(async () => ({ scrolledTo: 0 })), pressKey: vi.fn(async (_id, key) => ({ pressed: key })),
    waitFor: vi.fn(async () => ({ matched: true })), confirmDestructive: vi.fn(async () => true),
    listLinks: vi.fn(async () => []), getSelection: vi.fn(async () => ({ text: '' })),
    queryDom: vi.fn(async () => ({ matches: 0 })), findElements: vi.fn(async () => ({ elements: [] })),
    selectOption: vi.fn(async () => ({ matched: 'select' })),
    inspectTarget: vi.fn(async () => ({ label: 'Link', submitsForm: false })),
  };
  return { activeTabId: '1', signal: new AbortController().signal, runtime, beforeBrowserAction: vi.fn(async () => {}) };
}

async function execute(name: string, input: unknown, ctx: ToolContext) {
  const steps: AgentStep[] = [];
  const gate = { allowed: vi.fn(async () => true) };
  const outcome = await executeToolCall('blocked-test', name, input, ctx, new PrivacyPolicyEngine(), (step) => steps.push(step), gate);
  return { outcome, steps, gate };
}

describe('agent destination enforcement', () => {
  it.each(['navigate', 'new_tab'])('rejects %s before progress, consent or runtime side effects', async (name) => {
    const ctx = context();
    const { outcome, steps, gate } = await execute(name, { url: 'https://html.duckduckgo.com/?q=private' }, ctx);
    expect(outcome).toMatchObject({ isError: true, errorCode: 'BLOCKED_BY_POLICY' });
    expect(steps.map((step) => step.type)).toEqual(['error']);
    expect(ctx.runtime.navigate).not.toHaveBeenCalled();
    expect(ctx.runtime.newTab).not.toHaveBeenCalled();
    expect(ctx.beforeBrowserAction).not.toHaveBeenCalled();
    expect(gate.allowed).not.toHaveBeenCalled();
  });

  it.each([
    ['read_page', {}], ['getPageText', {}], ['getPageMetadata', {}], ['getSelection', {}],
    ['listLinks', {}], ['extract', { schema: {} }], ['queryDom', { selector: 'a' }],
    ['screenshot', {}], ['click', { target: 'Search' }], ['clickElement', { target: 'Search' }],
    ['type', { target: 'Search', text: 'private' }], ['typeIntoField', { target: 'Search', text: 'private' }],
    ['press_key', { key: 'Enter' }], ['scroll', { direction: 'down' }], ['reload', {}],
    ['find_elements', {}], ['wait_for', { networkIdle: true }], ['switch_tab', { tabId: '1' }],
  ])('rejects %s on a stale blocked page before touching it', async (name, input) => {
    const ctx = context('https://duckduckgo.com/?q=old-search');
    const { outcome } = await execute(String(name), input, ctx);
    expect(outcome).toMatchObject({ isError: true, errorCode: 'BLOCKED_BY_POLICY' });
    for (const [method, fn] of Object.entries(ctx.runtime)) {
      if (method !== 'listTabs') expect(fn, method).not.toHaveBeenCalled();
    }
    expect(ctx.beforeBrowserAction).not.toHaveBeenCalled();
  });

  it('checks the requested tab instead of only the active one', async () => {
    const ctx = context();
    vi.mocked(ctx.runtime.listTabs).mockResolvedValue([
      { id: '1', title: 'Safe', url: 'https://agency.gov/', active: true },
      { id: '2', title: 'Old search', url: 'https://duck.com/', active: false },
    ]);
    expect((await execute('read_page', { tabId: '2' }, ctx)).outcome.errorCode).toBe('BLOCKED_BY_POLICY');
    expect(ctx.runtime.readPage).not.toHaveBeenCalled();
  });

  it('allows leaving a blocked tab for an allowed source and closing it', async () => {
    const ctx = context('https://duckduckgo.com/');
    expect((await execute('navigate', { url: 'https://agency.gov/' }, ctx)).outcome.isError).toBe(false);
    expect(ctx.runtime.navigate).toHaveBeenCalledOnce();
    expect((await execute('close_tab', { tabId: '1' }, ctx)).outcome.isError).toBe(false);
  });

  it('guards direct registry callers and suppresses a blocked redirect result', async () => {
    const ctx = context();
    await expect(tools.navigate.execute({ url: 'https://ddg.gg/' }, ctx)).rejects.toThrow(BLOCKED_DESTINATION_MESSAGE);
    expect(ctx.runtime.navigate).not.toHaveBeenCalled();
    vi.mocked(ctx.runtime.readPage).mockResolvedValue({ title: 'Blocked', url: 'https://duckduckgo.com/', text: 'Must not reach model' });
    const { outcome, steps } = await execute('read_page', {}, ctx);
    expect(outcome.errorCode).toBe('BLOCKED_BY_POLICY');
    expect(outcome.text).not.toContain('Must not reach model');
    expect(steps.some((step) => step.type === 'tool_result')).toBe(false);
  });

  it('does not perceive an already-open blocked page when a run starts', async () => {
    const ctx = context('https://duckduckgo.com/');
    const result = await retrieveContext(ctx, new SessionMemoryStore());
    expect(result).toEqual({ memory: {}, unreadableReason: BLOCKED_DESTINATION_MESSAGE });
    expect(ctx.runtime.readPage).not.toHaveBeenCalled();
  });

  it('filters blocked discovery links and stale tab metadata', async () => {
    const ctx = context();
    vi.mocked(ctx.runtime.listLinks!).mockResolvedValue([
      { text: 'Blocked', href: 'https://duckduckgo.com/l/?uddg=https%3A%2F%2Fagency.gov' },
      { text: 'Allowed', href: 'https://agency.gov/' },
    ]);
    expect(await tools.listLinks.execute({}, ctx)).toEqual({ links: [{ text: 'Allowed', href: 'https://agency.gov/' }] });
    const blocked = context('https://duckduckgo.com/');
    expect(await tools.list_tabs.execute({}, blocked)).toEqual({ tabs: [] });
  });
});

describe('Brave-only discovery failures', () => {
  it.each(['missing key', 'provider failure'])('never substitutes browser search after %s', async (mode) => {
    const ctx = context();
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 503 }));
    await expect(runAgent({
      model: 'claude-sonnet-4-6', systemPrompt: '', history: [], userMessage: 'Find grants for schools',
      researchMode: true, context: ctx, onStep: () => {},
      extraTools: [webSearchTool({ ...(mode === 'provider failure' ? { apiKey: 'test' } : {}), fetch: request })],
    })).rejects.toThrow(mode === 'provider failure' ? 'HTTP 503' : 'BRAVE_SEARCH_API_KEY');
    expect(ctx.runtime.navigate).not.toHaveBeenCalled();
    expect(ctx.runtime.newTab).not.toHaveBeenCalled();
    expect(ctx.runtime.readPage).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(mode === 'provider failure' ? 1 : 0);
  });

  it('discards prohibited Brave results before source selection', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ web: { results: [
      { title: 'Blocked', url: 'https://duckduckgo.com/' }, { url: 'https://html.duckduckgo.com/' },
      { url: 'https://duck.com/' }, { url: 'https://ddg.gg/' },
      { title: 'Official', url: 'https://agency.gov/', description: 'Official program' },
    ] } })));
    const output = await webSearchTool({ apiKey: 'test', fetch: request }).execute({ query: 'grants' });
    expect(output).toMatchObject({ results: [{ title: 'Official', url: 'https://agency.gov/' }] });
  });
});

describe('embedded runtime destination restriction', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('rejects page reads before examining a prohibited document', async () => {
    vi.stubGlobal('location', { href: 'https://duckduckgo.com/' });
    const querySelector = vi.fn();
    vi.stubGlobal('document', { querySelector });
    await expect(createDomToolRuntime().readPage('page')).rejects.toThrow(BLOCKED_DESTINATION_MESSAGE);
    expect(querySelector).not.toHaveBeenCalled();
  });

  it('rejects direct navigation without assigning location', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { href: 'https://agency.gov/', origin: 'https://agency.gov', assign });
    await expect(createDomToolRuntime().navigate('page', 'https://duck.com/')).rejects.toThrow(BLOCKED_DESTINATION_MESSAGE);
    expect(assign).not.toHaveBeenCalled();
  });

  it('rejects a blocked link before scrolling, cursor presentation or clicking', async () => {
    vi.stubGlobal('location', { href: 'https://agency.gov/' });
    const link = { href: 'https://duckduckgo.com/', closest: vi.fn(), scrollIntoView: vi.fn(), click: vi.fn() };
    link.closest.mockReturnValue(link);
    vi.stubGlobal('document', { querySelectorAll: (selector: string) => selector === '*' ? [] : [link] });
    const showCursor = vi.fn();
    await expect(createDomToolRuntime({ showCursor }).click('page', 'a')).rejects.toThrow(BLOCKED_DESTINATION_MESSAGE);
    expect(link.scrollIntoView).not.toHaveBeenCalled();
    expect(link.click).not.toHaveBeenCalled();
    expect(showCursor).not.toHaveBeenCalled();
  });
});
