import { beforeEach, describe, expect, it, vi } from 'vitest';
const values = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../storage/store.js', () => ({
  createStore: () => ({
    get: (key: string) => values.get(key),
    set: (key: string, value: unknown) => values.set(key, value),
  }),
}));
import {
  addConnector,
  enabledConnectors,
  listConnectors,
  removeConnector,
  setConnector,
} from './service.js';
beforeEach(() => values.clear());
describe('device connector permissions', () => {
  it('starts with every service disabled', () => {
    expect(enabledConnectors()).toEqual([]);
    expect(listConnectors().every((entry) => !entry.enabled)).toBe(true);
  });
  it('requires an explicit enable and revokes the shortcut', () => {
    setConnector('gmail', true);
    expect(enabledConnectors()).toEqual(['gmail']);
    setConnector('gmail', false);
    expect(enabledConnectors()).toEqual([]);
    expect(() => setConnector('constructor', true)).toThrow();
    expect(() => setConnector('gmail', 'yes')).toThrow();
  });
  it('adds custom services disabled and removes permission on deletion', () => {
    const entries = addConnector('My CRM', 'https://workspace.example.com/');
    const custom = entries.find((entry) => entry.custom)!;
    expect(custom.enabled).toBe(false);
    setConnector(custom.id, true);
    expect(enabledConnectors()).toContain(custom.id);
    removeConnector(custom.id);
    expect(enabledConnectors()).not.toContain(custom.id);
    expect(() => removeConnector('gmail')).toThrow();
  });
  it('fails closed for malformed persisted custom entries', () => {
    values.set('custom', [{ id: 'custom-bad', name: 'Bad', url: 'javascript:alert(1)' }]);
    values.set('enabled', ['custom-bad', 'constructor']);
    expect(enabledConnectors()).toEqual([]);
  });
});
