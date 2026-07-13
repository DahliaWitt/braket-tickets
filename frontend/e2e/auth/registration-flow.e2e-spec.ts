import {test, expect} from '../helpers/test-setup';
import {api} from '@convex/_generated/api';
import {LoginPage} from '../page-objects/login.page';
import {EmailHarness} from '../helpers/email-harness';
import {waitForAuthenticatedDashboard} from '../test-utils/auth-helpers';

test.describe('Registration Flow', () => {
  /**
   * Helper to navigate to the registration tab
   */
  async function goToRegistrationForm(loginPage: LoginPage) {
    await loginPage.goto();
    await loginPage.waitForReady();
    await loginPage.switchToRegister();
    await expect(loginPage.host().locator('#register-name')).toBeVisible();
  }

  test.describe('Valid Registration', () => {
    test(
      'should create user with valid registration data',
      {tag: '@smoke'},
      async ({page, loginPage, convexHelper}, testInfo) => {
        testInfo.setTimeout(120_000);
        const emailHarness = new EmailHarness(page, convexHelper);
        const testEmail = `register-valid-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
        const testPassword = 'ValidPassword123!';
        const testName = `Test User ${Date.now()}`;

        await goToRegistrationForm(loginPage);

        // Fill registration form with valid data
        await loginPage.setRegisterName(testName);
        await loginPage.setRegisterEmail(testEmail);
        await loginPage.setRegisterPassword(testPassword);
        await loginPage.setRegisterPasswordConfirm(testPassword);

        // Check terms checkbox (required for form submission)
        await loginPage.acceptRegisterTerms();

        // Submit registration
        await loginPage.submitRegister();

        // Verify success message appears (email verification sent)
        await expect(loginPage.authMessage()).toContainText(
          /verification.*email|check.*email/i,
          {
            timeout: 15000,
          },
        );

        await emailHarness.navigateToLatestEmail(
          testEmail,
          /verify your email/i,
          {
            timeoutMs: 60000,
          },
        );
        const verifyLink = await emailHarness.clickLink(
          /yep,\s*this is my email/i,
        );
        const verifyToken =
          new URL(verifyLink).searchParams.get('token') ??
          new URL(verifyLink).searchParams.get('code');
        expect(verifyToken).toBeTruthy();

        await page.goto(
          `/confirm/verification?token=${encodeURIComponent(verifyToken!)}`,
        );
        await waitForAuthenticatedDashboard(page);
      },
    );

    test(
      'should preserve an admin invite returnUrl through signup, verification, and redemption',
      {tag: '@smoke'},
      async ({page, loginPage, convexHelper}, testInfo) => {
        testInfo.setTimeout(180_000);
        const emailHarness = new EmailHarness(page, convexHelper);
        const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
        const rootEmail = `invite-root-${suffix}@example.com`;
        const inviteEmail = `invite-register-${suffix}@example.com`;
        const invitePassword = 'ValidPassword123!';
        const communityName = `Invite Signup ${suffix}`;
        const token = `invite-signup-${suffix}`;

        const rootAdminId = await convexHelper.mutation(
          api.testing.users.createUserDirectly,
          {
            email: rootEmail,
            name: 'Invite Root Admin',
            isRootAdmin: true,
            authEmailVerified: true,
            termsAcceptedAt: Date.now(),
          },
        );

        const organizerId = await convexHelper.mutation(
          api.testing.communities.seedOrganizer,
          {
            name: communityName,
            status: 'draft',
          },
        );
        await convexHelper.mutation(api.testing.admin.seedAdminInvite, {
          email: inviteEmail,
          organizerId,
          communityName,
          invitedBy: rootAdminId,
          token,
        });

        const invitePath = `/admin-invite/${token}`;

        await page.goto(invitePath);
        await expect(page.getByTestId('redeem-needs-login')).toBeVisible({
          timeout: 15000,
        });
        await page.getByRole('link', {name: /create account/i}).click();

        await loginPage.waitForReady();
        await expect(page).toHaveURL(
          new RegExp(
            `/login\\?returnUrl=%2Fadmin-invite%2F${token}&signup=true`,
          ),
        );
        await expect(loginPage.host().locator('#register-panel')).toBeVisible({
          timeout: 10000,
        });

        await loginPage.setRegisterName('Invited Admin');
        await loginPage.setRegisterEmail(inviteEmail);
        await loginPage.setRegisterPassword(invitePassword);
        await loginPage.setRegisterPasswordConfirm(invitePassword);
        await loginPage.acceptRegisterTerms();
        await loginPage.submitRegister();

        await expect(loginPage.authMessage()).toContainText(
          /verification.*email|check.*email/i,
          {timeout: 15000},
        );
        await expect(page).toHaveURL(
          new RegExp(`/login\\?returnUrl=%2Fadmin-invite%2F${token}`),
        );

        await emailHarness.navigateToLatestEmail(
          inviteEmail,
          /verify your email/i,
          {
            timeoutMs: 60000,
          },
        );
        await emailHarness.clickLink(/yep,\s*this is my email/i);

        await expect(page).toHaveURL(new RegExp(`/admin-invite/${token}`), {
          timeout: 20000,
        });
        await expect(page.getByTestId('redeem-success')).toBeVisible({
          timeout: 20000,
        });

        await page.getByRole('link', {name: /go to dashboard/i}).click();
        await expect(page).toHaveURL(/\/community-admin/, {timeout: 10000});
      },
    );
  });

  test.describe('Password Validation', () => {
    test('should show error when password confirmation does not match', async ({
      loginPage,
    }) => {
      await goToRegistrationForm(loginPage);

      // Fill form with mismatching passwords
      await loginPage.setRegisterName(`Test User ${Date.now()}`);
      await loginPage.setRegisterEmail(`mismatch-${Date.now()}@example.com`);
      await loginPage.setRegisterPassword('ValidPassword123!');
      await loginPage.setRegisterPasswordConfirm('DifferentPassword456!');

      // Check terms checkbox (required for form submission)
      await loginPage.acceptRegisterTerms();

      // Submit registration
      await loginPage.submitRegister();

      // Verify password mismatch error is shown
      await expect(loginPage.registerPasswordConfirmError()).toContainText(
        /passwords do not match/i,
      );
      await expect(loginPage.authError()).toContainText(
        /passwords do not match/i,
      );
    });

    test('should show error when password is too short', async ({
      loginPage,
    }) => {
      await goToRegistrationForm(loginPage);

      // Fill form with weak password (less than 8 characters)
      await loginPage.setRegisterName(`Test User ${Date.now()}`);
      await loginPage.setRegisterEmail(`weakpass-${Date.now()}@example.com`);
      await loginPage.setRegisterPassword('Short1!');
      await loginPage.setRegisterPasswordConfirm('Short1!');

      // Check terms checkbox (required for form submission)
      await loginPage.acceptRegisterTerms();

      // Submit registration
      await loginPage.submitRegister();

      // Verify password length error is shown
      await expect(loginPage.registerPasswordError()).toContainText(
        /at least 8 characters/i,
      );
      await expect(loginPage.authError()).toContainText(/highlighted fields/i);
    });
  });

  test.describe('Terms Validation', () => {
    test('should show a visible error when terms are not accepted', async ({
      loginPage,
    }) => {
      await goToRegistrationForm(loginPage);

      await loginPage.setRegisterName(`Test User ${Date.now()}`);
      await loginPage.setRegisterEmail(`terms-${Date.now()}@example.com`);
      await loginPage.setRegisterPassword('ValidPassword123!');
      await loginPage.setRegisterPasswordConfirm('ValidPassword123!');

      await loginPage.submitRegister();

      await expect(loginPage.registerTermsError()).toContainText(
        /accept the terms/i,
      );
      await expect(loginPage.authError()).toContainText(/highlighted fields/i);
    });
  });

  test.describe('Email Validation', () => {
    test('should show error for invalid email format', async ({loginPage}) => {
      await goToRegistrationForm(loginPage);

      // Fill form with invalid email
      await loginPage.setRegisterName('Test User');
      await loginPage.setRegisterEmail('invalid-email-format');
      await loginPage.setRegisterPassword('ValidPassword123!');
      await loginPage.setRegisterPasswordConfirm('ValidPassword123!');

      // Check terms checkbox (required for form submission)
      await loginPage.acceptRegisterTerms();

      // Submit registration
      await loginPage.submitRegister();

      // Verify email format error is shown
      await expect(loginPage.registerEmailError()).toContainText(
        /valid email/i,
      );
      await expect(loginPage.authError()).toContainText(/highlighted fields/i);
    });

    test('should handle duplicate email registration securely', async ({
      page,
      loginPage,
      convexHelper,
    }) => {
      const existingEmail = `existing-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
      const existingPassword = 'ExistingPassword123!';

      // Seed an existing verified user
      await convexHelper.action(api.testing.users_node.seedUserAndGetTokens, {
        email: existingEmail,
        name: 'Existing User',
        password: existingPassword,
      });

      await goToRegistrationForm(loginPage);

      // Try to register with the same email
      await loginPage.setRegisterName('Duplicate User');
      await loginPage.setRegisterEmail(existingEmail);
      await loginPage.setRegisterPassword('NewPassword456!');
      await loginPage.setRegisterPasswordConfirm('NewPassword456!');

      // Check terms checkbox (required for form submission)
      await loginPage.acceptRegisterTerms();

      // Submit registration
      await loginPage.submitRegister();

      // Duplicate email registration must produce visible feedback rather than
      // appearing to do nothing. The current auth policy uses the neutral
      // verification-pending state to avoid email enumeration.
      await expect(page).toHaveURL(/\/login(?:\?.*)?$/, {
        timeout: 15000,
      });
      await expect(loginPage.authMessage()).toBeVisible({
        timeout: 15000,
      });
      await expect(loginPage.authMessage()).toContainText(
        /if this email is not already registered, a verification email has been sent/i,
      );
    });
  });

  test.describe('Login Redirect', () => {
    test('should redirect to returnUrl after successful login', async ({
      page,
      convexHelper,
      loginPage,
    }) => {
      const testEmail = `return-test-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
      const testPassword = 'Password123!';

      await convexHelper.action(api.testing.users_node.seedUserAndGetTokens, {
        email: testEmail,
        password: testPassword,
        name: 'Return Test User',
      });

      await loginPage.goto('/tickets');
      // Wait for login form to render before interacting
      await loginPage.waitForReady();

      await loginPage.setLoginEmail(testEmail);
      await loginPage.setLoginPassword(testPassword);
      await loginPage.submitLogin();

      // Auth flow includes signIn + getSession + syncUserToApp + navigate;
      // allow extra headroom for cold backends
      await expect(page).toHaveURL(/\/tickets/, {timeout: 20000});
    });
  });

  test.describe('Email Verification Gate', () => {
    test('should prevent login before email verification', async ({
      loginPage,
    }) => {
      const testEmail = `unverified-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
      const testPassword = 'ValidPassword123!';
      const testName = `Unverified User ${Date.now()}`;

      // Step 1: Register the user (this creates an unverified account)
      await goToRegistrationForm(loginPage);
      await loginPage.setRegisterName(testName);
      await loginPage.setRegisterEmail(testEmail);
      await loginPage.setRegisterPassword(testPassword);
      await loginPage.setRegisterPasswordConfirm(testPassword);

      // Check terms checkbox (required for form submission)
      await loginPage.acceptRegisterTerms();

      await loginPage.submitRegister();

      // Wait for registration success (verification email sent message)
      await expect(loginPage.authMessage()).toContainText(
        /verification.*email|check.*email/i,
        {
          timeout: 15000,
        },
      );

      // Step 2: Switch to login tab and try to login immediately
      await loginPage.switchToLogin();
      await loginPage.waitForReady();

      await loginPage.setLoginEmail(testEmail);
      await loginPage.setLoginPassword(testPassword);
      await loginPage.submitLogin();

      // Step 3: Verify that login fails with verification-related message
      // The user should see an error about needing to verify their email
      await expect(loginPage.authError()).toContainText(/verif|unverified/i, {
        timeout: 15000,
      });

      // There should be a "Resend verification" button (may show cooldown timer)
      // The button text changes based on cooldown state: "Resend verification email" or "Resend in Xs"
      await expect(loginPage.authError().getByRole('button')).toBeVisible();
    });
  });
});
