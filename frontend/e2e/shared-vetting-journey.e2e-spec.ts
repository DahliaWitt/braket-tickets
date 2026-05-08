import {test, expect} from './helpers/test-setup';
import {signInUser} from './test-utils/auth-helpers';
import {api} from '@convex/_generated/api';
import {Id} from '@convex/_generated/dataModel';

/**
 * E2E Tests for Shared Vetting User Journey
 *
 * Verifies that a user approved by a trusted community sees shared access in the dashboard.
 *
 * Trust link create/pause admin flows are covered in admin-trust-links.e2e-spec.ts.
 * Uses convexHelper for data SETUP only (seeding users, communities, applications).
 * The system under test is always the UI.
 */
test.describe('Shared Vetting User Journey', () => {
  // Tests are independent: each seeds its own communities with unique Date.now() suffixes
  // and does not rely on state left by a previous test. Serial mode is not needed.

  test('user with shared trust can see approval in dashboard', async ({
    page,
    convexHelper,
  }) => {
    const suffix = Date.now();
    const testEmail = `shared-journey-${suffix}@example.com`;
    const testPassword = 'SharedJourney123!';

    // Seed communities
    const orgA = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: `TRUSTOR_${suffix}`,
      },
    );
    const orgB = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: `TRUSTED_${suffix}`,
      },
    );

    // Seed user
    const tokens = await convexHelper.action(
      api.testing.users_node.seedUserAndGetTokens,
      {
        email: testEmail,
        password: testPassword,
        name: 'Shared Journey User',
      },
    );
    const userId = tokens.userId;

    // Approve user for org B
    await convexHelper.mutation(
      api.testing.applications.seedApprovedApplication,
      {
        userId: userId as Id<'users'>,
        organizerId: orgB,
      },
    );

    // Create admin user to establish trust link
    const adminUser = await convexHelper.query(api.testing.users.getByEmail, {
      email: 'global-admin@example.com',
    });
    if (!adminUser) throw new Error('Admin user not found');

    // Create trust link A -> B (so users approved by B can access A)
    await convexHelper.mutation(api.testing.trust_links.seedTrustLink, {
      trustingOrganizerId: orgA,
      trustedOrganizerId: orgB,
      createdBy: adminUser._id,
    });

    // Sign in via Better Auth HTTP; the shared vetting dashboard state is the system under test
    await signInUser(page, testEmail, testPassword);

    const isApprovalVisible = async (communityName: string) => {
      const retryButton = page.getByRole('button', {name: /try again/i});
      if (await retryButton.isVisible().catch(() => false)) {
        await retryButton.click();
      }

      return page
        .getByText(new RegExp(communityName))
        .first()
        .isVisible()
        .catch(() => false);
    };

    // User should see both approvals: direct TRUSTED_ and shared TRUSTOR_ via TRUSTED_.
    await expect
      .poll(() => isApprovalVisible(`TRUSTED_${suffix}`), {timeout: 30_000})
      .toBe(true);
    await expect
      .poll(() => isApprovalVisible(`TRUSTOR_${suffix}`), {timeout: 30_000})
      .toBe(true);
  });
});
