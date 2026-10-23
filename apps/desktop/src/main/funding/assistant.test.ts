import type * as AgentCore from '@bullebrowser/agent-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const calls = vi.hoisted(() => ({ structuredCompletion: vi.fn() }));
vi.mock('@bullebrowser/agent-core', async (original) => ({
  ...(await original<typeof AgentCore>()),
  structuredCompletion: calls.structuredCompletion,
}));

const { ModelCallError, TERMINOLOGY_INSTRUCTIONS, UNTRUSTED_RULES } = await import('@bullebrowser/agent-core');
const { createAssistant } = await import('./assistant.js');
const { FundingError } = await import('./errors.js');

const schema = { name: 'answer', json: { type: 'object' }, zod: z.object({ ok: z.boolean() }) };
const request = (signal = new AbortController().signal) => ({
  system: 'Report what the documents state.',
  documents: '<untrusted_page_data source="D-documents">\n[D1:b0001] Our mission is to light the harbor.\n</untrusted_page_data>',
  task: 'List the mission.',
  schema,
  signal,
});

const keys = (held: Partial<Record<'anthropic' | 'openai', string>>) => (provider: 'anthropic' | 'openai') => held[provider] ?? null;

beforeEach(() => {
  calls.structuredCompletion.mockReset();
  calls.structuredCompletion.mockResolvedValue({ value: { ok: true }, model: 'm', usage: {} });
});

describe('the connected assistant', () => {
  it('is not connected without a saved key, and says so when asked to work', async () => {
    const assistant = createAssistant({ selectedModel: () => undefined, apiKey: keys({}) });
    expect(assistant.connected()).toBe(false);
    expect(assistant.availability().connected).toBe(false);
    await expect(assistant.complete(request())).rejects.toMatchObject({ code: 'NO_ASSISTANT' });
    expect(calls.structuredCompletion).not.toHaveBeenCalled();
  });

  it("uses the current model of the tier the user chose, with that provider's key", async () => {
    const assistant = createAssistant({ selectedModel: () => 'claude-sonnet-4-6', apiKey: keys({ anthropic: 'key-a', openai: 'key-o' }) });
    await assistant.complete(request());
    const sent = calls.structuredCompletion.mock.calls[0]?.[0];
    expect(sent.model).toBe('claude-sonnet-5-5');
    expect(sent.engine).toEqual({ apiKey: 'key-a' });
  });

  it('falls back to the provider that does have a key', async () => {
    const assistant = createAssistant({ selectedModel: () => 'claude-opus-4-7', apiKey: keys({ openai: 'key-o' }) });
    expect(assistant.connected()).toBe(true);
    await assistant.complete(request());
    const sent = calls.structuredCompletion.mock.calls[0]?.[0];
    expect(sent.model).toBe('gpt-4o');
    expect(sent.engine).toEqual({ apiKey: 'key-o' });
  });

  it('keeps document text out of the instructions and sends it first, marked for reuse', async () => {
    const assistant = createAssistant({ selectedModel: () => undefined, apiKey: keys({ anthropic: 'key-a' }) });
    await assistant.complete(request());
    const sent = calls.structuredCompletion.mock.calls[0]?.[0];
    expect(sent.system).toContain('Report what the documents state.');
    expect(sent.system).toContain(TERMINOLOGY_INSTRUCTIONS);
    expect(sent.system).toContain(UNTRUSTED_RULES);
    expect(sent.system).not.toContain('light the harbor');
    expect(sent.messages).toEqual([
      {
        role: 'user',
        content: [
          { text: request().documents, cache: true },
          { text: 'List the mission.' },
        ],
      },
    ]);
    expect(sent.refusalFallback).toBe(true);
  });

  it('uses a stand-in address only when one is given', async () => {
    const assistant = createAssistant({
      selectedModel: () => undefined,
      apiKey: keys({ anthropic: 'key-a' }),
      baseUrl: () => 'http://127.0.0.1:9',
    });
    await assistant.complete(request());
    expect(calls.structuredCompletion.mock.calls[0]?.[0].engine).toEqual({ apiKey: 'key-a', baseURL: 'http://127.0.0.1:9' });
  });

  it("reports a provider failure in the app's own words", async () => {
    calls.structuredCompletion.mockRejectedValue(new ModelCallError('AUTH', 'x-api-key header invalid for vendor.example', 401));
    const assistant = createAssistant({ selectedModel: () => undefined, apiKey: keys({ anthropic: 'key-a' }) });
    const error = await assistant.complete(request()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(FundingError);
    expect(error).toMatchObject({ code: 'ASSISTANT_ERROR' });
    expect((error as Error).message).not.toMatch(/vendor|x-api-key|401/);
    expect((error as Error).message).toContain('key saved in Settings');
  });

  it('reports anything unexpected without passing its wording on', async () => {
    calls.structuredCompletion.mockRejectedValue(new Error('ECONNRESET at /Users/someone/secret'));
    const assistant = createAssistant({ selectedModel: () => undefined, apiKey: keys({ anthropic: 'key-a' }) });
    const error = await assistant.complete(request()).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'ASSISTANT_ERROR' });
    expect((error as Error).message).not.toContain('secret');
  });

  it('reports a stop as a stop', async () => {
    const controller = new AbortController();
    calls.structuredCompletion.mockImplementation(async () => {
      controller.abort();
      throw new Error('cancelled');
    });
    const assistant = createAssistant({ selectedModel: () => undefined, apiKey: keys({ anthropic: 'key-a' }) });
    await expect(assistant.complete(request(controller.signal))).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});
