// Startpage pays for its free search with sponsored results: Google ad frames
// above and below the results (#gcsa-top, #gcsa-bottom), and cards promoting
// its paid ad-free plan. BulleBrowser hides them on Startpage's pages, for the
// agent's searches and the person's own alike, so every user sees the same
// clean results page. The results themselves are untouched.

const STARTPAGE = /(^|\.)startpage\.com$/i;

export const STARTPAGE_AD_CSS =
  '#gcsa-top, #gcsa-bottom, .gcsa-container, .ad-free-promo-card, .go-ad-free-button-wrapper ' +
  '{ display: none !important; }';

/** The style that hides a page's ads, or null for a page that has none to hide. */
export function adHidingCss(url: string): string | null {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' && STARTPAGE.test(hostname) ? STARTPAGE_AD_CSS : null;
  } catch {
    return null;
  }
}
