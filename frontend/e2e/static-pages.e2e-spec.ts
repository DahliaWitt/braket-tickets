import { test, expect } from './helpers/test-setup';

test.describe('Static Pages', () => {
  test('support page should load', async ({ page }) => {
    await page.goto('/support');
    // Verify support-specific heading is visible
    await expect(page.getByRole('heading', { name: /need help/i })).toBeVisible({ timeout: 10000 });
  });

  test('privacy policy page should load', async ({ page }) => {
    await page.goto('/privacy');
    // Verify privacy-specific heading is visible
    await expect(page.getByRole('heading', { name: 'Privacy Policy', exact: true })).toBeVisible({
      timeout: 10000,
    });
  });

  test('terms of service page should load', async ({ page }) => {
    await page.goto('/terms');
    // Verify terms-specific heading is visible
    await expect(page.getByRole('heading', { name: 'Terms of Service', exact: true })).toBeVisible({
      timeout: 10000,
    });
  });
});
