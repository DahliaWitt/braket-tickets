import { test, expect } from '../helpers/test-setup';

/**
 * BRA-353: /admin/reminders was removed in PR #661 but previously caused a hard
 * 404 instead of a graceful redirect. Verify the route now redirects to /admin
 * rather than landing on /not-found.
 */
test.describe('Admin reminders route redirect (BRA-353)', () => {
  test('navigating to /admin/reminders redirects to /admin/communities, not /not-found', async ({
    adminPage,
  }) => {
    await adminPage.goto('/admin/reminders');
    await adminPage.waitForURL('**/admin/communities', { timeout: 10000 });

    await expect(adminPage).not.toHaveURL(/not-found/);
    await expect(adminPage.getByRole('heading', { name: 'Communities' }).first()).toBeVisible({
      timeout: 10000,
    });
  });
});
