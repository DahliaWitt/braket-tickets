import {createEnvironment, test, expect} from '../helpers/test-setup';
import {EmailHarness} from '../helpers/email-harness';
import {waitForAuthenticatedDashboard} from '../test-utils/auth-helpers';
import {api} from '@convex/_generated/api';
import {LoginComponentHarness} from '../../src/app/features/auth/pages/login/login.component.harness';
import {ConfirmPasswordResetComponentHarness} from '../../src/app/features/auth/pages/confirm/confirm-password-reset.component.harness';

test.describe('Password Reset Flow via Ethereal', () => {
  test.slow();

  test('should complete a full password reset flow via Ethereal', async ({
    page,
    convexHelper,
  }) => {
    test.setTimeout(120000);
    const emailHarness = new EmailHarness(page, convexHelper);
    const testEmail = `reset-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
    const newPassword = 'NewSecurePassword789!';

    // 1. Seed user with Better Auth
    await convexHelper.action(api.testing.users_node.seedUserAndGetTokens, {
      email: testEmail,
      name: `Reset User ${Date.now()}`,
      password: 'OldSecurePassword123!',
    });

    // 2. Trigger Reset Request via UI
    await page.goto('/login');
    await expect(page).toHaveURL(/\/login(?:\?.*)?$/, {timeout: 10000});
    await expect(page.locator('app-login')).toBeVisible({timeout: 10000});
    const loginHarness = await createEnvironment(page).getHarness(
      LoginComponentHarness,
    );
    await loginHarness.enterResetMode();
    await loginHarness.setResetEmail(testEmail);
    await loginHarness.submitResetRequest();

    // Wait for success message
    await expect
      .poll(async () => (await loginHarness.getResetSuccessText()) ?? '', {
        timeout: 15000,
      })
      .toMatch(/check.*email|reset.*sent|success/i);

    // 3. Navigate to Reset Email in Ethereal
    await emailHarness.navigateToLatestEmail(
      testEmail,
      /password reset link for braket tickets/i,
      {
        timeoutMs: 110000,
      },
    );
    await emailHarness.expectText(/password reset time|make new password/i);

    // 4. Click Reset Link (button in our email template)
    await emailHarness.clickLink(/make new password/i);

    // 5. Set New Password
    await expect(page).toHaveURL(/\/confirm\/password-reset(?:\?.*)?$/, {
      timeout: 10000,
    });
    await expect(page.locator('app-confirm-password-reset')).toBeVisible({
      timeout: 10000,
    });
    const confirmHarness = await createEnvironment(page).getHarness(
      ConfirmPasswordResetComponentHarness,
    );
    await confirmHarness.setPassword(newPassword);
    await confirmHarness.setPasswordConfirm(newPassword);
    await confirmHarness.submit();

    // 6. Verify Success and Login
    await expect
      .poll(() => confirmHarness.isSuccess(), {timeout: 10000})
      .toBe(true);

    // Navigate to login
    await page.goto('/login');
    await expect(page).toHaveURL(/\/login(?:\?.*)?$/, {timeout: 10000});
    await expect(page.locator('app-login')).toBeVisible({timeout: 10000});
    const reloginHarness = await createEnvironment(page).getHarness(
      LoginComponentHarness,
    );
    await reloginHarness.setLoginEmail(testEmail);
    await reloginHarness.setLoginPassword(newPassword);
    await reloginHarness.submitLogin();

    await waitForAuthenticatedDashboard(page);
  });
});
