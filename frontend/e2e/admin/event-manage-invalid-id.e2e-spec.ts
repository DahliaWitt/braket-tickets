import { test, expect } from '../helpers/test-setup';

test.describe('Event Manage / Edit — invalid ID guard', () => {
  test.slow();

  test('navigates to /not-found for invalid id at /community-admin/events/:id/manage', async ({
    adminPage,
  }) => {
    const errors: string[] = [];
    adminPage.on('console', (msg) => {
      errors.push(msg.text());
    });

    await adminPage.goto('/community-admin/events/NOT-AN-ID/manage');
    await adminPage.waitForURL('**/not-found', { timeout: 15000 });

    expect(errors.filter((e) => /ArgumentValidationError/i.test(e))).toHaveLength(0);
  });

  test('navigates to /not-found for invalid id at /admin/events/:id/manage', async ({
    adminPage,
  }) => {
    const errors: string[] = [];
    adminPage.on('console', (msg) => {
      errors.push(msg.text());
    });

    await adminPage.goto('/admin/events/NOT-AN-ID/manage');
    await adminPage.waitForURL('**/not-found', { timeout: 15000 });

    expect(errors.filter((e) => /ArgumentValidationError/i.test(e))).toHaveLength(0);
  });

  test('navigates to /not-found for invalid id at /admin/events/:id/edit', async ({
    adminPage,
  }) => {
    const errors: string[] = [];
    adminPage.on('console', (msg) => {
      errors.push(msg.text());
    });

    await adminPage.goto('/admin/events/NOT-AN-ID/edit');
    await adminPage.waitForURL('**/not-found', { timeout: 15000 });

    expect(errors.filter((e) => /ArgumentValidationError/i.test(e))).toHaveLength(0);
  });
});
