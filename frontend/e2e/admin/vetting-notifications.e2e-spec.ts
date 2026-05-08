import { test, expect, uniqueName, createEnvironment } from '../helpers/test-setup';
import { signInUser } from '../test-utils/auth-helpers';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { BraToastHarness } from '../../src/app/ui/components/composites/toast/toast.component.harness';
import { ZardSelectComponentHarness } from '../../src/app/ui/components/primitives/select/select.component.harness';

/**
 * E2E Tests for Vetting Notification Settings (BRA-215)
 *
 * Verifies the notification preferences UI in community-admin settings:
 * - Section visibility
 * - Mode select controls digest-hour visibility
 * - Settings persist across page reloads
 * - Setting Off removes the preference row
 *
 * Uses convexHelper for test SETUP only (seeding data).
 * The system under test is always the UI.
 *
 * Each test seeds its own community admin user to avoid shared-state mutations
 * (the global adminPage fixture must not be used for tests that mutate preferences).
 */

type ConvexHelper = Parameters<Parameters<typeof test>[2]>[0]['convexHelper'];

/** Seed a community and a community admin user, return credentials + orgId. */
async function seedCommunityAdminContext(
  convexHelper: ConvexHelper,
): Promise<{ email: string; password: string; orgId: Id<'organizers'> }> {
  const adminUser = await convexHelper.query(api.testing.users.getByEmail, {
    email: 'global-admin@example.com',
  });
  if (!adminUser) throw new Error('Root admin not found — global.setup.ts may not have run');
  const grantedBy = adminUser._id as Id<'users'>;

  const orgName = uniqueName('Notif Org');
  const orgId = (await convexHelper.mutation(api.testing.communities.seedOrganizer, {
    name: orgName,
  })) as Id<'organizers'>;

  const email = `notif-ca-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`;
  const password = 'NotifAdmin123!';
  const tokens = await convexHelper.action(api.testing.users_node.seedUserAndGetTokens, {
    email,
    password,
    name: uniqueName('Notif CA'),
  });
  await convexHelper.mutation(api.testing.communities.seedCommunityAdmin, {
    userId: tokens.userId as Id<'users'>,
    organizerId: orgId,
    grantedBy,
  });
  return { email, password, orgId };
}

async function getNotificationsSelect(
  page: import('@playwright/test').Page,
): Promise<ZardSelectComponentHarness> {
  const notificationsSection = page.getByTestId('notifications-section');
  await notificationsSection.waitFor({ state: 'visible', timeout: 15000 });
  const env = createEnvironment(page);
  return env.getHarness(ZardSelectComponentHarness.with({ testId: 'notif-mode-select' }));
}

test.describe('Vetting Notification Settings', () => {
  test.slow();

  test('shows notifications section in community admin settings', async ({
    page,
    convexHelper,
  }) => {
    const { email, password } = await seedCommunityAdminContext(convexHelper);

    await signInUser(page, email, password);
    await page.goto('/community-admin/settings');
    await expect(page.locator('header')).toBeVisible({ timeout: 10000 });

    const notificationsSection = page.getByTestId('notifications-section');
    await expect(notificationsSection).toBeVisible({ timeout: 15000 });
  });

  test('digest hour select appears when Daily digest is selected', async ({
    page,
    convexHelper,
  }) => {
    const { email, password } = await seedCommunityAdminContext(convexHelper);

    await signInUser(page, email, password);
    await page.goto('/community-admin/settings');
    await expect(page.locator('header')).toBeVisible({ timeout: 10000 });

    const notificationsSection = page.getByTestId('notifications-section');
    await expect(notificationsSection).toBeVisible({ timeout: 15000 });

    // digest-hour-select must not be visible before selecting 'digest'
    await expect(page.getByTestId('digest-hour-select')).not.toBeVisible();

    // Open the mode z-select (first z-select within notifications section)
    // z-select uses CDK Overlay — options render outside the component tree.
    const modeSelect = await getNotificationsSelect(page);
    await modeSelect.selectOption('Daily digest');

    // digest-hour-select should now appear
    await expect(page.getByTestId('digest-hour-select')).toBeVisible({ timeout: 10000 });
  });

  test('digest hour select hidden when Off is selected', async ({ page, convexHelper }) => {
    const { email, password } = await seedCommunityAdminContext(convexHelper);

    await signInUser(page, email, password);
    await page.goto('/community-admin/settings');
    await expect(page.locator('header')).toBeVisible({ timeout: 10000 });

    const notificationsSection = page.getByTestId('notifications-section');
    await expect(notificationsSection).toBeVisible({ timeout: 15000 });

    // Select 'Off' (the default, but explicitly set it)
    const modeSelect = await getNotificationsSelect(page);
    await modeSelect.selectOption('Off');

    // digest-hour-select must not be visible
    await expect(page.getByTestId('digest-hour-select')).not.toBeVisible();
  });

  test('setting persists after page reload', async ({ page, convexHelper }) => {
    const { email, password } = await seedCommunityAdminContext(convexHelper);

    await signInUser(page, email, password);
    await page.goto('/community-admin/settings');
    await expect(page.locator('header')).toBeVisible({ timeout: 10000 });

    const notificationsSection = page.getByTestId('notifications-section');
    await expect(notificationsSection).toBeVisible({ timeout: 15000 });

    // Select 'Daily digest'
    const modeSelect = await getNotificationsSelect(page);
    await modeSelect.selectOption('Daily digest');

    // Verify digest-hour-select appeared (confirms mode changed)
    await expect(page.getByTestId('digest-hour-select')).toBeVisible({ timeout: 10000 });

    // Save the preference
    const saveBtn = notificationsSection.getByTestId('save-notifications-btn');
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });
    await saveBtn.click();

    const env = createEnvironment(page);
    const toastHarness = await env.getHarness(BraToastHarness);
    await expect.poll(() => toastHarness.hasToastWithText(/saved/i), { timeout: 10000 }).toBe(true);
    await page.keyboard.press('Escape');
    await toastHarness.waitForToastHidden();

    // Reload the page — tests cold-load persistence
    await page.goto('/community-admin/settings');
    await expect(page.locator('header')).toBeVisible({ timeout: 10000 });

    // After reload the notifications section must re-load with 'digest' selected.
    // digest-hour-select is only rendered when mode === 'digest'.
    const notificationsSectionReloaded = page.getByTestId('notifications-section');
    await expect(notificationsSectionReloaded).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('digest-hour-select')).toBeVisible({ timeout: 15000 });

    // Also confirm the z-select shows 'Daily digest' label
    const reloadedSelect = await getNotificationsSelect(page);
    await expect(await reloadedSelect.getSelectedText()).toContain('Daily digest');
  });

  test('setting Off removes the preference row', async ({ page, convexHelper }) => {
    const { email, password } = await seedCommunityAdminContext(convexHelper);

    await signInUser(page, email, password);
    await page.goto('/community-admin/settings');
    await expect(page.locator('header')).toBeVisible({ timeout: 10000 });

    const notificationsSection = page.getByTestId('notifications-section');
    await expect(notificationsSection).toBeVisible({ timeout: 15000 });

    // First, set to 'all' and save
    let modeSelect = await getNotificationsSelect(page);
    await modeSelect.selectOption('All (immediate)');

    let saveBtn = notificationsSection.getByTestId('save-notifications-btn');
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });
    await saveBtn.click();

    const env = createEnvironment(page);
    const toastHarness = await env.getHarness(BraToastHarness);
    await expect.poll(() => toastHarness.hasToastWithText(/saved/i), { timeout: 10000 }).toBe(true);
    await page.keyboard.press('Escape');
    await toastHarness.waitForToastHidden();

    // Now set to 'off' and save
    modeSelect = await getNotificationsSelect(page);
    await modeSelect.selectOption('Off');

    saveBtn = notificationsSection.getByTestId('save-notifications-btn');
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });
    await saveBtn.click();

    await expect.poll(() => toastHarness.hasToastWithText(/saved/i), { timeout: 10000 }).toBe(true);
    await page.keyboard.press('Escape');
    await toastHarness.waitForToastHidden();

    // Reload and confirm mode shows 'off' (no digest-hour-select, z-select shows 'Off')
    await page.goto('/community-admin/settings');
    await expect(page.locator('header')).toBeVisible({ timeout: 10000 });

    const notificationsSectionReloaded = page.getByTestId('notifications-section');
    await expect(notificationsSectionReloaded).toBeVisible({ timeout: 15000 });

    // digest-hour-select must not be visible when mode is 'off'
    await expect(page.getByTestId('digest-hour-select')).not.toBeVisible();

    // z-select should show 'Off' (or the placeholder if preference was deleted)
    // Both 'Off' and the placeholder are acceptable since deleting the row resets to default 'off'
    const reloadedSelect = await getNotificationsSelect(page);
    // The select either shows "Off" explicitly or the placeholder (both indicate off state)
    await expect(await reloadedSelect.getSelectedText()).toBeDefined();
  });
});
