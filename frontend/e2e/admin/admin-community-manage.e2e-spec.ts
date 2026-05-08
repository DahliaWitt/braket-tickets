import { test, expect, uniqueName } from '../helpers/test-setup';
import { api } from '@convex/_generated/api';

test.describe('Admin Community Manage — ?community= slug param', () => {
  test.slow();

  test('clicking Manage on a slugged community navigates with ?community=<slug> and retains param on tab change', async ({
    adminPage,
    convexHelper,
  }) => {
    const ts = Date.now();
    const slugA = `community-a-${ts}`;
    const slugB = `community-b-${ts}`;
    const nameA = uniqueName('Community A');
    const nameB = uniqueName('Community B');

    await convexHelper.mutation(api.testing.communities.seedOrganizer, {
      name: nameA,
      slug: slugA,
      status: 'published',
    });
    await convexHelper.mutation(api.testing.communities.seedOrganizer, {
      name: nameB,
      slug: slugB,
      status: 'published',
    });

    await adminPage.goto('/admin/communities');
    await expect(adminPage.getByRole('heading', { name: 'Communities' }).first()).toBeVisible({
      timeout: 30000,
    });

    // Find community B in the desktop-visible entries and click Manage
    const communityBEntry = adminPage
      .locator('[data-testid="community-entry"]:visible')
      .filter({ hasText: nameB });
    await expect(communityBEntry).toBeVisible({ timeout: 15000 });

    await communityBEntry.locator('[data-testid="manage-community-btn"]').click();

    // URL must use ?community=<slugB>
    await adminPage.waitForURL(/\/community-admin\/pending(\?|$)/, { timeout: 15000 });
    const pendingUrl = new URL(adminPage.url());
    expect(pendingUrl.searchParams.get('community')).toBe(slugB);

    // Wait for communityDoc to load (via override banner name) so that tabQueryParams
    // has the slug. The banner name is populated from communityDoc().name.
    const overrideBanner = adminPage.locator('[data-testid="admin-override-banner"]');
    await expect(overrideBanner).toBeVisible({ timeout: 15000 });
    await expect(overrideBanner.locator('[data-testid="override-community-name"]')).toHaveText(
      nameB,
      { timeout: 15000 },
    );

    // Poll the Members link href until it contains the slug (communityDoc slug is loaded).
    const membersLink = adminPage
      .locator('#main-content')
      .getByRole('link', { name: /Members/i });
    await expect.poll(
      async () => {
        const href = await membersLink.getAttribute('href');
        return href?.includes(`community=${slugB}`) ?? false;
      },
      { timeout: 15000 },
    ).toBe(true);

    await membersLink.click();
    await adminPage.waitForURL(/\/community-admin\/members(\?|$)/, { timeout: 10000 });

    const membersUrl = new URL(adminPage.url());
    expect(membersUrl.searchParams.get('community')).toBe(slugB);
  });
});
