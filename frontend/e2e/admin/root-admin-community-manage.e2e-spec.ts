import {
  test,
  expect,
  uniqueName,
  createEnvironment,
} from '../helpers/test-setup';
import type {Page} from '@playwright/test';
import {api} from '@convex/_generated/api';
import {BraToastHarness} from '../../src/app/ui/components/composites/toast/toast.component.harness';

/**
 * E2E Tests for Root Admin Community Management Override
 *
 * Verifies that a root admin can:
 * - Navigate to the communities list
 * - Click "Manage" to enter community-admin view with override banner
 * - Edit community settings from the override context
 *
 * Uses convexHelper for test SETUP only (seeding data).
 * The system under test is always the UI.
 */
test.describe('Root Admin Community Management', () => {
  test.slow();

  function getVisibleCommunityEntry(page: Page, orgName: string) {
    return page
      .locator('[data-testid="community-entry"]:visible')
      .filter({hasText: orgName});
  }

  test('root admin can manage a community via override', async ({
    adminPage,
    convexHelper,
  }) => {
    const orgName = uniqueName('Override Org');

    // Seed a draft community — root admin should see ALL communities including draft
    await convexHelper.mutation(api.testing.communities.seedOrganizer, {
      name: orgName,
      status: 'draft',
    });

    // 1. Navigate to communities list
    await adminPage.goto('/admin/communities');
    await expect(
      adminPage.getByRole('heading', {name: 'Communities'}).first(),
    ).toBeVisible({
      timeout: 30000,
    });

    // 2. Find the seeded community and click Manage
    const communityEntry = getVisibleCommunityEntry(adminPage, orgName);
    await expect(communityEntry).toBeVisible({timeout: 15000});

    await communityEntry
      .locator('[data-testid="manage-community-btn"]')
      .click();

    // 3. Verify landing on community-admin page with the correct community
    await expect(adminPage).toHaveURL(/community-admin/, {timeout: 15000});

    // 4. Verify override banner is visible with the community name
    const banner = adminPage.locator('[data-testid="admin-override-banner"]');
    await expect(banner).toBeVisible({timeout: 10000});
    await expect(
      banner.locator('[data-testid="override-community-name"]'),
    ).toHaveText(orgName);

    // 5. Navigate to Settings tab (scope to main content to avoid matching sidebar nav link)
    const settingsLink = adminPage
      .locator('#main-content')
      .getByRole('link', {name: /Settings/i});
    await expect(settingsLink).toBeVisible({timeout: 10000});
    await settingsLink.click();
    await expect(adminPage).toHaveURL(/community-admin\/settings/, {
      timeout: 10000,
    });

    // 6. Verify profile name is loaded
    const nameInput = adminPage.locator('[data-testid="profile-name"]');
    await expect(nameInput).toBeVisible({timeout: 10000});
    await expect(nameInput).toHaveValue(orgName, {timeout: 10000});

    // 7. Edit the profile name and save
    const updatedName = `${orgName} Updated`;
    await nameInput.clear();
    await nameInput.fill(updatedName);

    await adminPage.locator('[data-testid="save-profile"]').click();

    // 8. Verify success toast
    const env = createEnvironment(adminPage);
    const toastHarness = await env.getHarness(BraToastHarness);
    await expect
      .poll(() => toastHarness.hasToastWithText(/saved/i), {timeout: 10000})
      .toBe(true);

    // Dismiss toast to prevent overlay issues
    await adminPage.keyboard.press('Escape');
    await toastHarness.waitForToastHidden();
  });

  test('mobile community-admin section selector exposes every section at 390px', async ({
    adminPage,
    convexHelper,
  }) => {
    const orgName = uniqueName('Mobile Sections Org');

    await convexHelper.mutation(api.testing.communities.seedOrganizer, {
      name: orgName,
      status: 'draft',
    });

    await adminPage.setViewportSize({width: 390, height: 844});

    await adminPage.goto('/admin/communities');
    await expect(
      adminPage.getByRole('heading', {name: 'Communities'}).first(),
    ).toBeVisible({
      timeout: 30000,
    });

    const communityEntry = getVisibleCommunityEntry(adminPage, orgName);
    await expect(communityEntry).toBeVisible({timeout: 15000});

    await communityEntry
      .locator('[data-testid="manage-community-btn"]')
      .click();

    await expect(adminPage).toHaveURL(/community-admin/, {timeout: 15000});
    await expect(
      adminPage.locator('[data-testid="admin-override-banner"]'),
    ).toBeVisible({
      timeout: 10000,
    });

    const sectionNav = adminPage.getByTestId('mobile-section-nav');
    await expect(sectionNav).toBeVisible({timeout: 10000});

    await expect(adminPage.getByTestId('mobile-tab-link')).toHaveCount(0);

    const sectionSelect = adminPage.getByTestId('mobile-section-select');
    await expect(sectionSelect).toBeVisible();
    await expect(sectionSelect).toBeInViewport();

    const selectBox = await sectionSelect.boundingBox();
    expect(
      selectBox,
      'mobile section selector should have a measurable box',
    ).not.toBeNull();
    expect(selectBox!.x).toBeGreaterThanOrEqual(0);
    expect(selectBox!.x + selectBox!.width).toBeLessThanOrEqual(390);

    await expect(sectionSelect.locator('option')).toHaveText([
      'Pending Apps',
      'App History',
      'Members',
      'Events',
      'Magic Links',
      'Audit Log',
      'Shared Vetting',
      'Settings',
    ]);

    await sectionSelect.selectOption('events');
    await expect(adminPage).toHaveURL(/community-admin\/events/, {
      timeout: 10000,
    });
    await expect(sectionSelect).toHaveValue('events');

    await sectionSelect.selectOption('settings');
    await expect(adminPage).toHaveURL(/community-admin\/settings/, {
      timeout: 10000,
    });
    await expect(sectionSelect).toHaveValue('settings');
  });
});
