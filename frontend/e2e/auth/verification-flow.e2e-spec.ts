import {createEnvironment, test, expect} from '../helpers/test-setup';
import {EmailHarness} from '../helpers/email-harness';
import {waitForAuthenticatedDashboard} from '../test-utils/auth-helpers';
import {api} from '@convex/_generated/api';
import {LoginComponentHarness} from '../../src/app/features/auth/pages/login/login.component.harness';
import type {Page} from '@playwright/test';

async function waitForLoginHarness(page: Page): Promise<LoginComponentHarness> {
  await expect
    .poll(
      async () => {
        try {
          await createEnvironment(page).getHarness(LoginComponentHarness);
          return 'ready';
        } catch {
          return null;
        }
      },
      {timeout: 10000},
    )
    .toBe('ready');

  return createEnvironment(page).getHarness(LoginComponentHarness);
}

test.describe('Email Verification Flow', () => {
  test.slow();

  test(
    'should deliver verification email, link the app user, and allow confirmation',
    {
      tag: '@smoke',
    },
    async ({page, convexHelper}, testInfo) => {
      testInfo.setTimeout(120_000);
      const emailHarness = new EmailHarness(page, convexHelper);
      const testEmail = `verify-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
      const testPassword = 'SecurePassword123!';

      // 1. Register via UI to trigger actual verification email
      await page.goto('/login');
      await expect(page).toHaveURL(/\/login(?:\?.*)?$/, {timeout: 10000});
      const loginHarness = await waitForLoginHarness(page);
      await loginHarness.switchToRegister();
      await loginHarness.setRegisterName(
        `Test Verification User ${Date.now()}`,
      );
      await loginHarness.setRegisterEmail(testEmail);
      await loginHarness.setRegisterPassword(testPassword);
      await loginHarness.setRegisterPasswordConfirm(testPassword);
      await loginHarness.acceptRegisterTerms();
      await loginHarness.submitRegister();

      // Wait for success message (email sent)
      await expect
        .poll(() => loginHarness.getSuccessMessageText(), {timeout: 15000})
        .toMatch(/check.*email|verification/i);

      // 2. Navigate to Verification Email in Ethereal
      await emailHarness.navigateToLatestEmail(
        testEmail,
        /verify your email/i,
        {
          timeoutMs: 60000,
        },
      );
      await emailHarness.expectText(/almost done|one quick check/i);

      // 3. Click Verification Link (button in our email template)
      const verifyLink = await emailHarness.clickLink(
        /yep,\s*this is my email/i,
      );
      const verifyToken =
        new URL(verifyLink).searchParams.get('token') ??
        new URL(verifyLink).searchParams.get('code');
      expect(verifyToken).toBeTruthy();

      // The Ethereal link goes through the Better Auth endpoint, which consumes the token
      // before redirecting back to the SPA callback. Navigate directly to the SPA token route
      // so the confirmation page can complete its existing verification flow.
      await page.goto(
        `/confirm/verification?token=${encodeURIComponent(verifyToken!)}`,
      );

      // 4. Verify the durable post-verification outcome. The confirmation route
      // can redirect to / before WebKit observes the intermediate URL.
      await waitForAuthenticatedDashboard(page);

      // 5. Verify production auth linked the app user to the Better Auth identity.
      await expect
        .poll(
          async () =>
            convexHelper.query(api.testing.users.getUserByEmail, {
              email: testEmail,
            }),
          {timeout: 15000},
        )
        .toMatchObject({
          authEmailVerified: true,
        });
      await expect
        .poll(
          async () => {
            const user = await convexHelper.query(
              api.testing.users.getUserByEmail,
              {
                email: testEmail,
              },
            );
            return (
              typeof user?.betterAuthUserId === 'string' &&
              user.betterAuthUserId.length > 0
            );
          },
          {timeout: 15000},
        )
        .toBe(true);
    },
  );
});
