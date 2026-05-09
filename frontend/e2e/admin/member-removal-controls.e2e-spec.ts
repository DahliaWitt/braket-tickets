import {test, expect, createEnvironment} from '../helpers/test-setup';
import {api} from '@convex/_generated/api';
import {BraDialogHarness} from '../../src/app/ui/components/composites/dialog/dialog.component.harness';
import {BraToastHarness} from '../../src/app/ui/components/composites/toast/toast.component.harness';

test.describe('Admin Member Removal Controls', () => {
  test.slow();

  test('revoking a direct member requires confirmation, updates the list, and writes an audit log', async ({
    adminPage,
    convexHelper,
  }) => {
    const suffix = Date.now();
    const slug = `member-revoke-${suffix}`;
    const communityName = `MEMBER_REVOKE_${suffix}`;
    const memberName = `Member Revoke ${suffix}`;
    const memberEmail = `member-revoke-${suffix}@example.com`;

    const adminUser = await convexHelper.query(api.testing.users.getByEmail, {
      email: 'global-admin@example.com',
    });
    if (!adminUser) throw new Error('Admin user not found');

    const organizerId = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: communityName,
        slug,
      },
    );
    const memberId = await convexHelper.mutation(
      api.testing.users.seedAppUser,
      {
        email: memberEmail,
        name: memberName,
      },
    );
    await convexHelper.mutation(api.testing.communities.seedCommunityScanner, {
      userId: memberId,
      organizerId,
      grantedBy: adminUser._id,
    });

    await adminPage.goto(`/community-admin/members?community=${slug}`);
    await expect(adminPage.locator('app-admin-members-table')).toBeVisible({
      timeout: 15000,
    });

    const memberRow = adminPage
      .locator('[data-testid="member-row"]:visible')
      .filter({
        hasText: memberName,
      });
    await expect(memberRow).toBeVisible({timeout: 15000});
    await expect(memberRow.getByTestId('member-status')).toContainText(
      /DIRECT MEMBER/i,
    );

    await memberRow.getByRole('button', {name: /REVOKE MEMBERSHIP/i}).click();

    const env = createEnvironment(adminPage);
    const dialog = await env.getHarness(BraDialogHarness);
    await expect
      .poll(() => dialog.getTitleText(), {timeout: 5000})
      .toBe('Revoke Membership');
    await expect(
      adminPage.locator(
        '[role="dialog"]:visible [data-testid="reason-textarea"]',
      ),
    ).toBeVisible({timeout: 5000});

    await dialog.clickOk();

    const toastHarness = await env.getHarness(BraToastHarness);
    await expect
      .poll(() => toastHarness.hasToastWithText(/membership revoked/i), {
        timeout: 10000,
      })
      .toBe(true);
    await adminPage.keyboard.press('Escape');
    await toastHarness.waitForToastHidden();

    await expect(memberRow).not.toBeVisible({timeout: 15000});

    const revokeAuditLog = await convexHelper.query(
      api.testing.admin.getLatestAuditLog,
      {
        adminId: adminUser._id,
        action: 'user.revoke',
      },
    );
    expect(revokeAuditLog).toMatchObject({
      action: 'user.revoke',
      organizerId,
    });
  });
});
