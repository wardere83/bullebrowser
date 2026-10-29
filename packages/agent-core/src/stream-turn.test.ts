import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { consumeTurn, ToolDispatchQueue } from './stream-turn.js';
const tool = (id: string, name = 'click'): Anthropic.ToolUseBlock => ({ type: 'tool_use', caller: { type: 'direct' }, id, name, input: {} });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; }); return { promise, resolve }; };
const tick = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe('streamed tool dispatch', () => {
  it('dispatches a complete block before end-of-turn, exactly once, and preserves private thinking', async () => {
    const hold = deferred();
    const dispatch = vi.fn();
    async function* stream(): AsyncGenerator<Anthropic.RawMessageStreamEvent> {
      yield { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } };
      yield { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'private' } };
      yield { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'signature' } };
      yield { type: 'content_block_stop', index: 0 };
      yield { type: 'content_block_start', index: 1, content_block: tool('first', 'navigate') };
      yield { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"url":"https://' } };
      yield { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: 'agency.gov"}' } };
      expect(dispatch).not.toHaveBeenCalled();
      yield { type: 'content_block_stop', index: 1 };
      await hold.promise;
      yield { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null, container: null, stop_details: null }, usage: { output_tokens: 20, input_tokens: null, cache_creation_input_tokens: null, cache_read_input_tokens: null, server_tool_use: null } };
    }
    const result = consumeTurn(stream(), dispatch);
    await tick(); await tick();
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls[0]?.[0].input).toEqual({ url: 'https://agency.gov' });
    hold.resolve();
    expect((await result).content[0]).toMatchObject({ thinking: 'private', signature: 'signature' });
  });
  it('fails closed on truncated or malformed streams', async () => {
    async function* truncated(): AsyncGenerator<Anthropic.RawMessageStreamEvent> {
      yield { type: 'content_block_start', index: 0, content_block: tool('first') };
      yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{' } };
    }
    const dispatch = vi.fn();
    await expect(consumeTurn(truncated(), dispatch)).rejects.toThrow('complete turn');
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('overlaps independent reads and waits for them before mutations, preserving call order', async () => {
    const hold = deferred();
    const started: string[] = [];
    const queue = new ToolDispatchQueue(async (call) => { started.push(call.id); if (call.name !== 'click') await hold.promise; return call.id; });
    const a = queue.enqueue(tool('a', 'getPageMetadata'));
    const b = queue.enqueue(tool('b', 'listLinks'));
    const c = queue.enqueue(tool('c'));
    const d = queue.enqueue(tool('d', 'getSelection'));
    await tick();
    expect(started).toEqual(['a', 'b']);
    expect(queue.enqueue(tool('a', 'getPageMetadata'))).toBe(a);
    hold.resolve();
    expect(await Promise.all([a, b, c, d])).toEqual(['a', 'b', 'c', 'd']);
    expect(started).toEqual(['a', 'b', 'c', 'd']);
  });
  it('serializes all unknown and host tools, and does not strand calls after a failure', async () => {
    const started: string[] = [];
    const queue = new ToolDispatchQueue(async (call) => { started.push(call.id); if (call.id === 'a') throw new Error('failed'); return call.id; });
    const a = queue.enqueue(tool('a', 'getPageMetadata'));
    const b = queue.enqueue(tool('b', 'custom_write'));
    await expect(a).rejects.toThrow('failed');
    await expect(b).resolves.toBe('b');
    expect(started).toEqual(['a', 'b']);
    await queue.settled();
  });
});

it('treats host overrides of read tool names as serial operations', async () => {
  const hold = deferred();
  const started: string[] = [];
  const queue = new ToolDispatchQueue(async (call) => { started.push(call.id); if (call.id === 'a') await hold.promise; return call.id; }, new Set(['getPageMetadata']));
  const a = queue.enqueue(tool('a', 'getPageMetadata'));
  const b = queue.enqueue(tool('b', 'getPageMetadata'));
  await tick();
  expect(started).toEqual(['a']);
  hold.resolve();
  await Promise.all([a, b]);
  expect(started).toEqual(['a', 'b']);
});
