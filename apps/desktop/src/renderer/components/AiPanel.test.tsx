import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// AiPanel reads the platform when it loads; Node 20 has no navigator.
vi.hoisted(() => {
  if (!('navigator' in globalThis)) Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'test' }, configurable: true });
});
const { HistoryList, queueCanDrain } = await import('./AiPanel.js');

describe('the task queue', () => {
  it('runs the next queued task after a task fails, as after one that finished', () => {
    // A failed run leaves status "error". The queue only drained on "idle",
    // so every queued task (and every later prompt, queued behind them) waited forever.
    expect(queueCanDrain('error', 1)).toBe(true);
    expect(queueCanDrain('idle', 1)).toBe(true);
  });

  it('waits while a task runs, and does nothing with an empty queue', () => {
    expect(queueCanDrain('running', 2)).toBe(false);
    expect(queueCanDrain('idle', 0)).toBe(false);
    expect(queueCanDrain('error', 0)).toBe(false);
  });
});

describe('chat history', () => {
  it('shows the delete control when it has keyboard focus, and labels it', () => {
    const html = renderToStaticMarkup(
      <HistoryList
        conversations={[{ id: 'c1', title: 'Arts grants', updatedAt: 1 } as never]}
        currentId="c1"
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDeleteAll={vi.fn()}
        busy={false}
        onClose={vi.fn()}
      />,
    );
    const button = /<button[^>]*title="Delete chat"[^>]*>/.exec(html)?.[0] ?? '';
    expect(button).toContain('opacity-0');
    expect(button).toContain('focus-visible:opacity-100');
    expect(button).toContain('aria-label="Delete chat"');
  });
});
