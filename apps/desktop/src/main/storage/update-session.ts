import { createStore } from './store.js';
import { isBlockedDestination } from '@bullebrowser/agent-core';

export interface UpdateTabSession { urls: string[]; activeIndex: number }
const store = createStore<{ session: UpdateTabSession | null }>('update-session', { session: null });

export function saveUpdateTabs(tabs: Array<{ url: string; active: boolean }>): void {
  store.set('session', { urls: tabs.map((tab) => tab.url), activeIndex: Math.max(0, tabs.findIndex((tab) => tab.active)) });
}

export function takeUpdateTabs(): UpdateTabSession | null {
  const session = store.get('session');
  store.set('session', null);
  if (!session || !Array.isArray(session.urls)) return null;
  const urls = session.urls.filter((url) => typeof url === 'string' &&
    (url === 'about:blank' || /^https?:\/\//i.test(url)) && !isBlockedDestination(url));
  return { urls, activeIndex: Math.max(0, urls.indexOf(session.urls[session.activeIndex] ?? '')) };
}
