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

  it.each([
    ['click', { target: 'Submit' }], ['clickElement', { target: 'Submit' }],
    ['type', { target: 'Search', text: 'private' }], ['typeIntoField', { target: 'Search', text: 'private' }],
    ['press_key', { key: 'Enter' }], ['screenshot', {}], ['extract', { schema: {} }],
    ['find_elements', {}], ['scroll', { direction: 'down' }], ['reload', {}],
  ])('ignores a forged tabId when %s acts on the active tab', async (name, args) => {
    const ctx = context('https://duckduckgo.com/');
    vi.mocked(ctx.runtime.listTabs).mockResolvedValue([
      { id: '1', title: 'Blocked', url: 'https://duckduckgo.com/', active: true },
      { id: 'allowed', title: 'Allowed', url: 'https://agency.gov/', active: false },
    ]);
    const { outcome, steps } = await execute(String(name), { ...args, tabId: 'allowed' }, ctx);
    expect(outcome.errorCode).toBe('BLOCKED_BY_POLICY');
    expect(steps.map((step) => step.type)).toEqual(['error']);
    expect(ctx.runtime.inspectTarget).not.toHaveBeenCalled();
    expect(ctx.beforeBrowserAction).not.toHaveBeenCalled();
    for (const [method, fn] of Object.entries(ctx.runtime)) {
      if (method !== 'listTabs') expect(fn, method).not.toHaveBeenCalled();
    }
  });

  it('also rejects a forged tabId through a direct registry call', async () => {
    const ctx = context('https://duckduckgo.com/');
    vi.mocked(ctx.runtime.listTabs).mockResolvedValue([
      { id: '1', title: 'Blocked', url: 'https://duckduckgo.com/', active: true },
      { id: 'allowed', title: 'Allowed', url: 'https://agency.gov/', active: false },
    ]);
    const input = { target: 'Submit', tabId: 'allowed' };
    await expect(tools.click.execute(input, ctx)).rejects.toThrow(BLOCKED_DESTINATION_MESSAGE);
    expect(ctx.runtime.click).not.toHaveBeenCalled();
  });

  it('still lets a tab-aware read inspect an allowed nonactive tab', async () => {
    const ctx = context('https://duckduckgo.com/');
    vi.mocked(ctx.runtime.listTabs).mockResolvedValue([
      { id: '1', title: 'Blocked', url: 'https://duckduckgo.com/', active: true },
      { id: 'allowed', title: 'Allowed', url: 'https://agency.gov/', active: false },
    ]);
    vi.mocked(ctx.runtime.readPage).mockResolvedValue({ title: 'Source', url: 'https://agency.gov/', text: 'Source text' });
    expect((await execute('read_page', { tabId: 'allowed' }, ctx)).outcome.isError).toBe(false);
    expect(ctx.runtime.readPage).toHaveBeenCalledWith('allowed');
  });

  it('checks the actual active metadata for getActiveTab', async () => {
    const ctx = context();
    vi.mocked(ctx.runtime.listTabs).mockResolvedValue([
      { id: '1', title: 'Allowed', url: 'https://agency.gov/', active: false },
      { id: '2', title: 'Blocked', url: 'https://duckduckgo.com/', active: true },
    ]);
    expect((await execute('getActiveTab', {}, ctx)).outcome.errorCode).toBe('BLOCKED_BY_POLICY');
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

  it.each(['click', 'press_key'])('does not report success when %s navigates but returns no final URL', async (name) => {
    const ctx = context();
    let url = 'https://agency.gov/';
    vi.mocked(ctx.runtime.listTabs).mockImplementation(async () => [{ id: '1', title: 'Page', url, active: true }]);
    vi.mocked(ctx.runtime.click).mockImplementation(async () => {
      url = 'https://duckduckgo.com/';
      return { matched: 'Link', url: 'https://agency.gov/' };
    });
    vi.mocked(ctx.runtime.pressKey).mockImplementation(async () => {
      url = 'https://duckduckgo.com/';
      return { pressed: 'Enter' };
    });
    const { outcome, steps } = await execute(name, name === 'click' ? { target: 'Link' } : { key: 'Enter' }, ctx);
    expect(outcome).toMatchObject({ isError: true, errorCode: 'BLOCKED_BY_POLICY' });
    expect(steps.some((step) => step.type === 'tool_result')).toBe(false);
  });

  it('rechecks the original target after an action changes the active tab', async () => {
    const ctx = context();
    let originalUrl = 'https://agency.gov/';
    vi.mocked(ctx.runtime.listTabs).mockImplementation(async () => [
      { id: '1', title: 'Original', url: originalUrl, active: ctx.activeTabId === '1' },
      { id: '2', title: 'Other', url: 'https://other.gov/', active: ctx.activeTabId === '2' },
    ]);
    vi.mocked(ctx.runtime.click).mockImplementation(async () => {
      originalUrl = 'https://duckduckgo.com/';
      ctx.activeTabId = '2';
      return { matched: 'Link' };
    });
    expect((await execute('click', { target: 'Link' }, ctx)).outcome.errorCode).toBe('BLOCKED_BY_POLICY');
  });

  it('checks the requested nonactive tab after a read, even if its result URL is stale', async () => {
    const ctx = context();
    let targetUrl = 'https://other.gov/';
    vi.mocked(ctx.runtime.listTabs).mockImplementation(async () => [
      { id: '1', title: 'Current', url: 'https://agency.gov/', active: true },
      { id: '2', title: 'Target', url: targetUrl, active: false },
    ]);
    vi.mocked(ctx.runtime.readPage).mockImplementation(async () => {
      targetUrl = 'https://duckduckgo.com/';
      return { title: 'Old', url: 'https://other.gov/', text: 'Stale source text' };
    });
    const { outcome, steps } = await execute('read_page', { tabId: '2' }, ctx);
    expect(outcome.errorCode).toBe('BLOCKED_BY_POLICY');
    expect(steps.some((step) => step.type === 'tool_result')).toBe(false);
  });

  it('allows new-tab recovery without rechecking the blocked original page', async () => {
    const ctx = context('https://duckduckgo.com/');
    expect((await execute('new_tab', { url: 'https://agency.gov/' }, ctx)).outcome.isError).toBe(false);
    expect(ctx.runtime.newTab).toHaveBeenCalledWith('https://agency.gov/');
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

  function formControl(tagName: string, type: string, form: { action: string }) {
    const control = {
      tagName, type, form, formAction: '', outerHTML: `<${tagName.toLowerCase()} type="${type}">`,
      matches: vi.fn(() => false), getAttribute: vi.fn<(name: string) => string | null>(() => null),
      closest: vi.fn(), scrollIntoView: vi.fn(), click: vi.fn(), dispatchEvent: vi.fn(),
    };
    control.closest.mockImplementation((selector: string) => selector === 'button, input' ? control : null);
    return control;
  }

  function stubKeyboardEvents() {
    vi.stubGlobal('KeyboardEvent', class {
      constructor(public type: string, public options: KeyboardEventInit) {}
    });
  }

  it.each(['goBack', 'goForward'] as const)('refuses %s from an allowed page when the history target cannot be verified', async (method) => {
    const pageLocation = { href: 'https://agency.gov/' };
    vi.stubGlobal('location', pageLocation);
    const navigateToUnknownTarget = () => { pageLocation.href = 'https://duckduckgo.com/'; };
    const pageHistory = { back: vi.fn(navigateToUnknownTarget), forward: vi.fn(navigateToUnknownTarget) };
    vi.stubGlobal('history', pageHistory);

    await expect(createDomToolRuntime()[method]('page')).rejects.toMatchObject({
      code: 'BLOCKED_BY_POLICY',
      retryable: false,
      message: expect.stringMatching(/cannot verify its destination.*explicit allowed URL/),
    });
    expect(pageHistory.back).not.toHaveBeenCalled();
    expect(pageHistory.forward).not.toHaveBeenCalled();
    expect(pageLocation.href).toBe('https://agency.gov/');
  });

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

  it.each(['click', 'Enter', 'Space'] as const)('resolves a child span to its submitting control before %s', async (action) => {
    vi.stubGlobal('location', { href: 'https://agency.gov/' });
    const button = {
      tagName: 'BUTTON', type: 'submit', matches: () => false,
      form: { action: 'https://duckduckgo.com/submit' },
      getAttribute: () => null,
    };
    const span = {
      closest: (selector: string) => selector === 'button, input' ? button : null,
      scrollIntoView: vi.fn(), click: vi.fn(), dispatchEvent: vi.fn(),
    };
    vi.stubGlobal('document', {
      activeElement: span,
      querySelectorAll: (selector: string) => selector === '*' ? [] : [span],
    });
    const runtime = createDomToolRuntime();
    await expect(action === 'click' ? runtime.click('page', '#submit span') : runtime.pressKey('page', action))
      .rejects.toThrow(BLOCKED_DESTINATION_MESSAGE);
    expect(span.scrollIntoView).not.toHaveBeenCalled();
    expect(span.click).not.toHaveBeenCalled();
    expect(span.dispatchEvent).not.toHaveBeenCalled();
  });

  it.each([
    ['BUTTON', 'button', 'click'], ['BUTTON', 'reset', 'click'],
    ['INPUT', 'button', 'click'], ['INPUT', 'reset', 'click'], ['INPUT', 'text', 'click'],
    ['INPUT', 'checkbox', 'click'], ['INPUT', 'radio', 'click'],
    ['BUTTON', 'button', 'Enter'], ['INPUT', 'checkbox', 'Space'], ['INPUT', 'text', 'Space'],
  ] as const)('allows %s type=%s with %s when the unused form action is blocked', async (tagName, type, action) => {
    vi.stubGlobal('location', { href: 'https://agency.gov/' });
    const control = formControl(tagName, type, { action: 'https://duckduckgo.com/submit' });
    vi.stubGlobal('document', {
      activeElement: control,
      querySelectorAll: (selector: string) => selector === '*' ? [] : [control],
    });
    stubKeyboardEvents();
    const runtime = createDomToolRuntime();
    if (action === 'click') {
      await expect(runtime.click('page', '#control')).resolves.toMatchObject({ matched: control.outerHTML });
      expect(control.click).toHaveBeenCalledOnce();
    } else {
      await expect(runtime.pressKey('page', action)).resolves.toEqual({ pressed: action });
      expect(control.dispatchEvent).toHaveBeenCalledTimes(2);
    }
    expect(control.getAttribute).not.toHaveBeenCalled();
  });

  it.each(['submit', 'image'])('still blocks clicks on an input type=%s before activation', async (type) => {
    vi.stubGlobal('location', { href: 'https://agency.gov/' });
    const control = formControl('INPUT', type, { action: 'https://duckduckgo.com/submit' });
    vi.stubGlobal('document', { querySelectorAll: (selector: string) => selector === '*' ? [] : [control] });
    await expect(createDomToolRuntime().click('page', '#submit')).rejects.toThrow(BLOCKED_DESTINATION_MESSAGE);
    expect(control.click).not.toHaveBeenCalled();
    expect(control.scrollIntoView).not.toHaveBeenCalled();
  });

  it.each(['form action', 'default submitter override'])('checks the actual %s for implicit Enter submission', async (destination) => {
    vi.stubGlobal('location', { href: 'https://agency.gov/' });
    const form = { action: destination === 'form action' ? 'https://duckduckgo.com/submit' : 'https://agency.gov/submit', getRootNode: vi.fn() };
    const input = formControl('INPUT', 'text', form);
    const submitter = formControl('BUTTON', 'submit', form);
    submitter.getAttribute.mockReturnValue('submit');
    submitter.formAction = 'https://duckduckgo.com/base/submit';
    const controls = destination === 'form action' ? [input] : [input, submitter];
    form.getRootNode.mockReturnValue({ querySelectorAll: () => controls });
    vi.stubGlobal('document', { activeElement: input });

    await expect(createDomToolRuntime().pressKey('page', 'Enter')).rejects.toThrow(BLOCKED_DESTINATION_MESSAGE);
    expect(input.dispatchEvent).not.toHaveBeenCalled();
  });

  it.each(['allowed override', 'disabled default submitter', 'multiple fields without submitter'])('allows Enter with %s despite the unused blocked form action', async (scenario) => {
    vi.stubGlobal('location', { href: 'https://agency.gov/' });
    const form = { action: 'https://duckduckgo.com/submit', getRootNode: vi.fn() };
    const input = formControl('INPUT', 'text', form);
    const submitter = formControl('BUTTON', 'submit', form);
    submitter.getAttribute.mockReturnValue('https://agency.gov/submit');
    submitter.formAction = 'https://agency.gov/submit';
    submitter.matches.mockReturnValue(scenario === 'disabled default submitter');
    const controls = scenario === 'multiple fields without submitter' ?
      [input, formControl('INPUT', 'text', form)] : [input, submitter];
    form.getRootNode.mockReturnValue({ querySelectorAll: () => controls });
    vi.stubGlobal('document', { activeElement: input });
    stubKeyboardEvents();

    await expect(createDomToolRuntime().pressKey('page', 'Enter')).resolves.toEqual({ pressed: 'Enter' });
    expect(input.dispatchEvent).toHaveBeenCalledTimes(2);
  });

  it.each(['resolved formAction', 'document base URI'])('checks a relative formaction against %s', async (resolution) => {
    vi.stubGlobal('location', { href: 'https://agency.gov/current' });
    const baseURI = 'https://duckduckgo.com/search/';
    const button = {
      tagName: 'BUTTON', type: 'submit', matches: () => false,
      form: { action: 'https://agency.gov/safe' },
      formAction: resolution === 'resolved formAction' ? 'https://duckduckgo.com/search/submit' : '',
      ownerDocument: { baseURI },
      getAttribute: () => 'submit',
    };
    const span = {
      closest: (selector: string) => selector === 'button, input' ? button : null,
      scrollIntoView: vi.fn(), click: vi.fn(),
    };
    vi.stubGlobal('document', { baseURI, querySelectorAll: (selector: string) => selector === '*' ? [] : [span] });
    await expect(createDomToolRuntime().click('page', '#submit span')).rejects.toThrow(BLOCKED_DESTINATION_MESSAGE);
    expect(span.click).not.toHaveBeenCalled();
    expect(span.scrollIntoView).not.toHaveBeenCalled();
  });

  it('does not report a direct DOM click as successful after its handler changes to a blocked URL', async () => {
    const pageLocation = { href: 'https://agency.gov/' };
    vi.stubGlobal('location', pageLocation);
    const button = {
      closest: () => null, scrollIntoView: vi.fn(), outerHTML: '<button>Open</button>',
      click: vi.fn(() => { pageLocation.href = 'https://duckduckgo.com/'; }),
    };
    vi.stubGlobal('document', { querySelectorAll: (selector: string) => selector === '*' ? [] : [button] });
    await expect(createDomToolRuntime().click('page', 'button')).rejects.toThrow(BLOCKED_DESTINATION_MESSAGE);
    expect(button.click).toHaveBeenCalledOnce();
  });
});
