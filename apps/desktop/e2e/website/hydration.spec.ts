import { expect, test } from '@playwright/test';

// The site is exported once and then served for months. A visitor whose clock
// is in a later year than the build must still get pages that hydrate.
for (const path of ['/', '/download/', '/privacy/']) {
  test(`${path} hydrates in a year after the build`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install({ time: new Date('2099-06-01T12:00:00Z') });
    await page.goto(`http://127.0.0.1:4177${path}`);
    await expect(page.getByRole('contentinfo')).toContainText('© 2099 Bulle Consulting.');
    expect(errors.filter((text) => /React error #4(18|19|21|22|23|25)|hydrat/i.test(text))).toEqual([]);
  });
}
