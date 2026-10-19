import { describe, expect, it, vi } from 'vitest';
import { CONNECTORS, connectorTools, normalizeConnectors, type ConnectorId } from './connectors.js';

function harness() {
  let enabled: ConnectorId[] = ['google-drive'];
  const host = {
    enabled: async () => enabled,
    authorize: vi.fn(async () => true),
    open: vi.fn(async (_id: ConnectorId, url: string) => ({
      id: 'tab',
      url,
      title: 'Drive',
      active: true,
    })),
  };
  return {
    host,
    set: (next: ConnectorId[]) => {
      enabled = next;
    },
    tools: connectorTools(host),
  };
}
describe('browser connectors', () => {
  it('defaults off and rejects unknown or inherited identifiers', () => {
    expect(normalizeConnectors(null)).toEqual([]);
    expect(normalizeConnectors(['constructor', 'gmail', 'gmail', 'unknown'])).toEqual(['gmail']);
    expect(CONNECTORS.every((entry) => new URL(entry.url).protocol === 'https:')).toBe(true);
  });
  it('lists only enabled services without claiming an authenticated account', async () => {
    const h = harness();
    expect(await h.tools[0]!.execute({})).toEqual([
      {
        id: 'google-drive',
        name: 'Google Drive',
        mode: 'browser',
        authentication: 'sign in in the browser if needed',
      },
    ]);
  });
  it('does not open disabled services or arbitrary URLs', async () => {
    const h = harness();
    await expect(h.tools[1]!.execute({ id: 'gmail', url: 'https://evil.test' })).rejects.toThrow(
      'Enable',
    );
    expect(h.host.open).not.toHaveBeenCalled();
  });
  it('requires browsing consent and rechecks revocation after the prompt', async () => {
    const h = harness();
    h.host.authorize.mockImplementation(async () => {
      h.set([]);
      return true;
    });
    await expect(h.tools[1]!.execute({ id: 'google-drive' })).rejects.toThrow('revoked');
    expect(h.host.open).not.toHaveBeenCalled();
  });
  it('opens only the catalog destination after consent', async () => {
    const h = harness();
    await h.tools[1]!.execute({ id: 'google-drive' });
    expect(h.host.authorize).toHaveBeenCalledOnce();
    expect(h.host.open).toHaveBeenCalledWith('google-drive', CONNECTORS[0].url);
    h.host.authorize.mockResolvedValue(false);
    await expect(h.tools[1]!.execute({ id: 'google-drive' })).rejects.toThrow('declined');
  });
});

describe('custom service validation', () => {
  it('rejects unsafe URLs, credentials and local/private endpoints', async () => {
    const { customConnector } = await import('./connectors.js');
    for (const url of [
      'javascript:alert(1)',
      'http://example.com',
      'https://user:password@example.com',
      'https://127.0.0.1',
      'https://127.1',
      'https://[::1]',
      'https://service.local',
      'https://example.com:8443',
    ]) {
      expect(() => customConnector('custom-1', 'Service', url)).toThrow();
    }
    expect(
      customConnector('custom-1', ' Service ', 'https://service.example.com/home#section').url,
    ).toBe('https://service.example.com/home');
  });
  it('resolves newly enabled custom entries using the live catalog', async () => {
    const open = vi.fn(async (_id: string, url: string) => ({
      id: 'custom-tab',
      url,
      title: 'Service',
      active: true,
    }));
    const tools = connectorTools({
      enabled: async () => ['custom-1'],
      catalog: async () => [
        {
          id: 'custom-1',
          name: 'Service',
          url: 'https://service.example.com/',
          description: 'Custom',
        },
      ],
      authorize: async () => true,
      open,
    });
    await tools[1]!.execute({ id: 'custom-1' });
    expect(open).toHaveBeenCalledWith('custom-1', 'https://service.example.com/');
  });
});
