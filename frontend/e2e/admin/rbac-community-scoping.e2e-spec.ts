import {
  test,
  expect,
  uniqueName,
  createEnvironment,
} from '../helpers/test-setup';
import {
  signInUser,
  waitForAuthenticatedDashboard,
} from '../test-utils/auth-helpers';
import {BraToastHarness} from '../../src/app/ui/components/composites/toast/toast.component.harness';
import {api} from '@convex/_generated/api';
import type {Id} from '@convex/_generated/dataModel';

/**
 * E2E Tests for RBAC Community Admin Scoping & Cross-Community Isolation (BRA-53)
 *
 * Verifies that:
 * - Community admins only see their own community's data
 * - Route guards enforce role-based access
 * - Scanner management works within community scope
 * - Root admin can access all communities with override banner
 *
 * Uses convexHelper for test SETUP only (seeding data).
 * The system under test is always the UI.
 *
 * Scanner check-in scoping uses the canonical community_scanners RBAC path.
 */

type ConvexHelper = Parameters<Parameters<typeof test>[2]>[0]['convexHelper'];

/** Seed a community admin user and return everything needed for login + assertions. */
async function seedCommunityAdminUser(
  convexHelper: ConvexHelper,
  opts: {suffix: string; orgId: Id<'organizers'>; grantedBy: Id<'users'>},
) {
  const email = `ca-${opts.suffix}@example.com`;
  const password = 'CommunityAdmin123!';
  const tokens = await convexHelper.action(
    api.testing.users_node.seedUserAndGetTokens,
    {
      email,
      password,
      name: `CA ${opts.suffix}`,
    },
  );
  await convexHelper.mutation(api.testing.communities.seedCommunityAdmin, {
    userId: tokens.userId as Id<'users'>,
    organizerId: opts.orgId,
    grantedBy: opts.grantedBy,
  });
  return {email, password, userId: tokens.userId as Id<'users'>};
}

/** Seed two communities, each with a uniquely-named event. */
async function seedTwoCommunities(convexHelper: ConvexHelper, suffix: string) {
  const orgAName = uniqueName(`OrgA ${suffix}`);
  const orgBName = uniqueName(`OrgB ${suffix}`);
  const eventATitle = uniqueName(`EventA ${suffix}`);
  const eventBTitle = uniqueName(`EventB ${suffix}`);

  const orgA = await convexHelper.mutation(
    api.testing.communities.seedOrganizer,
    {name: orgAName},
  );
  const orgB = await convexHelper.mutation(
    api.testing.communities.seedOrganizer,
    {name: orgBName},
  );

  const eventA = await convexHelper.mutation(api.testing.events.seedEvent, {
    title: eventATitle,
    date: new Date(2030, 11, 15).toISOString(),
    price: 2000,
    totalTickets: 100,
    status: 'published' as const,
    organizerId: orgA,
  });
  const eventB = await convexHelper.mutation(api.testing.events.seedEvent, {
    title: eventBTitle,
    date: new Date(2030, 11, 16).toISOString(),
    price: 2500,
    totalTickets: 100,
    status: 'published' as const,
    organizerId: orgB,
  });

  return {
    orgA,
    orgB,
    orgAName,
    orgBName,
    eventA,
    eventB,
    eventATitle,
    eventBTitle,
  };
}

/** Get the root admin's user ID for grantedBy fields. */
async function getRootAdminId(
  convexHelper: ConvexHelper,
): Promise<Id<'users'>> {
  const admin = await convexHelper.query(api.testing.users.getByEmail, {
    email: 'global-admin@example.com',
  });
  if (!admin)
    throw new Error('Root admin not found — global.setup.ts may not have run');
  return admin._id;
}

test.describe('RBAC Community Admin Scoping', () => {
  test.slow(); // seedUserAndGetTokens hits Better Auth HTTP endpoints

  test.describe('Event Visibility', () => {
    test("community admin sees only their community's events", async ({
      page,
      convexHelper,
    }) => {
      const suffix = `vis-${Date.now()}`;
      const adminId = await getRootAdminId(convexHelper);
      const {orgA, eventATitle, eventBTitle} = await seedTwoCommunities(
        convexHelper,
        suffix,
      );

      const user = await seedCommunityAdminUser(convexHelper, {
        suffix,
        orgId: orgA,
        grantedBy: adminId,
      });

      await signInUser(page, user.email, user.password);
      await page.goto('/community-admin/events');

      // Wait for events tab to load
      // .first() needed: desktop <tr> and mobile <z-card> both have data-testid="event-entry"
      const eventsTable = page.locator('[data-testid="event-entry"]');
      await expect(
        eventsTable.filter({hasText: eventATitle}).first(),
      ).toBeVisible({
        timeout: 15000,
      });

      // OrgB's event must NOT be visible
      await expect(eventsTable.filter({hasText: eventBTitle})).toHaveCount(0);
    });

    test('community admin with two communities can switch between them', async ({
      page,
      convexHelper,
    }) => {
      const suffix = `switch-${Date.now()}`;
      const adminId = await getRootAdminId(convexHelper);
      const {orgA, orgB, orgAName, orgBName, eventATitle, eventBTitle} =
        await seedTwoCommunities(convexHelper, suffix);

      // Seed user as admin of BOTH communities
      const email = `ca-multi-${suffix}@example.com`;
      const password = 'MultiAdmin123!';
      const tokens = await convexHelper.action(
        api.testing.users_node.seedUserAndGetTokens,
        {
          email,
          password,
          name: `Multi CA ${suffix}`,
        },
      );
      await convexHelper.mutation(api.testing.communities.seedCommunityAdmin, {
        userId: tokens.userId as Id<'users'>,
        organizerId: orgA,
        grantedBy: adminId,
      });
      await convexHelper.mutation(api.testing.communities.seedCommunityAdmin, {
        userId: tokens.userId as Id<'users'>,
        organizerId: orgB,
        grantedBy: adminId,
      });

      await signInUser(page, email, password);
      await page.goto('/community-admin/events');

      // First community auto-selected — should see its event
      const eventsTable = page.locator('[data-testid="event-entry"]');
      await expect(eventsTable.first()).toBeVisible({timeout: 15000});

      // Find community selector dropdown and switch to the other community
      const selectorDropdown = page.getByTestId('community-selector-dropdown');
      await expect(selectorDropdown).toBeVisible({timeout: 10000});

      const selectEl = selectorDropdown.locator('select#community-select');

      // Get current community name and switch to the other
      const currentValue = await selectEl.inputValue();
      // Options use organizer IDs as values, names as labels
      const targetName = currentValue === orgA ? orgBName : orgAName;
      const targetTitle = currentValue === orgA ? eventBTitle : eventATitle;

      await selectEl.selectOption({label: targetName});

      // After switching, the other community's event should appear
      await expect(
        eventsTable.filter({hasText: targetTitle}).first(),
      ).toBeVisible({
        timeout: 15000,
      });
    });

    test('root admin override scopes the events table to the selected community', async ({
      adminPage,
      convexHelper,
    }) => {
      const suffix = `root-${Date.now()}`;
      const {orgA, orgAName, eventATitle, eventBTitle} =
        await seedTwoCommunities(convexHelper, suffix);

      await adminPage.goto(`/community-admin/events?community=${orgA}`);

      const communitySelect = adminPage.locator('#community-select');
      await expect(communitySelect).toBeVisible({timeout: 15000});
      await communitySelect.selectOption({label: orgAName});

      // Override banner should be visible once a community is selected in root-admin override mode.
      await expect(adminPage.getByTestId('admin-override-banner')).toBeVisible({
        timeout: 15000,
      });

      // Verify events tab is active
      const eventsTab = adminPage.getByRole('link', {name: /Events/i});
      await expect(eventsTab).toBeVisible({timeout: 10000});

      // Root override still scopes the events table to the selected community.
      // .first() needed: desktop <tr> and mobile <z-card> both have data-testid="event-entry"
      const eventsTable = adminPage.locator('[data-testid="event-entry"]');
      await expect(
        eventsTable.filter({hasText: eventATitle}).first(),
      ).toBeVisible({
        timeout: 15000,
      });
      await expect(eventsTable.filter({hasText: eventBTitle})).toHaveCount(0);
    });
  });

  test.describe('Cross-Community Access Control', () => {
    test('community admin can manage own event but gets error for foreign event', async ({
      page,
      convexHelper,
    }) => {
      const suffix = `xcom-${Date.now()}`;
      const adminId = await getRootAdminId(convexHelper);
      const {orgA, eventB, eventATitle} = await seedTwoCommunities(
        convexHelper,
        suffix,
      );

      const user = await seedCommunityAdminUser(convexHelper, {
        suffix,
        orgId: orgA,
        grantedBy: adminId,
      });

      await signInUser(page, user.email, user.password);
      await page.goto(`/community-admin/events?community=${orgA}`);

      // Own event should be visible — click EDIT
      const ownEventRow = page
        .locator('[data-testid="event-entry"]')
        .filter({hasText: eventATitle})
        .first();
      await expect(ownEventRow).toBeVisible({timeout: 15000});
      await ownEventRow.getByRole('link', {name: /Edit/i}).click();
      await expect(page).toHaveURL(/events\/.*\/edit/, {timeout: 10000});

      // Navigate directly to foreign event's manage page
      await page.goto(`/community-admin/events/${eventB}/manage`);

      // Should show error alert (backend throws unauthorized via _isEventAdmin)
      const alert = page.getByRole('alert');
      await expect(alert).toBeVisible({timeout: 15000});
      await expect(alert).toContainText(/couldn't load event data/i);
      await expect(
        alert.getByRole('link', {name: /Back to Events/i}),
      ).toBeVisible();
    });
  });

  test.describe('Route Guard Enforcement', () => {
    test('regular user is redirected from /community-admin and /scanner', async ({
      authedPage,
    }) => {
      // Regular user → /community-admin → redirected to /
      await authedPage.goto('/community-admin');
      await waitForAuthenticatedDashboard(authedPage);

      // Regular user → /scanner → redirected to /
      await authedPage.goto('/scanner');
      await waitForAuthenticatedDashboard(authedPage);
    });

    test('community admin is blocked from /admin (root-only)', async ({
      page,
      convexHelper,
    }) => {
      const suffix = `guard-${Date.now()}`;
      const adminId = await getRootAdminId(convexHelper);
      const orgId = await convexHelper.mutation(
        api.testing.communities.seedOrganizer,
        {
          name: uniqueName(`GuardOrg ${suffix}`),
        },
      );

      const user = await seedCommunityAdminUser(convexHelper, {
        suffix,
        orgId,
        grantedBy: adminId,
      });

      await signInUser(page, user.email, user.password);

      // community_admin navigating to /admin → redirected to /
      await page.goto('/admin');
      await waitForAuthenticatedDashboard(page);

      // But /community-admin should work
      await page.goto('/community-admin');
      await expect(page).toHaveURL(/\/community-admin/, {timeout: 10000});
    });
  });

  test.describe('Scanner Management', () => {
    test('community admin can grant and revoke scanner access via Settings', async ({
      page,
      convexHelper,
    }) => {
      const suffix = `scan-${Date.now()}`;
      const adminId = await getRootAdminId(convexHelper);
      const orgId = await convexHelper.mutation(
        api.testing.communities.seedOrganizer,
        {
          name: uniqueName(`ScanOrg ${suffix}`),
        },
      );

      // Seed community admin
      const caUser = await seedCommunityAdminUser(convexHelper, {
        suffix,
        orgId,
        grantedBy: adminId,
      });

      // Seed target scanner user — must be a community member for users.search
      // to find them (non-root-admin search is post-filtered to community members)
      const scannerEmail = `scanner-target-${suffix}@example.com`;
      const scannerUserId = await convexHelper.mutation(
        api.testing.users.seedAppUser,
        {
          email: scannerEmail,
        },
      );
      await convexHelper.mutation(
        api.testing.applications.seedApprovedApplication,
        {
          userId: scannerUserId,
          organizerId: orgId,
        },
      );

      await signInUser(page, caUser.email, caUser.password);
      await page.goto('/community-admin/settings');

      // Verify community is auto-selected (single community)
      // Settings page should be visible with scanner section
      const scannerEmpty = page.getByTestId('scanner-empty');
      await expect(scannerEmpty).toBeVisible({timeout: 15000});

      // Grant scanner access — use pressSequentially for reliable zInput signal update
      const emailInput = page.getByTestId('scanner-email-input');
      await emailInput.click();
      await emailInput.fill(scannerEmail);
      await emailInput.evaluate((el: HTMLInputElement) => {
        el.dispatchEvent(new Event('input', {bubbles: true}));
      });

      // Wait for Grant button to become enabled (zDisabled checks signal)
      const grantBtn = page.getByTestId('grant-scanner');
      await expect(grantBtn).toBeEnabled({timeout: 5000});
      await grantBtn.click();

      // Wait for success toast (confirms grant worked)
      const env = createEnvironment(page);
      const toastHarness = await env.getHarness(BraToastHarness);
      await expect
        .poll(() => toastHarness.hasToastWithText(/granted/i), {timeout: 15000})
        .toBe(true);
      await page.keyboard.press('Escape');
      await toastHarness.waitForToastHidden();

      // Scanner should now appear in the list (Convex subscription update)
      // Nameless users fall back to email in the server read model.
      const scannerList = page.getByTestId('scanner-list');
      await expect(scannerList).toContainText(scannerEmail, {timeout: 15000});

      // Revoke scanner access — ZardDialogService renders a custom modal, not window.confirm()
      await page.getByTestId('remove-scanner').click();

      // Confirm in the ZardUI dialog
      const confirmDialog = page.locator('[role="dialog"]:visible');
      await expect(confirmDialog.getByTestId('z-ok-button')).toBeVisible({
        timeout: 5000,
      });
      await confirmDialog.getByTestId('z-ok-button').click();

      // Dismiss revoke toast
      await expect
        .poll(() => toastHarness.hasToast(), {timeout: 10000})
        .toBe(true);
      await page.keyboard.press('Escape');
      await toastHarness.waitForToastHidden();

      // Scanner empty state should be back
      await expect(scannerEmpty).toBeVisible({timeout: 10000});

      const revokeAuditLog = await convexHelper.query(
        api.testing.admin.getLatestAuditLog,
        {
          adminId: caUser.userId,
          action: 'community_scanner.revoke',
        },
      );
      expect(revokeAuditLog).toMatchObject({
        action: 'community_scanner.revoke',
        organizerId: orgId,
        targetUserId: scannerUserId,
      });
    });
  });
});
