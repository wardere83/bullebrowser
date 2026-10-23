import type { WebContents } from 'electron';
import {
  ACCESSIBILITY_STYLES,
  accessibilityZoom,
  normalizeAccessibility,
  type AccessibilityPreferences,
} from '../shared/accessibility.js';

class AccessibilityManager {
  private preferences = normalizeAccessibility(undefined);
  private pages = new Map<WebContents, { key?: string; pending: Promise<void> }>();

  register(wc: WebContents, preferences: unknown) {
    this.preferences = normalizeAccessibility(preferences);
    if (this.pages.has(wc)) return;
    this.pages.set(wc, { pending: Promise.resolve() });
    wc.on('dom-ready', () => {
      void this.refresh(wc);
    });
    wc.once('destroyed', () => this.pages.delete(wc));
  }

  async apply(preferences: AccessibilityPreferences) {
    this.preferences = normalizeAccessibility(preferences);
    await Promise.all([...this.pages.keys()].map((wc) => this.refresh(wc)));
  }

  private refresh(wc: WebContents): Promise<void> {
    const state = this.pages.get(wc);
    if (!state) return Promise.resolve();
    // Serial updates prevent a slower previous selection overriding a new one.
    state.pending = state.pending
      .then(async () => {
        if (wc.isDestroyed()) return;
        const p = this.preferences;
        wc.setZoomFactor(accessibilityZoom(p));
        if (state.key) await wc.removeInsertedCSS(state.key).catch(() => {});
        state.key = undefined;
        state.key = await wc.insertCSS(ACCESSIBILITY_STYLES, { cssOrigin: 'user' });
        await wc
          .executeJavaScript(
            `(() => {
          const flags = ${JSON.stringify({ contrast: p.contrast, 'underline-links': p.underlineLinks, 'text-spacing': p.textSpacing, 'reading-font': p.readingFont, 'reduce-motion': p.motion === 'reduce' })};
          for (const [name, enabled] of Object.entries(flags)) document.documentElement.toggleAttribute('data-bb-' + name, enabled);
          window.__bbReduceMotion = ${p.motion === 'reduce'};
          document.getElementById('__bb_browsing_cloud__')?.toggleAttribute('data-reduce-motion', window.__bbReduceMotion);
          const cursor = document.getElementById('__bb_agent_cursor__')?.shadowRoot;
          if (cursor) cursor.querySelectorAll('*').forEach(element => {
            element.style.transition = window.__bbReduceMotion ? 'none' : '';
            element.style.animation = window.__bbReduceMotion ? 'none' : '';
          });
          if (window.__bbReduceMotion) document.querySelectorAll('video').forEach(video => video.pause());
        })()`,
          )
          .catch(() => {});
      })
      .catch(() => {
        /* A navigating or closed page is retried at dom-ready. */
      });
    return state.pending;
  }
}

export const accessibilityManager = new AccessibilityManager();
