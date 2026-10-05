import { colors } from '@bullebrowser/brand-tokens';

export const BROWSING_CLOUD_ID = '__bb_browsing_cloud__';

// The browser page is a native view above the app renderer. Draw this small,
// decorative layer inside its document, with styles isolated from the site.
// Each wisp stays near an edge so the page itself remains easy to read.
const CLOUD_CSS = `
  :host {
    all: initial;
    display: block !important;
    position: fixed !important;
    inset: 0 !important;
    width: 100% !important;
    height: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    background: transparent !important;
    box-shadow: none !important;
    outline: 0 !important;
    transform: none !important;
    filter: none !important;
    backdrop-filter: none !important;
    mix-blend-mode: normal !important;
    overflow: hidden !important;
    pointer-events: none !important;
    z-index: 2147483646 !important;
    isolation: isolate !important;
    contain: strict !important;
    animation: bb-cloud-breathe 8s ease-in-out infinite alternate !important;
    will-change: opacity !important;
  }
  *, *::before, *::after {
    box-sizing: border-box;
    pointer-events: none !important;
  }
  .edge {
    position: absolute;
    inset: 0;
    border: 1px solid ${colors.primary}70;
    box-shadow: inset 0 0 18px ${colors.primary}38;
  }
  .cloud {
    position: absolute;
    filter: blur(24px);
    opacity: .76;
    will-change: transform;
  }
  .top {
    top: -132px;
    left: -6%;
    width: 112%;
    height: 192px;
    background:
      radial-gradient(ellipse 28% 70% at 16% 66%, ${colors.primary}E6 8%, transparent 76%),
      radial-gradient(ellipse 25% 66% at 51% 49%, ${colors.accent}D9 4%, transparent 76%),
      radial-gradient(ellipse 30% 78% at 86% 64%, ${colors.primary}D9 4%, transparent 78%),
      radial-gradient(ellipse 60% 65% at 50% 25%, ${colors.surfaceDark}A6, transparent 80%);
    animation: bb-cloud-horizontal 11s ease-in-out infinite alternate;
  }
  .bottom {
    bottom: -126px;
    left: -6%;
    width: 112%;
    height: 184px;
    background:
      radial-gradient(ellipse 32% 72% at 19% 36%, ${colors.accent}C7 4%, transparent 76%),
      radial-gradient(ellipse 31% 84% at 69% 42%, ${colors.primary}E6 8%, transparent 78%),
      radial-gradient(ellipse 62% 62% at 50% 76%, ${colors.surfaceDark}99, transparent 82%);
    animation: bb-cloud-horizontal 14s ease-in-out -5s infinite alternate-reverse;
  }
  .left {
    top: -7%;
    left: -108px;
    width: 152px;
    height: 114%;
    background:
      radial-gradient(ellipse 82% 32% at 60% 20%, ${colors.primary}D9 4%, transparent 78%),
      radial-gradient(ellipse 76% 27% at 43% 72%, ${colors.accent}B3 4%, transparent 80%),
      radial-gradient(ellipse 54% 64% at 12% 50%, ${colors.surfaceDark}99, transparent 80%);
    animation: bb-cloud-vertical 13s ease-in-out -3s infinite alternate;
  }
  .right {
    top: -7%;
    right: -108px;
    width: 152px;
    height: 114%;
    background:
      radial-gradient(ellipse 82% 32% at 38% 76%, ${colors.primary}E6 4%, transparent 78%),
      radial-gradient(ellipse 78% 28% at 59% 23%, ${colors.accent}C7 4%, transparent 80%),
      radial-gradient(ellipse 54% 64% at 87% 50%, ${colors.surfaceDark}99, transparent 80%);
    animation: bb-cloud-vertical 12s ease-in-out -7s infinite alternate-reverse;
  }
  @keyframes bb-cloud-breathe {
    from { opacity: .76; }
    to { opacity: 1; }
  }
  @keyframes bb-cloud-horizontal {
    from { transform: translate3d(-22px, -5px, 0) scaleX(.98); }
    to { transform: translate3d(22px, 7px, 0) scaleX(1.03); }
  }
  @keyframes bb-cloud-vertical {
    from { transform: translate3d(-4px, -24px, 0) scaleY(.98); }
    to { transform: translate3d(6px, 24px, 0) scaleY(1.03); }
  }
  @media (prefers-reduced-motion: reduce) {
    :host { animation: none !important; will-change: auto !important; }
    .cloud { animation: none; will-change: auto; }
  }
`;

/** Idempotent decoration; a failed effect must never interrupt browsing. */
export function browsingCloudScript(active: boolean, revision = 0): string {
  return `(() => {
    try {
      const revisionKey = Symbol.for('bullebrowser.browsingCloudRevision');
      const revision = ${JSON.stringify(revision)};
      const previousRevision = window[revisionKey];
      if (typeof previousRevision === 'number' && revision < previousRevision) return;
      // Record removals too: an older queued install cannot revive a stopped run.
      window[revisionKey] = revision;
      const id = ${JSON.stringify(BROWSING_CLOUD_ID)};
      const existing = document.getElementById(id);
      if (!${JSON.stringify(active)}) {
        if (existing) existing.remove();
        return;
      }
      if (existing || !document.documentElement) return;
      // Constructed sheets also work on sites that disallow inline styles.
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(${JSON.stringify(CLOUD_CSS)});
      const host = document.createElement('div');
      host.id = id;
      host.setAttribute('aria-hidden', 'true');
      host.setAttribute('role', 'presentation');
      host.inert = true;
      const root = host.attachShadow({ mode: 'closed' });
      root.adoptedStyleSheets = [sheet];
      for (const className of ${JSON.stringify(['edge', 'cloud top', 'cloud bottom', 'cloud left', 'cloud right'])}) {
        const layer = document.createElement('div');
        layer.className = className;
        root.appendChild(layer);
      }
      document.documentElement.appendChild(host);
    } catch (_) {
      // Decoration is optional on a document that cannot host HTML elements.
    }
  })();`;
}
