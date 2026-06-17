import { describe, expect, it, vi } from 'vitest';
import {
  ALL_TOOL_NAMES,
  getTool,
  toAnthropicTools,
  tools,
  zodToJsonSchema,
} from './index.js';
import type { ToolContext, ToolRuntime } from '../types.js';

function makeRuntime(): ToolRuntime {
  return {
    navigate: vi.fn(async (_id, url) => ({ url, title: 'Example' })),
    readPage: vi.fn(async () => ({
      title: 'T',
      url: 'https://example.com',
      text: 'hello',
    })),
    click: vi.fn(async (_id, target) => ({ matched: target })),
    type: vi.fn(async (_id, target) => ({ matched: target })),
    extract: vi.fn(async () => ({ data: { ok: true } })),
    screenshot: vi.fn(async () => ({ pngBase64: 'iVBORw0KGgo=' })),
    newTab: vi.fn(async (url) => ({
      id: 't-new',
      title: 'New',
      url: url ?? 'about:blank',
      active: true,
    })),
    switchTab: vi.fn(async (id) => ({ id, title: 'X', url: 'https://x', active: true })),
    listTabs: vi.fn(async () => [
      { id: 't1', title: 'A', url: 'https://a', active: true },
    ]),
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
  it('exposes every tool by name', () => {
    expect(ALL_TOOL_NAMES.sort()).toEqual(
      [
        'navigate',
        'read_page',
        'click',
        'type',
        'extract',
        'screenshot',
        'new_tab',
        'switch_tab',
        'list_tabs',
        'wait_for',
        'close_tab',
        'go_back',
        'go_forward',
        'reload',
        'scroll',
        'press_key',
      ].sort(),
    );
  });

  it('produces Anthropic tool definitions for every tool', () => {
    const defs = toAnthropicTools();
    expect(defs).toHaveLength(ALL_TOOL_NAMES.length);
    for (const def of defs) {
      expect(def).toHaveProperty('name');
      expect(def).toHaveProperty('description');
      expect(def.input_schema).toMatchObject({ type: 'object' });
    }
  });

  it('emits enum schemas for tools whose inputs are constrained sets', () => {
    const press = toAnthropicTools().find((t) => t.name === 'press_key');
    const props = (press?.input_schema as { properties: Record<string, { enum?: string[] }> })
      .properties;
    expect(props.key?.enum).toContain('Enter');
    expect(props.key?.enum).toContain('Escape');
  });

  it('returns undefined for unknown tool names', () => {
    expect(getTool('nope')).toBeUndefined();
  });
});

describe('navigate', () => {
  it('rejects non-URL inputs', () => {
    expect(() => tools.navigate.inputSchema.parse({ url: 'not-a-url' })).toThrow();
  });
  it('delegates to runtime.navigate', async () => {
    const ctx = makeCtx();
    const out = await tools.navigate.execute({ url: 'https://example.com' }, ctx);
    expect(out.url).toBe('https://example.com');
    expect(ctx.runtime.navigate).toHaveBeenCalledWith('t1', 'https://example.com');
  });
});

describe('read_page', () => {
  it('returns title/url/text', async () => {
    const ctx = makeCtx();
    const out = await tools.read_page.execute({}, ctx);
    expect(out.text).toBe('hello');
  });

  it('targets a specific tab when tabId is provided', async () => {
    const ctx = makeCtx();
    await tools.read_page.execute({ tabId: 't-bg' }, ctx);
    expect(ctx.runtime.readPage).toHaveBeenCalledWith('t-bg');
  });
});

describe('close_tab', () => {
  it('is marked destructive and delegates', async () => {
    expect(tools.close_tab.destructive).toBe(true);
    const ctx = makeCtx();
    const out = await tools.close_tab.execute({ tabId: 't1' }, ctx);
    expect(out.closed).toBe(true);
    expect(ctx.runtime.closeTab).toHaveBeenCalledWith('t1');
  });
});

describe('go_back / go_forward / reload', () => {
  it('delegate to runtime with the active tab id', async () => {
    const ctx = makeCtx();
    await tools.go_back.execute({}, ctx);
    expect(ctx.runtime.goBack).toHaveBeenCalledWith('t1');
    await tools.go_forward.execute({}, ctx);
    expect(ctx.runtime.goForward).toHaveBeenCalledWith('t1');
    await tools.reload.execute({}, ctx);
    expect(ctx.runtime.reload).toHaveBeenCalledWith('t1');
  });
});

describe('scroll', () => {
  it('passes direction and amount through', async () => {
    const ctx = makeCtx();
    await tools.scroll.execute({ direction: 'down', amount: 400 }, ctx);
    expect(ctx.runtime.scroll).toHaveBeenCalledWith('t1', {
      direction: 'down',
      amount: 400,
    });
  });

  it('rejects non-enum directions', () => {
    expect(() =>
      tools.scroll.inputSchema.parse({ direction: 'sideways' }),
    ).toThrow();
  });
});

describe('press_key', () => {
  it('delegates to runtime.pressKey', async () => {
    const ctx = makeCtx();
    const out = await tools.press_key.execute({ key: 'Enter' }, ctx);
    expect(out.pressed).toBe('Enter');
  });
});

describe('click', () => {
  it('is marked destructive', () => {
    expect(tools.click.destructive).toBe(true);
  });
  it('requires a non-empty target', () => {
    expect(() => tools.click.inputSchema.parse({ target: '' })).toThrow();
  });
  it('delegates to runtime.click', async () => {
    const ctx = makeCtx();
    const out = await tools.click.execute({ target: '#submit' }, ctx);
    expect(out.matched).toBe('#submit');
  });
});

describe('type', () => {
  it('delegates to runtime.type', async () => {
    const ctx = makeCtx();
    const out = await tools.type.execute({ target: '#q', text: 'grants' }, ctx);
    expect(out.matched).toBe('#q');
    expect(ctx.runtime.type).toHaveBeenCalledWith('t1', '#q', 'grants');
  });
});

describe('extract', () => {
  it('passes the schema through to the runtime', async () => {
    const ctx = makeCtx();
    const schema = { type: 'object', properties: { title: { type: 'string' } } };
    const out = await tools.extract.execute({ schema }, ctx);
    expect(ctx.runtime.extract).toHaveBeenCalledWith('t1', schema);
    expect(out.data).toEqual({ ok: true });
  });
});

describe('screenshot', () => {
  it('returns a base64 string', async () => {
    const ctx = makeCtx();
    const out = await tools.screenshot.execute({}, ctx);
    expect(out.pngBase64).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});

describe('new_tab + switch_tab + list_tabs', () => {
  it('opens a new tab and returns its summary', async () => {
    const ctx = makeCtx();
    const out = await tools.new_tab.execute({ url: 'https://x.example' }, ctx);
    expect(out.url).toBe('https://x.example');
  });

  it('opens a new tab without a url', async () => {
    const ctx = makeCtx();
    const out = await tools.new_tab.execute({}, ctx);
    expect(out.url).toBe('about:blank');
  });

  it('switches tab and returns its summary', async () => {
    const ctx = makeCtx();
    const out = await tools.switch_tab.execute({ tabId: 't2' }, ctx);
    expect(out.id).toBe('t2');
  });

  it('lists tabs', async () => {
    const ctx = makeCtx();
    const out = await tools.list_tabs.execute({}, ctx);
    expect(out.tabs).toHaveLength(1);
  });
});

describe('wait_for', () => {
  it('rejects when neither selector nor networkIdle is set', () => {
    expect(() => tools.wait_for.inputSchema.parse({})).toThrow();
  });

  it('caps timeoutMs at 10s', () => {
    expect(() =>
      tools.wait_for.inputSchema.parse({ selector: '#x', timeoutMs: 30_000 }),
    ).toThrow();
  });

  it('accepts a selector', async () => {
    const ctx = makeCtx();
    const out = await tools.wait_for.execute({ selector: '.ready' }, ctx);
    expect(out.matched).toBe(true);
  });

  it('accepts networkIdle', async () => {
    const ctx = makeCtx();
    const out = await tools.wait_for.execute({ networkIdle: true }, ctx);
    expect(out.matched).toBe(true);
  });
});

describe('zodToJsonSchema', () => {
  it('marks required fields when the schema is non-optional', () => {
    const json = zodToJsonSchema(tools.navigate.inputSchema);
    expect(json.required).toContain('url');
  });
  it('omits required when all fields are optional (e.g. read_page input)', () => {
    const json = zodToJsonSchema(tools.read_page.inputSchema);
    expect(json.required).toBeUndefined();
  });
});
