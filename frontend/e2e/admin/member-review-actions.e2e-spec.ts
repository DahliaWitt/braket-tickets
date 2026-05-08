import {test, expect, createEnvironment} from '../helpers/test-setup';
import {api} from '@convex/_generated/api';
import {type Id} from '@convex/_generated/dataModel';
import {CommunityAdminHarness} from '../../src/app/features/admin/pages/community-admin/community-admin.harness';

test.describe('Admin Member Review Actions', () => {
  test.slow();

  test('excludes rejected applicants from the members tab', async ({
    adminPage,
    convexHelper,
  }) => {
    const uniqueId = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const testEmail = `members-rejected-${uniqueId}@example.com`;
    const testPassword = 'RejectedApplicant123!';
    const testName = `Rejected Applicant ${uniqueId}`;

    const adminUser = await convexHelper.query(api.testing.users.getByEmail, {
      email: 'global-admin@example.com',
    });
    if (!adminUser) throw new Error('Admin user not found');

    const organizerId = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: `MEMBERS_ORG_${uniqueId}`,
      },
    );

    await convexHelper.mutation(api.testing.communities.seedCommunityAdmin, {
      userId: adminUser._id,
      organizerId,
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
      status: 'rejected',
      organizerId,
      answers: {
        whyJoin: 'Please reject this applicant for regression coverage',
      },
    });

    await adminPage.goto(`/community-admin/members?community=${organizerId}`);
    await expect(adminPage.locator('app-community-admin')).toBeVisible({
      timeout: 15000,
    });

    const harness = await createEnvironment(adminPage).getHarness(
      CommunityAdminHarness,
    );
    await expect
      .poll(() => harness.hasMembersTable(), {timeout: 15000})
      .toBe(true);

    const communitySelect = adminPage.locator('#community-select');
    const communityLabel = adminPage.getByTestId('community-name');
    await adminPage
      .locator(
        '[data-testid="community-selector-dropdown"], [data-testid="community-name"]',
      )
      .first()
      .waitFor({timeout: 10000});

    if (await communitySelect.isVisible().catch(() => false)) {
      await communitySelect.selectOption({value: organizerId});
    } else {
      await expect(communityLabel).toContainText(
        new RegExp(`MEMBERS_ORG_${uniqueId}`),
        {
          timeout: 15000,
        },
      );
    }

    const memberRow = adminPage
      .locator('[data-testid="member-row"]:visible')
      .filter({
        hasText: testName,
      });
    await expect(memberRow).toHaveCount(0);
    await expect(adminPage.getByRole('button', {name: /APPROVE/i})).toHaveCount(
      0,
    );
  });
});
