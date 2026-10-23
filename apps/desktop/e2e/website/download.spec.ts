import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const evidence = (name: string) => fileURLToPath(new URL(`../../../../docs/mobile/evidence/${name}`, import.meta.url));

test('website presents truthful mobile availability without fake store links', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto('http://127.0.0.1:4177/download/');
  const mobile = page.getByRole('region', { name: 'BulleBrowser on mobile' });
  await expect(mobile.getByText('iOS · iPhone & iPad', { exact: true })).toBeVisible();
  await expect(mobile.getByText('Android', { exact: true })).toBeVisible();
  await expect(mobile.getByText('Coming soon', { exact: true })).toHaveCount(2);
  await expect(mobile.getByRole('link')).toHaveCount(0);
  await mobile.scrollIntoViewIfNeeded();
  await page.screenshot({ path: evidence('download-options.png') });
});
