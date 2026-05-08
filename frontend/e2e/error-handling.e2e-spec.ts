import { test, expect } from './helpers/test-setup';

test.describe('Chaos & Error Handling', () => {
  test('should handle network offline gracefully', async ({ page, context }) => {
    await page.goto('/');
    // Wait for app to fully render (main content visible) before going offline
    await expect(page.locator('#main-content')).toBeVisible({ timeout: 15000 });

    // Simulate browser offline state (triggers window:offline event)
    await context.setOffline(true);

    // Expect the Offline Banner to appear
    // TODO: Add data-testid="offline-banner" to offline indicator component
    await expect(page.getByText('No Internet Connection')).toBeVisible({ timeout: 10000 });

    // Ensure the main content is still visible (no crash)
    await expect(page.locator('#main-content')).toBeVisible();

    // Restore online state
    await context.setOffline(false);
    // TODO: Add data-testid="offline-banner" to offline indicator component
    await expect(page.getByText('No Internet Connection')).toBeHidden({ timeout: 10000 });
  });

  test('should handle 500 server errors on key queries', async ({ page }) => {
    await page.goto('/');

    // Mock 500 error specifically on queries
    await page.route('**/api/runQuery', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'InternalServerError', message: 'Simulated 500' }),
      });
    });

    // Intentional: route mock registered after initial load — reload applies mock to first query execution
    await page.reload();

    // App should remain usable and not crash even when key queries fail.
    await expect(page.locator('#main-content')).toBeVisible({ timeout: 10000 });
  });
});
