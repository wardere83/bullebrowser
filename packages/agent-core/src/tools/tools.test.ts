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

describe('tool behavior', () => {
  it('summarizePage returns local summary with citations', async () => {
    const out = await tools.summarizePage.execute(
      {
        text: 'Sentence one about grants. Sentence two with deadlines. Sentence three.',
        sourceUrl: 'https://example.com',
      }
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
