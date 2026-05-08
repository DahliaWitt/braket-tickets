import { test, expect } from '../helpers/test-setup';
import { waitForAuthenticatedDashboard } from '../test-utils/auth-helpers';

test.describe('Security & RLS Enforcement', () => {
  // Extended timeout: auth redirects may be slow on first load
  test.setTimeout(60000);

  test.describe('Unauthenticated Access', () => {
    test('should redirect unauthenticated user from /admin to /login', async ({ page }) => {
      await page.goto('/admin');
      // Angular router guard runs client-side and needs time to bootstrap before redirecting
      await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
    });

    test('should redirect unauthenticated user from /tickets to /login', async ({ page }) => {
      await page.goto('/tickets');
      await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
    });

    test('should redirect /dashboard to home', async ({ page }) => {
      await page.goto('/dashboard');
      // /dashboard redirectTo:'/' renders landing for unauthenticated users.
      // Playwright regex matches full URL, so verify NOT on /dashboard and landing is visible.
      await expect(page).not.toHaveURL(/\/dashboard/, { timeout: 15000 });
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Unauthorized Logic (Regular User)', () => {
    // authedPage provides a fresh page context per test — shared user but isolated navigation state
    test('should prevent regular user from accessing admin dashboard', async ({ authedPage }) => {
      // authedPage creates a standard fresh user (unvetted, not admin)
      await authedPage.goto('/admin');

      // Expectation: Redirected to home
      await waitForAuthenticatedDashboard(authedPage);

      // Ensure we are NOT on admin
      await expect(authedPage).not.toHaveURL(/\/admin/, { timeout: 10000 });
    });

    // Test specific sub-routes
    test('should prevent regular user from accessing admin organizers', async ({ authedPage }) => {
      await authedPage.goto('/admin/organizers');
      await expect(authedPage).not.toHaveURL(/\/admin\/organizers/, { timeout: 10000 });
      await expect(authedPage).toHaveURL(/(^\/$|\/not-found)/);
    });
  });
});
