import { beforeEach, describe, expect, it } from 'vitest';
import { chromeCoversPageSelector, useBrowserStore } from './browser-store.js';

describe('chrome drawn over the page', () => {
  beforeEach(() => {
    useBrowserStore.setState({
      showUpdates: false, showSettings: false, showAbout: false, showAccessibility: false, profileMenuOpen: false,
    });
  });

  it('includes the top bar menu, which hangs into the page area', () => {
    // The menu drops below the 80px of chrome; the native page view covered
    // its About and Quit items unless main hides the page while it is open.
    expect(chromeCoversPageSelector(useBrowserStore.getState())).toBe(false);
    useBrowserStore.getState().setProfileMenuOpen(true);
    expect(chromeCoversPageSelector(useBrowserStore.getState())).toBe(true);
  });

  it.each(['showUpdates', 'showSettings', 'showAbout', 'showAccessibility'] as const)('includes %s', (key) => {
    useBrowserStore.setState({ [key]: true });
    expect(chromeCoversPageSelector(useBrowserStore.getState())).toBe(true);
  });
});
