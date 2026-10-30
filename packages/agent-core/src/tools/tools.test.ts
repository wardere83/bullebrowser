import { describe, expect, it, vi } from 'vitest';
import { ALL_TOOL_NAMES, getTool, toAnthropicTools, tools, zodToJsonSchema } from './index.js';
import type { ToolContext, ToolRuntime } from '../types.js';

function makeRuntime(): ToolRuntime {
  return {
    navigate: vi.fn(async (_id, url) => ({ url, title: 'Example' })),
    readPage: vi.fn(async () => ({ title: 'T', url: 'https://example.com', text: 'hello world' })),
    click: vi.fn(async (_id, target) => ({ matched: target })),
    type: vi.fn(async (_id, target) => ({ matched: target })),
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

function makeCtx(): ToolContext {
  return {
    activeTabId: 't1',
    signal: new AbortController().signal,
    runtime: makeRuntime(),
  };
}

describe('tool registry', () => {
  it('includes required safe foundational tools', () => {
    for (const required of [
      'getActiveTab',
      'listTabs',
      'getPageText',
      'getPageMetadata',
      'getSelection',
      'listLinks',
      'queryDom',
      'summarizePage',
      'extractStructuredData',
      'navigate',
      'clickElement',
      'typeIntoField',
    ]) {
      expect(ALL_TOOL_NAMES).toContain(required);
    }
  });

  it('keeps compatibility aliases for legacy prompts', () => {
    expect(ALL_TOOL_NAMES).toContain('read_page');
    expect(ALL_TOOL_NAMES).toContain('click');
    expect(ALL_TOOL_NAMES).toContain('type');
    expect(ALL_TOOL_NAMES).toContain('extract');
  });

  it('builds Anthropic-compatible JSON schema definitions', () => {
    const defs = toAnthropicTools();
    expect(defs.length).toBe(ALL_TOOL_NAMES.length);
    expect(defs.every((d) => d.input_schema.type === 'object')).toBe(true);
  });

  it('returns undefined for missing tools', () => {
    expect(getTool('not-real')).toBeUndefined();
  });
});

// The agent feeds untrusted page text straight to the model, so a hostile page
// can try to talk it into opening something it shouldn't. These are the cases
// that must never reach a real browser.
describe('navigate URL policy', () => {
  it('refuses non-web schemes', () => {
    for (const url of [
      'file:///etc/passwd',
      'file:///Users/someone/.aws/credentials',
      'data:text/html,<h1>hi</h1>',
      'javascript:alert(1)',
      'chrome://settings',
    ]) {
      const result = tools.navigate.inputSchema.safeParse({ url });
      expect(result.success, `${url} must be rejected`).toBe(false);
    }
  });

  it('allows ordinary web URLs and normalizes a bare host', () => {
    expect(tools.navigate.inputSchema.parse({ url: 'https://example.com/a?b=c' }).url).toBe(
      'https://example.com/a?b=c',
    );
    // The model reaches for bare hosts constantly; rejecting them just burned
    // a tool call.
    expect(tools.navigate.inputSchema.parse({ url: 'example.com' }).url).toBe(
      'https://example.com/',
    );
    expect(tools.navigate.inputSchema.parse({ url: '  example.com/pricing ' }).url).toBe(
      'https://example.com/pricing',
    );
  });

  it('still advertises a plain string to the model despite the transform', () => {
    const schema = zodToJsonSchema(tools.navigate.inputSchema);
    const props = schema.properties as Record<string, { type?: string; description?: string }>;
    expect(props.url?.type).toBe('string');
    expect(props.url?.description).toMatch(/https?/);
    expect(schema.required).toContain('url');
  });
});

describe('tool behavior', () => {
  it('summarizePage returns local summary with citations', async () => {
    const out = await tools.summarizePage.execute(
      {
        text: 'Sentence one about grants. Sentence two with deadlines. Sentence three.',
        sourceUrl: 'https://example.com',
      },
      makeCtx(),
    );
    expect(out.summary.length).toBeGreaterThan(10);
    expect(out.citations).toContain('https://example.com');
  });

  it('getPageText delegates to runtime.readPage', async () => {
    const ctx = makeCtx();
    const out = await tools.getPageText.execute({}, ctx);
    expect(out.text).toContain('hello');
    expect(ctx.runtime.readPage).toHaveBeenCalledWith('t1');
  });

  it('queryDom fails gracefully when runtime adapter is absent', async () => {
    await expect(tools.queryDom.execute({ selector: '.cta' }, makeCtx())).rejects.toThrow(
      /not available/,
    );
  });

  it('zodToJsonSchema marks required properties', () => {
    const json = zodToJsonSchema(tools.navigate.inputSchema);
    expect(json.required).toContain('url');
  });
});

// The tools are the agent's entire browser-control surface, so every one of
// them is exercised against a runtime — a tool that silently fails to delegate
// would break browsing without any test noticing.
describe('every tool delegates to the runtime', () => {
  it('exercises the full tool surface', async () => {
    const ctx = makeCtx();

    expect((await tools.getActiveTab.execute({}, ctx)).id).toBe('t1');
    expect((await tools.listTabs.execute({}, ctx)).tabs).toHaveLength(1);
    expect((await tools.getPageMetadata.execute({}, ctx)).url).toBe('https://example.com');
    expect((await tools.getSelection.execute({}, ctx)).text).toBe('');
    expect((await tools.extractStructuredData.execute({ schema: {} }, ctx)).data).toEqual({ ok: true });
    expect((await tools.navigate.execute({ url: 'https://example.com' }, ctx)).title).toBe('Example');
    expect((await tools.clickElement.execute({ target: 'Buy' }, ctx)).matched).toBe('Buy');
    expect((await tools.typeIntoField.execute({ target: 'q', text: 'hi' }, ctx)).matched).toBe('q');
    expect((await tools.read_page.execute({}, ctx)).text).toContain('hello');
    expect((await tools.click.execute({ target: 'X' }, ctx)).matched).toBe('X');
    expect((await tools.type.execute({ target: 'y', text: 'z' }, ctx)).matched).toBe('y');
    expect((await tools.extract.execute({ schema: {} }, ctx)).data).toEqual({ ok: true });
    expect((await tools.screenshot.execute({}, ctx)).pngBase64).toContain('iVBOR');
    expect((await tools.new_tab.execute({ url: 'https://n' }, ctx)).id).toBe('t-new');
    expect((await tools.switch_tab.execute({ tabId: 't9' }, ctx)).id).toBe('t9');
    expect((await tools.list_tabs.execute({}, ctx)).tabs).toHaveLength(1);
    expect((await tools.close_tab.execute({ tabId: 't1' }, ctx)).closed).toBe(true);
    expect((await tools.go_back.execute({}, ctx)).url).toBe('https://prev');
    expect((await tools.go_forward.execute({}, ctx)).url).toBe('https://next');
    expect((await tools.reload.execute({}, ctx)).url).toBe('https://r');
    expect((await tools.scroll.execute({ direction: 'down' }, ctx)).scrolledTo).toBe(600);
    expect((await tools.press_key.execute({ key: 'Enter' }, ctx)).pressed).toBe('Enter');
    expect((await tools.wait_for.execute({ networkIdle: true }, ctx)).matched).toBe(true);
  });

  it('prefers the richer optional runtime adapters when they exist', async () => {
    const ctx = makeCtx();
    ctx.runtime.getSelection = vi.fn(async () => ({ text: 'picked' }));
    ctx.runtime.listLinks = vi.fn(async () => [{ text: 'Home', href: 'https://h' }]);
    ctx.runtime.queryDom = vi.fn(async () => ({ matches: 3 }));

    expect((await tools.getSelection.execute({}, ctx)).text).toBe('picked');
    expect((await tools.listLinks.execute({}, ctx)).links[0]?.href).toBe('https://h');
    expect((await tools.queryDom.execute({ selector: '.x' }, ctx)).matches).toBe(3);
  });

  it('listLinks falls back to scraping URLs out of the page text', async () => {
    const ctx = makeCtx();
    ctx.runtime.readPage = vi.fn(async () => ({
      title: 'T',
      url: 'https://e',
      text: 'see https://a.com and https://b.com',
    }));
    const out = await tools.listLinks.execute({}, ctx);
    expect(out.links.map((l) => l.href)).toEqual(['https://a.com', 'https://b.com']);
  });

  it('getActiveTab throws when no tab is active', async () => {
    const ctx = makeCtx();
    ctx.runtime.listTabs = vi.fn(async () => []);
    await expect(tools.getActiveTab.execute({}, ctx)).rejects.toThrow(/No active tab/);
  });

  it('honors an explicit tabId instead of the active tab', async () => {
    const ctx = makeCtx();
    await tools.getPageText.execute({ tabId: 't7' }, ctx);
    expect(ctx.runtime.readPage).toHaveBeenCalledWith('t7');
  });
});

it('uses the metadata adapter without extracting the body, preserving the fallback for other hosts', async () => {
  const ctx = makeCtx();
  ctx.runtime.getPageMetadata = vi.fn(async () => ({ title: 'Metadata', url: 'https://agency.gov' }));
  expect(await tools.getPageMetadata.execute({}, ctx)).toMatchObject({ title: 'Metadata', url: 'https://agency.gov' });
  expect(ctx.runtime.readPage).not.toHaveBeenCalled();
  delete ctx.runtime.getPageMetadata;
  expect(await tools.getPageMetadata.execute({}, ctx)).toMatchObject({ title: 'T' });
  expect(ctx.runtime.readPage).toHaveBeenCalledOnce();
});
