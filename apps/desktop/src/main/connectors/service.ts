import { randomUUID } from 'node:crypto';
import {
  CONNECTORS,
  customConnector,
  type ConnectorDefinition,
  type ConnectorState,
} from '@bullebrowser/agent-core';
import { createStore } from '../storage/store.js';

const store = createStore<{ enabled: string[]; custom: ConnectorDefinition[] }>(
  'browser-connectors',
  { enabled: [], custom: [] },
);
export function connectorCatalog(): ConnectorDefinition[] {
  const custom = store.get('custom');
  return [
    ...CONNECTORS,
    ...(Array.isArray(custom)
      ? custom
          .flatMap((entry) => {
            try {
              return entry.id?.startsWith('custom-')
                ? [customConnector(entry.id, entry.name, entry.url)]
                : [];
            } catch {
              return [];
            }
          })
          .slice(0, 50)
      : []),
  ];
}
export function enabledConnectors(): string[] {
  const enabled = store.get('enabled');
  return connectorCatalog()
    .filter((entry) => Array.isArray(enabled) && enabled.includes(entry.id))
    .map((entry) => entry.id);
}
export function listConnectors(): ConnectorState[] {
  const enabled = enabledConnectors();
  return connectorCatalog().map((entry) => ({ ...entry, enabled: enabled.includes(entry.id) }));
}
export function setConnector(id: unknown, enabled: unknown): ConnectorState[] {
  const connector = connectorCatalog().find((entry) => entry.id === id);
  if (!connector || typeof enabled !== 'boolean') throw new Error('Invalid connector permission.');
  const next = new Set(enabledConnectors());
  if (enabled) next.add(connector.id);
  else next.delete(connector.id);
  store.set('enabled', [...next]);
  return listConnectors();
}
export function addConnector(name: unknown, url: unknown): ConnectorState[] {
  const custom = connectorCatalog().filter((entry) => entry.custom);
  if (custom.length >= 50) throw new Error('Remove a custom connector before adding another.');
  const entry = customConnector(`custom-${randomUUID()}`, name, url);
  if (connectorCatalog().some((item) => item.url === entry.url))
    throw new Error('This service is already in your catalog.');
  store.set('custom', [...custom, entry]);
  return listConnectors(); // Adding a service does not enable it silently.
}
export function removeConnector(id: unknown): ConnectorState[] {
  const custom = connectorCatalog().filter((entry) => entry.custom);
  if (!custom.some((entry) => entry.id === id))
    throw new Error('Only custom connectors can be removed.');
  setConnector(id, false);
  store.set(
    'custom',
    custom.filter((entry) => entry.id !== id),
  );
  return listConnectors();
}
