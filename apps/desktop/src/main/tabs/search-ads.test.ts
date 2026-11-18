import { describe, expect, it } from 'vitest';
import { adHidingCss, STARTPAGE_AD_CSS } from './search-ads.js';

describe('adHidingCss', () => {
  it('hides the ad frames and ad-free upsell on Startpage', () => {
    for (const url of ['https://www.startpage.com/do/search?q=grants', 'https://startpage.com/sp/search', 'https://eu.startpage.com/']) {
      expect(adHidingCss(url)).toBe(STARTPAGE_AD_CSS);
    }
    for (const selector of ['#gcsa-top', '#gcsa-bottom', '.ad-free-promo-card', '.go-ad-free-button-wrapper']) {
      expect(STARTPAGE_AD_CSS).toContain(selector);
    }
    expect(STARTPAGE_AD_CSS).toContain('display: none !important');
  });

  it('leaves every other page alone, including look-alike hosts', () => {
    for (const url of ['https://www.bing.com/search?q=x', 'https://notstartpage.com/', 'https://startpage.com.evil.example/',
      'http://www.startpage.com/', 'about:blank', 'not a url']) {
      expect(adHidingCss(url)).toBeNull();
    }
  });
});
