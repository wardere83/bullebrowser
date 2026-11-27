import { expect, test } from '@playwright/test';

for (const width of [390, 1280]) {
  test(`walkthrough distinguishes the browser and assistant at ${width}px`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 850 });
    await page.goto('http://127.0.0.1:4177/features/');
    const demo = page.locator('section[aria-labelledby="walkthrough-title"]');
    await expect(demo.getByText('BulleBrowser', { exact: true }).first()).toBeVisible();
    await expect(demo.getByText('Google Chrome', { exact: true })).toHaveCount(0);
    await expect(demo.getByText('Google', { exact: true })).toBeVisible();
    await expect(demo.getByRole('heading', { name: 'Your Assistant', exact: true })).toBeVisible();
    await expect(demo.getByText('Illustration — sample data, not a live listing')).toBeVisible();
    const source = demo.getByRole('button', { name: 'International Grants', exact: true });
    await expect(source.locator('svg')).toBeVisible();

    await demo.getByRole('button', { name: 'Find grants for me' }).click();
    await expect(demo.getByText('Where are you based, and what needs funding?', { exact: true }).first()).toBeVisible();
    await source.click();
    await expect(demo.getByText('Funding & tender opportunities', { exact: true }).locator('svg')).toBeVisible();
    await expect(demo.getByText('International calls checked. One is open to US nonprofits:', { exact: true })).toBeVisible({ timeout: 35_000 });
    await expect(demo.getByText('Task complete', { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
