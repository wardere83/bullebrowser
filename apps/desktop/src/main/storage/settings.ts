import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/ipc.js';
import { createStore } from './store.js';

const store = createStore<AppSettings & Record<string, unknown>>(
  'settings',
  DEFAULT_SETTINGS as AppSettings & Record<string, unknown>,
);

export function getSettings(): AppSettings {
  const storedSearchProvider = store.get('searchProvider') as string | undefined;
  const storedHomepageUrl = store.get('homepageUrl') as string | undefined;

  const allowedSearchProviders: AppSettings['searchProvider'][] = [
    'bullebrowser',
    'google',
    'bing',
  ];

  const resolvedSearchProvider = allowedSearchProviders.includes(
    storedSearchProvider as AppSettings['searchProvider'],
  )
    ? (storedSearchProvider as AppSettings['searchProvider'])
    : DEFAULT_SETTINGS.searchProvider;

  // Old defaults from earlier versions that we migrate silently to the
  // current default (bullebrowser.com). Users who explicitly changed
  // their homepage to something else keep their choice.
  const LEGACY_DEFAULTS = new Set([
    'https://bullebrowser.com',
    'https://bullebrowser.com/',
    'https://bullebrowser.com/preview',
    'https://duckduckgo.com',
    'https://duckduckgo.com/',
  ]);
  const normalizedHomepageUrl =
    !storedHomepageUrl?.trim() || LEGACY_DEFAULTS.has(storedHomepageUrl)
      ? DEFAULT_SETTINGS.homepageUrl
      : storedHomepageUrl;

  return {
    defaultModel: store.get('defaultModel'),
    aiPanelOpen: store.get('aiPanelOpen'),
    searchProvider: resolvedSearchProvider,
    homepageUrl: normalizedHomepageUrl ?? DEFAULT_SETTINGS.homepageUrl,
    complianceChecklist: store.get('complianceChecklist'),
    autoDismissConsent: (store.get('autoDismissConsent') as boolean | undefined) ?? DEFAULT_SETTINGS.autoDismissConsent,
    stepBudget: clampBudget(store.get('stepBudget') as number | undefined),
  };
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) {
      (store as unknown as { set: (k: string, v: unknown) => void }).set(k, v);
    }
  }
  return getSettings();
}

function clampBudget(v: number | undefined): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_SETTINGS.stepBudget;
  return Math.max(5, Math.min(200, Math.round(v)));
}
