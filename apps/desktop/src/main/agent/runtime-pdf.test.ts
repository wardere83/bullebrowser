import { beforeEach, describe, expect, it, vi } from 'vitest';

const { wc, extractDocumentBytes } = vi.hoisted(() => ({
  wc: {
    isDestroyed: () => false,
    getURL: vi.fn(() => 'https://grants.example.org/files/rfp.pdf'),
    getTitle: () => 'rfp.pdf',
    executeJavaScript: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    session: { fetch: vi.fn() },
  },
  extractDocumentBytes: vi.fn(),
}));
vi.mock('../tabs/manager.js', () => ({ tabManager: { getView: () => ({ webContents: wc }), getNavigationUrl: () => null } }));
vi.mock('../documents/host.js', () => ({ extractDocumentBytes }));
vi.mock('../storage/site-permissions.js', () => ({
  originOf: (u: string) => { try { return new URL(u).origin; } catch { return ''; } },
  sitePermissions: { get: () => undefined, set: vi.fn(), isAllowed: () => true },
}));
vi.mock('../storage/settings.js', () => ({ getSettings: () => ({ browsingPace: 'natural' }) }));

import { DesktopToolRuntime, isPdfAddress } from './runtime.js';

const page = { format: 'pdf', pageCount: 1, wordCount: 4, warnings: [],
  blocks: [{ id: 'b0001', kind: 'paragraph', text: 'Applications close March 10.', page: 1, section: '', headingLevel: null }] };

describe('reading a PDF in a tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wc.getURL.mockReturnValue('https://grants.example.org/files/rfp.pdf');
    wc.session.fetch.mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array([37, 80, 68, 70]).buffer });
    extractDocumentBytes.mockResolvedValue(page);
  });

  it('reads the PDF the tab shows, with its page markers', async () => {
    const runtime = new DesktopToolRuntime(vi.fn() as never);
    const result = await runtime.readPage('tab-1');
    expect(wc.session.fetch).toHaveBeenCalledWith('https://grants.example.org/files/rfp.pdf');
    expect(result).toEqual({ title: 'rfp.pdf', url: 'https://grants.example.org/files/rfp.pdf', text: '[Page 1]\nApplications close March 10.' });
  });

  it('explains a PDF that could not be downloaded', async () => {
    wc.session.fetch.mockResolvedValue({ ok: false, status: 403 });
    const runtime = new DesktopToolRuntime(vi.fn() as never);
    await expect(runtime.readPage('tab-1')).rejects.toThrow('could not be downloaded');
  });

  it('recognizes PDF addresses by their path only', () => {
    expect(isPdfAddress('https://a.org/x/Guide.PDF?download=1')).toBe(true);
    expect(isPdfAddress('https://a.org/search?q=file.pdf')).toBe(false);
    expect(isPdfAddress('not a url')).toBe(false);
  });
});
