import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentInput, AgentStep, ToolContext } from './types.js';
const { response } = vi.hoisted(() => ({ response: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: response }; } }));
import { runAgent, DEFAULT_MODEL } from './agent-loop.js';

function context() {
  return {
    activeTabId: 'tab', signal: new AbortController().signal,
    runtime: {
      listTabs: vi.fn(async () => [{ id: 'tab', active: true, url: 'https://agency.gov/', title: 'Agency' }]),
      readPage: vi.fn(async () => ({ url: 'https://agency.gov/', title: 'Agency', text: 'Official program information.' })),
      click: vi.fn(async (_id: string, target: string) => ({ matched: target })),
      confirmDestructive: vi.fn(async () => true),
    },
  } as unknown as ToolContext;
}
function input(overrides: Partial<AgentInput> = {}): AgentInput {
  return { apiKey: 'fixture', model: DEFAULT_MODEL, systemPrompt: '', history: [], userMessage: 'Hello', context: context(), onStep: () => {}, ...overrides };
}
const text = (value: string) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: value }] });
beforeEach(() => response.mockReset());
afterEach(() => vi.unstubAllGlobals());

describe('task completion and presentation', () => {
  it('continues a premature success claim until the requested browser action actually executes', async () => {
    response.mockResolvedValueOnce(text('Done.'))
      .mockResolvedValueOnce({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'click', name: 'click', input: { target: 'Save' } }] })
      .mockResolvedValueOnce(text('The Save control was clicked.'));
    const ctx = context();
    const outcome = vi.fn();
    expect(await runAgent(input({ userMessage: 'Click "Save"', context: ctx, onCompletion: outcome }))).toContain('clicked');
    expect(ctx.runtime.click).toHaveBeenCalledTimes(1);
    expect(response).toHaveBeenCalledTimes(3);
    expect(outcome).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
  });
  it('suppresses a repeated success claim when the action still never happened', async () => {
    response.mockResolvedValue(text('Done. Everything was completed successfully.'));
    const outcome = vi.fn();
    const result = await runAgent(input({ userMessage: 'Click "Save"', onCompletion: outcome }));
    expect(result).toContain('Task incomplete');
    expect(result).not.toContain('completed successfully');
    expect(outcome).toHaveBeenCalledWith(expect.objectContaining({ status: 'incomplete' }));
    expect(response).toHaveBeenCalledTimes(3);
  });
  it('does not report research as completed when no sufficient live evidence was obtained', async () => {
    response.mockResolvedValue(text('All research is complete.'));
    const outcome = vi.fn();
    const events: AgentStep[] = [];
    await runAgent(input({ researchMode: true, userMessage: 'Find grants for Seattle schools', onCompletion: outcome, onStep: (step) => events.push(step) }));
    expect(outcome).toHaveBeenCalledWith(expect.objectContaining({ status: 'incomplete' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'error', data: { code: 'TASK_INCOMPLETE' } }));
  });
  it('keeps an essential clarification visible while reporting the task as incomplete', async () => {
    response.mockResolvedValue(text('Which city and program should I research?'));
    const outcome = vi.fn();
    const result = await runAgent(input({ researchMode: true, userMessage: 'Find grants', onCompletion: outcome }));
    expect(result).toBe('Which city and program should I research?');
    expect(outcome).toHaveBeenCalledWith(expect.objectContaining({ status: 'incomplete' }));
  });
  it('never exposes inherited restricted naming in assistant output or activity', async () => {
    const name = String.fromCharCode(100,117,99,107,100,117,99,107,103,111);
    response.mockResolvedValue(text(`Thinking with ${name}: https://${name}.com/`));
    const events: AgentStep[] = [];
    const result = await runAgent(input({ onStep: (step) => events.push(step), history: [{ role: 'assistant', content: `Use ${name}` }] }));
    expect(result.toLowerCase()).not.toContain(name);
    expect(JSON.stringify(events).toLowerCase()).not.toContain(name);
    expect(JSON.stringify(response.mock.calls[0]![0].messages).toLowerCase()).not.toContain(name);
  });
  it('continues a length-limited OpenAI answer before finalizing it', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: 'First part.' } }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'Final part.' } }] })));
    vi.stubGlobal('fetch', request);
    const outcome = vi.fn();
    const result = await runAgent(input({ model: 'gpt-4o', onCompletion: outcome }));
    expect(result).toBe('First part. Final part.');
    expect(request).toHaveBeenCalledTimes(2);
    expect(outcome).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
  });
  it('reports incomplete when repeated length limits exhaust the loop', async () => {
    response.mockResolvedValue({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'Unfinished part.' }] });
    const outcome = vi.fn();
    const result = await runAgent(input({ budget: 1, onCompletion: outcome }));
    expect(result).toContain('ran out of step budget');
    expect(outcome).toHaveBeenCalledWith(expect.objectContaining({ status: 'incomplete' }));
    expect(response).toHaveBeenCalledTimes(7);
  });
  it('completes a single-page task from the real current-page read', async () => {
    response.mockResolvedValue(text('The page describes the official program information.'));
    const outcome = vi.fn();
    await runAgent(input({ browserTask: 'explore_page', researchMode: true, userMessage: 'Find program information on this page', onCompletion: outcome }));
    expect(response).toHaveBeenCalledTimes(1);
    expect(outcome).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', verifiedSourceCount: 1 }));
  });
  it('accepts a comparison of the two explicitly supplied sources', async () => {
    response.mockResolvedValueOnce({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'one', name: 'read_page', input: {} }] })
      .mockResolvedValueOnce({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'two', name: 'read_page', input: {} }] })
      .mockResolvedValueOnce(text('Both supplied program pages were checked.'));
    const ctx = context();
    let reads = 0;
    ctx.runtime.readPage = vi.fn(async () => ({ url: 'https://agency.gov/source-' + Math.max(0, reads++ - 1), title: 'Official program', text: 'Eligibility and deadline.' }));
    const outcome = vi.fn();
    await runAgent(input({ browserTask: 'compare_grants', userMessage: 'Compare https://agency.gov/source-0 and https://agency.gov/source-1', context: ctx, onCompletion: outcome }));
    expect(response).toHaveBeenCalledTimes(3);
    expect(outcome).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', verifiedSourceCount: 2 }));
  });
  it('does not let a cookie-banner click satisfy a requested Save click', async () => {
    response.mockResolvedValueOnce({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'cookie', name: 'click', input: { target: 'Accept cookies' } }] })
      .mockResolvedValue(text('Done. Everything completed successfully.'));
    const ctx = context(), outcome = vi.fn();
    const result = await runAgent(input({ userMessage: 'Click "Save"', context: ctx, onCompletion: outcome }));
    expect(ctx.runtime.click).toHaveBeenCalledTimes(1);
    expect(result).toContain('Task incomplete');
    expect(outcome).toHaveBeenCalledWith(expect.objectContaining({ status: 'incomplete' }));
  });
  it('does not let an unrelated page read recover a failed Save action', async () => {
    response.mockResolvedValueOnce({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'edit', name: 'click', input: { target: 'Edit' } }] })
      .mockResolvedValueOnce({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'save', name: 'click', input: { target: 'Save' } }] })
      .mockResolvedValueOnce({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'read', name: 'read_page', input: {} }] })
      .mockResolvedValue(text('Done.'));
    const ctx = context(), outcome = vi.fn();
    ctx.runtime.click = vi.fn().mockResolvedValueOnce({ matched: 'Edit' }).mockRejectedValue(new Error('No element matched Save'));
    await runAgent(input({ userMessage: 'Click "Save"', context: ctx, onCompletion: outcome }));
    expect(outcome).toHaveBeenCalledWith(expect.objectContaining({ status: 'incomplete' }));
  });
  it('keeps an empty final answer incomplete after formatting', async () => {
    response.mockResolvedValue(text(''));
    const outcome = vi.fn();
    const result = await runAgent(input({ onCompletion: outcome }));
    expect(result).toContain('No final result');
    expect(outcome).toHaveBeenCalledWith(expect.objectContaining({ status: 'incomplete' }));
  });
  it('does not report a no-op close as completed', async () => {
    response.mockResolvedValueOnce({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'close', name: 'close_tab', input: { tabId: 'tab' } }] })
      .mockResolvedValue(text('Done.'));
    const ctx = context(), outcome = vi.fn();
    ctx.runtime.closeTab = vi.fn(async () => ({ closed: false }));
    await runAgent(input({ userMessage: 'Close this tab', context: ctx, onCompletion: outcome }));
    expect(outcome).toHaveBeenCalledWith(expect.objectContaining({ status: 'incomplete' }));
  });
  it.each([['Press Save', 'Save'], ['Open the menu', 'Menu'], ['Close the dialog', 'Close']])('accepts the correct page control action for %s', async (request, target) => {
    response.mockResolvedValueOnce({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'action', name: 'clickElement', input: { target } }] })
      .mockResolvedValueOnce(text('The requested control was activated.'));
    const outcome = vi.fn();
    await runAgent(input({ userMessage: request!, onCompletion: outcome }));
    expect(response).toHaveBeenCalledTimes(2);
    expect(outcome).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
  });
  it('uses the same initial evidence for continuation, answer text and completion', async () => {
    response.mockResolvedValueOnce({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'one', name: 'read_page', input: {} }] })
      .mockResolvedValueOnce({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'two', name: 'read_page', input: {} }] })
      .mockResolvedValueOnce(text('Three official source pages were verified.'));
    const ctx = context();
    let reads = 0;
    ctx.runtime.readPage = vi.fn(async () => ({ url: 'https://agency.gov/program-' + reads++, title: 'Official source', text: 'Program evidence.' }));
    const outcome = vi.fn();
    const result = await runAgent(input({ userMessage: 'Find grants for Seattle schools', researchMode: true, context: ctx, onCompletion: outcome }));
    expect(result).not.toContain('incomplete');
    expect(response).toHaveBeenCalledTimes(3);
    expect(outcome).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', verifiedSourceCount: 3 }));
  });

  it('uses the inspected control label over a misleading requested selector', async () => {
    response.mockResolvedValueOnce({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'wrong', name: 'click', input: { target: 'Save' } }] })
      .mockResolvedValue(text('Done.'));
    const ctx = context(), outcome = vi.fn();
    ctx.runtime.inspectTarget = vi.fn(async () => ({ label: 'Accept cookies', submitsForm: false }));
    await runAgent(input({ userMessage: 'Click "Save"', context: ctx, onCompletion: outcome }));
    expect(outcome).toHaveBeenCalledWith(expect.objectContaining({ status: 'incomplete' }));
  });
  it('does not let closing a different tab satisfy closing the current tab', async () => {
    response.mockResolvedValueOnce({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'close', name: 'close_tab', input: { tabId: 'other' } }] })
      .mockResolvedValue(text('Done.'));
    const ctx = context(), outcome = vi.fn();
    ctx.runtime.closeTab = vi.fn(async () => ({ closed: true }));
    await runAgent(input({ userMessage: 'Close this tab', context: ctx, onCompletion: outcome }));
    expect(outcome).toHaveBeenCalledWith(expect.objectContaining({ status: 'incomplete' }));
  });

});
