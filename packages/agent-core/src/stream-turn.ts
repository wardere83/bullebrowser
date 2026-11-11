import type Anthropic from '@anthropic-ai/sdk';

type DispatchCall = Pick<Anthropic.ToolUseBlock, 'id' | 'name' | 'input' | 'type'>;
type Turn = Pick<Anthropic.Message, 'content' | 'stop_reason'>;
/** Consume complete content blocks, never partial JSON. Private thinking stays in the provider transcript. */
export async function consumeTurn(
  source: AsyncIterable<Anthropic.RawMessageStreamEvent> | Turn,
  onTool: (tool: Anthropic.ToolUseBlock) => void,
): Promise<Turn> {
  // Also supports non-streaming transports used by embedded hosts.
  if (!(Symbol.asyncIterator in source)) return source;
  const content: Anthropic.ContentBlock[] = [];
  const json = new Map<number, string>();
  const dispatched = new Set<number>();
  let stop_reason: Anthropic.Message['stop_reason'] = null;
  for await (const event of source) {
    if (event.type === 'content_block_start') {
      content[event.index] = structuredClone(event.content_block) as Anthropic.ContentBlock;
    } else if (event.type === 'content_block_delta') {
      const block = content[event.index];
      if (!block) throw new Error('Stream delta arrived before its content block.');
      const delta = event.delta;
      if (delta.type === 'text_delta' && block.type === 'text') block.text += delta.text;
      else if (delta.type === 'input_json_delta') {
        const raw = (json.get(event.index) ?? '') + delta.partial_json;
        if (dispatched.has(event.index) && delta.partial_json.trim()) throw new Error('A dispatched tool call changed in the stream.');
        json.set(event.index, raw);
        if (block.type === 'tool_use' && !dispatched.has(event.index)) {
          let parsed: unknown;
          try { parsed = JSON.parse(raw); } catch { /* Incomplete JSON must never execute. */ }
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            block.input = parsed;
            dispatched.add(event.index);
            onTool(structuredClone(block));
          }
        }
      }
      else if (delta.type === 'thinking_delta' && block.type === 'thinking') block.thinking += delta.thinking;
      else if (delta.type === 'signature_delta' && block.type === 'thinking') block.signature += delta.signature;
      else if (delta.type === 'citations_delta' && block.type === 'text') (block.citations ??= []).push(delta.citation);
    } else if (event.type === 'content_block_stop') {
      const block = content[event.index];
      if (block?.type === 'tool_use') {
        const raw = json.get(event.index);
        // A call with no arguments streams nothing, or one empty delta: its
        // input is the {} the block started with. Anything else must parse;
        // whitespace alone is malformed and still throws.
        if (raw) block.input = JSON.parse(raw);
        if (!dispatched.has(event.index)) { dispatched.add(event.index); onTool(block); }
      }
    } else if (event.type === 'message_delta') stop_reason = event.delta.stop_reason;
  }
  if (!stop_reason) throw new Error('The assistant stream ended before a complete turn.');
  return { content, stop_reason };
}

/** Dispatch immediately, retaining order: an active-tab mutation is a barrier. */
export class ToolDispatchQueue<T> {
  private tail: Promise<void> = Promise.resolve();
  private results = new Map<string, Promise<T>>();
  private readers: Promise<T>[] = [];
  constructor(private readonly execute: (tool: DispatchCall) => Promise<T>, private readonly serialTools = new Set<string>()) {}
  enqueue(tool: DispatchCall): Promise<T> {
    const existing = this.results.get(tool.id);
    if (existing) return existing;
    // Only operations with no active-tab/ref/presentation side effects may overlap.
    const readOnly = !this.serialTools.has(tool.name) && ['getPageMetadata', 'listLinks', 'getSelection', 'list_tabs'].includes(tool.name);
    const barrier = this.tail;
    const result = readOnly
      ? barrier.then(() => this.execute(tool))
      : Promise.allSettled([barrier, ...this.readers]).then(() => this.execute(tool));
    this.results.set(tool.id, result);
    // Observe rejection immediately: the stream may still be in flight.
    void result.catch(() => {});
    if (readOnly) this.readers.push(result);
    else {
      this.readers = [];
      this.tail = result.then(() => {}, () => {});
    }
    return result;
  }
  async settled(): Promise<void> { await Promise.allSettled(this.results.values()); }
}
