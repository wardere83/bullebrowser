import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BrowserTab } from './TabStrip.js';
import type { TabState } from '../../shared/ipc.js';
describe('individual tab controls', () => {
  it.each([false, true])('renders a visible keyboard-accessible X when active=%s', active => {
    const tab = { id: 'tab1', title: 'Source', url: 'https://example.org', active, loading: false } as TabState;
    const html = renderToStaticMarkup(<BrowserTab tab={tab} onDragStart={vi.fn()} onDragOver={vi.fn()} onDragEnd={vi.fn()} />);
    expect(html).toContain('aria-label="Close tab"');
    expect(html.match(/<button /g)).toHaveLength(2);
    expect(html).not.toContain('opacity-0');
    expect(html).toContain('w-[180px] shrink-0');
    expect(html.indexOf('</button>')).toBeLessThan(html.indexOf('aria-label="Close tab"'));
  });
});
