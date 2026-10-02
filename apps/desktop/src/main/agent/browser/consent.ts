// Cookie banners and consent walls.
//
// Many sites open behind a consent banner that covers the page; the agent
// used to spend calls dismissing it, or fail because nothing underneath was
// interactable yet. After a page settles we look for the common consent
// platforms (OneTrust, TrustArc, Cookiebot, Didomi, Quantcast Choice) and
// press their least-permissive option — reject all / necessary only — falling
// back to the banner's accept button only when it offers nothing narrower.
// What happened is reported in the tool result so the agent knows.

import type { WebContents } from 'electron';
import { getSettings } from '../../storage/settings.js';

export interface ConsentResult {
  cmp: string;
  choice: string;
  narrowest: boolean;
}

// Runs in the page (main frame, or a consent iframe). Returns what it pressed.
const DISMISS = String.raw`
(function () {
  var visible = function (el) {
    if (!el) return false;
    var r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  };
  var first = function (sels, guard) {
    for (var i = 0; i < sels.length; i++) {
      var list = document.querySelectorAll(sels[i]);
      for (var j = 0; j < list.length; j++) {
        var el = list[j];
        if (visible(el) && (!guard || guard(el))) return el;
      }
    }
    return null;
  };
  var label = function (el) { return (el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim(); };
  var notSettings = function (el) { return !/more options|settings|manage|customi[sz]e|preferences|learn more/i.test(label(el)); };
  var isNarrow = function (el) { return /reject|decline|disagree|refuse|deny|necessary|essential|required|without/i.test(label(el)); };
  var CMPS = [
    { name: 'OneTrust', box: '#onetrust-banner-sdk, #onetrust-consent-sdk .ot-sdk-container',
      narrow: ['#onetrust-reject-all-handler', '.ot-pc-refuse-all-handler', '#onetrust-banner-sdk button.ot-pc-refuse-all-handler'],
      accept: ['#onetrust-accept-btn-handler'] },
    { name: 'Cookiebot', box: '#CybotCookiebotDialog',
      narrow: ['#CybotCookiebotDialogBodyButtonDecline', '#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll'],
      accept: ['#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowallSelection', '#CybotCookiebotDialogBodyButtonAccept', '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll'] },
    { name: 'Didomi', box: '#didomi-notice, #didomi-popup, #didomi-host .didomi-popup-container',
      narrow: ['#didomi-notice-disagree-button', '.didomi-continue-without-agreeing', 'button[aria-label*="Disagree"]'],
      accept: ['#didomi-notice-agree-button'] },
    { name: 'TrustArc', box: '#truste-consent-track, #truste-consent-content, .truste_box_overlay, #consent_blackbar',
      narrow: ['#truste-consent-required', '.truste-consent-required', 'a.required', 'button.required'],
      accept: ['#truste-consent-button', '.truste-button1', 'a.call'] },
    { name: 'Quantcast Choice', box: '#qc-cmp2-ui, .qc-cmp2-container',
      narrow: ['#qc-cmp2-ui button[mode="secondary"]', '.qc-cmp2-summary-buttons button[mode="secondary"]'],
      accept: ['#qc-cmp2-ui button[mode="primary"]', '.qc-cmp2-summary-buttons button[mode="primary"]'] },
  ];
  // A TrustArc banner served in its own frame (consent-pref.trustarc.com).
  if (/trustarc\.com/.test(location.host)) {
    CMPS.push({ name: 'TrustArc', box: 'body', narrow: ['.pdynamicbutton .required', 'a.required', 'button.required'], accept: ['.pdynamicbutton .call', 'a.call', 'button.call'] });
  }
  for (var i = 0; i < CMPS.length; i++) {
    var c = CMPS[i];
    var box = first(c.box.split(', '));
    if (!box) continue;
    var btn = first(c.narrow, function (el) { return notSettings(el) && isNarrow(el); });
    var narrowest = !!btn;
    if (!btn) btn = first(c.accept, notSettings);
    if (!btn) continue;
    var choice = label(btn) || (narrowest ? 'Reject' : 'Accept');
    btn.click();
    return { cmp: c.name, choice: choice.slice(0, 60), narrowest: narrowest };
  }
  return null;
})()`;

const CONSENT_FRAME_HOSTS = /trustarc\.com|consensu\.org|privacy-mgmt\.com|cookiebot\.com|didomi\.io/;

// Look once, press once, report. Never throws.
export async function dismissConsent(wc: WebContents): Promise<ConsentResult | null> {
  if (wc.isDestroyed() || getSettings().autoDismissConsent === false) return null;
  const frames = [
    wc.mainFrame,
    ...wc.mainFrame.framesInSubtree.filter((f) => {
      try {
        return f !== wc.mainFrame && !f.detached && CONSENT_FRAME_HOSTS.test(f.url);
      } catch {
        return false;
      }
    }),
  ];
  for (const frame of frames) {
    try {
      const hit = (await Promise.race([
        frame.executeJavaScript(DISMISS, true),
        new Promise((r) => setTimeout(() => r(null), 3_000)),
      ])) as ConsentResult | null;
      if (hit) {
        // Let the banner close and the page underneath become interactive.
        await new Promise((r) => setTimeout(r, 400));
        return hit;
      }
    } catch {
      /* frame went away — nothing to dismiss there */
    }
  }
  return null;
}

export function describeConsent(r: ConsentResult): string {
  return r.narrowest
    ? `Dismissed the ${r.cmp} cookie banner by choosing "${r.choice}" (the least permissive option).`
    : `Dismissed the ${r.cmp} cookie banner by choosing "${r.choice}" — it offered no reject or necessary-only option.`;
}
