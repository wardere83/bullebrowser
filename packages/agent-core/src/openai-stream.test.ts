import { describe, expect, it, vi } from 'vitest';
import { consumeOpenAiStream } from './openai-loop.js';
const encode = new TextEncoder();
const event = (delta: unknown, finish_reason: string | null = null) => 'data: ' + JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] }) + '\n\n';
const part = (args: string) => ({ tool_calls: [{ index: 0, function: { arguments: args } }] });

describe('OpenAI streamed tool dispatch', () => {
  it('dispatches fragmented complete JSON before the terminal turn, exactly once', async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(new ReadableStream({ start(controller) { stream = controller; } }));
    const onTool = vi.fn();
    const result = consumeOpenAiStream(response, onTool);
    stream.enqueue(encode.encode(event({ tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'read_page', arguments: '{"tab' } }] })));
    await Promise.resolve(); expect(onTool).not.toHaveBeenCalled();
    const complete = encode.encode(event(part('Id":"t1"}')));
    stream.enqueue(complete.slice(0, 12)); stream.enqueue(complete.slice(12));
    await vi.waitFor(() => expect(onTool).toHaveBeenCalledOnce());
    expect(onTool.mock.calls[0]?.[0].function.arguments).toBe('{"tabId":"t1"}');
    stream.enqueue(encode.encode(event({}, 'tool_calls'))); stream.close();
    expect((await result).choices[0]?.message.tool_calls).toHaveLength(1);
    expect(onTool).toHaveBeenCalledOnce();
  });
  it('preserves call order when later arguments finish first', async () => {
    const calls: string[] = [];
    const first = event({ tool_calls: [{ index: 0, id: 'first', function: { name: 'click', arguments: '{' } }] });
    const second = event({ tool_calls: [{ index: 1, id: 'second', function: { name: 'read_page', arguments: '{}' } }] });
    await consumeOpenAiStream(new Response(first + second + event(part('"target":"@1"}')) + event({}, 'tool_calls')), (call) => calls.push(call.id));
    expect(calls).toEqual(['first', 'second']);
  });
  it('rejects a truncated stream and never executes partial JSON', async () => {
    const onTool = vi.fn();
    const body = event({ tool_calls: [{ index: 0, id: 'x', function: { name: 'click', arguments: '{' } }] });
    await expect(consumeOpenAiStream(new Response(body), onTool)).rejects.toThrow('complete turn');
    expect(onTool).not.toHaveBeenCalled();
  });
  it('refuses a changed call after dispatch instead of executing it again', async () => {
    const onTool = vi.fn();
    const body = event({ tool_calls: [{ index: 0, id: 'x', function: { name: 'read_page', arguments: '{}' } }] }) + event(part('{"changed":true}'));
    await expect(consumeOpenAiStream(new Response(body), onTool)).rejects.toThrow('changed');
    expect(onTool).toHaveBeenCalledOnce();
  });
  it('preserves text, usage and zero-argument calls', async () => {
    const onTool = vi.fn();
    const body = event({ content: 'Reading', tool_calls: [{ index: 0, id: 'x', function: { name: 'list_tabs', arguments: '' } }] }) + event({}, 'tool_calls') + 'data: {"choices":[],"usage":{"completion_tokens":7}}\n\ndata: [DONE]\n';
    const result = await consumeOpenAiStream(new Response(body), onTool);
    expect(result.usage?.completion_tokens).toBe(7);
    expect(result.choices[0]?.message.content).toBe('Reading');
    expect(onTool).toHaveBeenCalledOnce();
  });
});
