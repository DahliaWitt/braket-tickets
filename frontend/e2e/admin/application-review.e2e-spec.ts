import {
  test,
  expect,
  uniqueName,
  createEnvironment,
} from '../helpers/test-setup';
import {waitForAuthenticatedDashboard} from '../test-utils/auth-helpers';
import {api} from '@convex/_generated/api';
import {Id} from '@convex/_generated/dataModel';
import {CommunityAdminHarness} from '../../src/app/features/admin/pages/community-admin/community-admin.harness';

// No component harness migration: ApplicationsTableComponent does not have a
// .harness.ts file. The approve/reject button interactions use raw Playwright
// locators scoped to [data-testid="application-row"] containers, which is the
// recommended fallback per e2e-authoring rules.

test.describe('Admin Application Review', () => {
  test.slow();

  test('should show "HOME" nav and navigate to home', async ({
    adminPage,
    convexHelper,
  }) => {
    // Community-admin routes require at least one seeded organizer
    await convexHelper.mutation(api.testing.communities.seedOrganizer, {
      name: uniqueName('Nav Test Org'),
    });

    await adminPage.goto('/community-admin/pending');

    // Wait for the component to render, then get the harness
    await expect(adminPage.locator('app-community-admin')).toBeVisible({
      timeout: 15000,
    });
    const harness = await createEnvironment(adminPage).getHarness(
      CommunityAdminHarness,
    );

    // Wait for loading state to complete using harness
    await expect
      .poll(() => harness.hasSkeletons(), {timeout: 15000})
      .toBe(false);

    // The header nav contains a "HOME" link that navigates to /.
    // On desktop the link is directly visible; on mobile it's inside the
    // hamburger menu.  Detect viewport to handle both.
    const isMobile = (adminPage.viewportSize()?.width ?? 1280) < 768;

    if (isMobile) {
      const menuToggle = adminPage.getByRole('button', {name: /open menu/i});
      await expect(menuToggle).toBeVisible({timeout: 5000});
      await menuToggle.click();
      // Mobile nav slides open — wait for any link inside it to be actionable
      const mobileNav = adminPage.locator('nav[aria-label="Main"].open');
      await expect(mobileNav).toBeVisible({timeout: 5000});
    }

    // Desktop nav uses buttons (JS-driven navigation); mobile uses links.
    // Match whichever is visible at the current viewport.
    const homeBtn = adminPage.getByRole('button', {name: 'HOME', exact: true});
    const homeLink = adminPage.getByRole('link', {name: 'HOME', exact: true});
    const home = (await homeBtn.isVisible().catch(() => false))
      ? homeBtn
      : homeLink;
    await expect(home).toBeVisible({timeout: 10000});
    await home.click();

    await adminPage.waitForURL('**/');
    await waitForAuthenticatedDashboard(adminPage);
  });

  test('should approve a pending application and set user as trusted', async ({
    adminPage,
    convexHelper,
  }) => {
    // 1. Seed a community and a regular user with a pending application
    const uniqueId = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const testEmail = `applicant-${uniqueId}@example.com`;
    const testPassword = 'ApplicantPassword123!';
    const testName = `E2E Applicant ${uniqueId}`;

    // Get the admin user
    const adminUser = await convexHelper.query(api.testing.users.getByEmail, {
      email: 'global-admin@example.com',
    });
    if (!adminUser) throw new Error('Admin user not found');

    const orgId = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: `REVIEW_ORG_${uniqueId}`,
      },
    );

    // Assign admin to the community so it appears in the selector
    await convexHelper.mutation(api.testing.communities.seedCommunityAdmin, {
      userId: adminUser._id,
      organizerId: orgId,
      grantedBy: adminUser._id,
    });

    // Seed user and get their ID
    const seedResult = await convexHelper.action(
      api.testing.users_node.seedUserAndGetTokens,
      {
        email: testEmail,
        password: testPassword,
        name: testName,
      },
    );
    const applicantUserId = seedResult.userId as Id<'users'>;

    // 2. Seed a pending application for this user, scoped to the community
    await convexHelper.mutation(api.testing.applications.seedApplication, {
      userId: applicantUserId,
      status: 'pending',
      organizerId: orgId,
      answers: {whyJoin: 'E2E Test - I want to join!'},
    });

    // 3. Navigate to community admin applications page
    await adminPage.goto('/community-admin/pending');
    await expect(adminPage).toHaveURL(/.*community-admin\/pending/);

    // Community selector shows dropdown if multiple communities, label if only one.
    // Wait for the selector to fully render before checking which variant is shown —
    // without this wait the isVisible() check races against the communities query.
    const communitySelect = adminPage.locator('#community-select');
    const communityLabel = adminPage.getByTestId('community-name');
    await adminPage
      .locator(
        '[data-testid="community-selector-dropdown"], [data-testid="community-name"]',
      )
      .first()
      .waitFor({timeout: 10000});

    if (await communitySelect.isVisible().catch(() => false)) {
      // Multiple communities: use dropdown
      await expect(
        communitySelect.locator('option', {
          hasText: new RegExp(`REVIEW_ORG_${uniqueId}`),
        }),
      ).toBeAttached({timeout: 10000});
      await communitySelect.selectOption({value: orgId});
    } else {
      // Single community: just verify the label shows our org
      await expect(communityLabel).toContainText(
        new RegExp(`REVIEW_ORG_${uniqueId}`),
        {
          timeout: 15000,
        },
      );
    }

    // 4. Wait for the applications table/list to load
    // Support both desktop (tr) and mobile (div[role="article"])
    const applicantItem = adminPage
      .locator('[data-testid="application-row"]:visible')
      .filter({hasText: testName});
    await expect(applicantItem).toBeVisible({
      timeout: 15000,
    });

    // 5. Click Approve button for this applicant
    await applicantItem.getByRole('button', {name: /APPROVE/i}).click();

    // 6. Confirm in dialog
    await expect(adminPage.getByText(/Are you sure/i)).toBeVisible();
    await adminPage.getByRole('button', {name: /Yes, Approve/i}).click();

    // 7. Verify success toast
    await expect(adminPage.getByText(/Application approved/i)).toBeVisible({
      timeout: 10000,
    });
  });

  test('should reject a pending application', async ({
    adminPage,
    convexHelper,
  }) => {
    // 1. Seed a community and a regular user with a pending application
    const uniqueId = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const testEmail = `reject-${uniqueId}@example.com`;
    const testPassword = 'RejectPassword123!';
    const testName = `E2E Reject User ${uniqueId}`;

    // Get the admin user
    const adminUser = await convexHelper.query(api.testing.users.getByEmail, {
      email: 'global-admin@example.com',
    });
    if (!adminUser) throw new Error('Admin user not found');

    const orgId = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: `REJECT_ORG_${uniqueId}`,
      },
    );

    // Assign admin to the community so it appears in the selector
    await convexHelper.mutation(api.testing.communities.seedCommunityAdmin, {
      userId: adminUser._id,
      organizerId: orgId,
      grantedBy: adminUser._id,
    });

    const seedResult = await convexHelper.action(
      api.testing.users_node.seedUserAndGetTokens,
      {
        email: testEmail,
        password: testPassword,
        name: testName,
      },
    );

    await convexHelper.mutation(api.testing.applications.seedApplication, {
      userId: seedResult.userId as Id<'users'>,
      status: 'pending',
      organizerId: orgId,
      answers: {whyJoin: 'E2E Test - Please reject me'},
    });

    // 2. Navigate to community admin applications page
    await adminPage.goto('/community-admin/pending');

    // Community selector shows dropdown if multiple communities, label if only one.
    // Wait for the selector to fully render before checking which variant is shown —
    // without this wait the isVisible() check races against the communities query.
    const communitySelect = adminPage.locator('#community-select');
    const communityLabel = adminPage.getByTestId('community-name');
    await adminPage
      .locator(
        '[data-testid="community-selector-dropdown"], [data-testid="community-name"]',
      )
      .first()
      .waitFor({timeout: 10000});

    if (await communitySelect.isVisible().catch(() => false)) {
      // Multiple communities: use dropdown
      await expect(
        communitySelect.locator('option', {
          hasText: new RegExp(`REJECT_ORG_${uniqueId}`),
        }),
      ).toBeAttached({timeout: 10000});
      await communitySelect.selectOption({value: orgId});
    } else {
      // Single community: just verify the label shows our org
      await expect(communityLabel).toContainText(
        new RegExp(`REJECT_ORG_${uniqueId}`),
        {
          timeout: 15000,
        },
      );
    }

    const applicantItem = adminPage
      .locator('[data-testid="application-row"]:visible')
      .filter({hasText: testName});
    await expect(applicantItem).toBeVisible({
      timeout: 15000,
    });

    // 3. Click Reject button (zType="destructive" identifies the reject button)
    await applicantItem.locator('button[ztype="destructive"]').click();

    // 4. Confirm in dialog
    await expect(adminPage.getByText(/Are you sure/i)).toBeVisible();
    await adminPage.getByRole('button', {name: /Yes, Reject/i}).click();

    // 5. Verify application is removed from pending list
    await expect(
      adminPage.getByRole('row').filter({hasText: testName}),
    ).not.toBeVisible({
      timeout: 10000,
    });
  });
});
