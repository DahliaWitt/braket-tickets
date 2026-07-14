import {
  test,
  expect,
  createEnvironment,
  uniqueName,
} from './helpers/test-setup';
import {
  signInUser,
  waitForAuthenticatedDashboard,
} from './test-utils/auth-helpers';
import {api} from '@convex/_generated/api';
import {AccountComponentHarness} from '../src/app/features/auth/pages/account/account.component.harness';
import {LoginComponentHarness} from '../src/app/features/auth/pages/login/login.component.harness';

/**
 * E2E Tests for Account Management Page (/account)
 * - Change password (current -> new)
 * - Wrong current password rejected
 * - Profile updates persist (name - via user display if available)
 */
test.describe('Account Management', () => {
  test.describe('Password Change', () => {
    // NOTE: Signal Forms + Playwright fix verified working (zInput directive enables event detection).
    test('should change password successfully', async ({
      page,
      convexHelper,
    }) => {
      // Four sequential async operations (seed + login + form + re-login) need ample budget
      test.setTimeout(120_000);
      // 1. Seed a test user
      const accountSuffix = uniqueName('account-pwd-change')
        .replace(/\s+/g, '-')
        .toLowerCase();
      const testEmail = `${accountSuffix}@example.com`;
      const originalPassword = 'OriginalPassword123!';
      const newPassword = 'NewSecurePassword456!';

      await convexHelper.action(api.testing.users_node.seedUserAndGetTokens, {
        email: testEmail,
        password: originalPassword,
        name: 'Password Change Test User',
      });

      // 2. Login via UI (token injection doesn't work in E2E mode)
      await signInUser(page, testEmail, originalPassword);

      // 3. Navigate to account page
      await page.goto('/account');

      // Wait for the page to fully load (password form should be visible)
      const oldPwdInput = page.locator('input#oldPassword');
      await expect(oldPwdInput).toBeVisible({timeout: 15000});

      // 4. Fill the password change form via harness
      const env = createEnvironment(page);
      const harness = await env.getHarness(AccountComponentHarness);
      await harness.setOldPassword(originalPassword);
      await harness.setNewPassword(newPassword);
      await harness.setConfirmPassword(newPassword);

      // 5. Verify form is valid and submit button is enabled
      await expect
        .poll(() => harness.isPasswordSubmitEnabled(), {timeout: 5000})
        .toBe(true);

      // 6. Submit the form
      await harness.submitPassword();

      // 7. Password change now forces logout; verify we return to landing
      await expect(page).toHaveURL(/\/$/, {timeout: 15000});

      // 8. Verify new password works by logging in again
      await page.goto('/login');
      await expect(page.locator('app-login')).toBeVisible({timeout: 15000});
      const loginHarness = await createEnvironment(page).getHarness(
        LoginComponentHarness,
      );
      await loginHarness.setLoginEmail(testEmail);
      await loginHarness.setLoginPassword(newPassword);
      await loginHarness.submitLogin();

      // Should redirect to home on successful login
      await waitForAuthenticatedDashboard(page);
    });

    test('should reject wrong current password', async ({
      page,
      convexHelper,
    }) => {
      // Four sequential async operations need ample budget
      test.setTimeout(120_000);
      // 1. Seed a test user
      const testEmail = `account-pwd-wrong-${Date.now()}@example.com`;
      const originalPassword = 'CorrectPassword123!';
      const wrongPassword = 'WrongPassword999!';
      const newPassword = 'NewPassword456!';

      await convexHelper.action(api.testing.users_node.seedUserAndGetTokens, {
        email: testEmail,
        password: originalPassword,
        name: 'Wrong Password Test User',
      });

      // 2. Login via UI (token injection doesn't work in E2E mode)
      await signInUser(page, testEmail, originalPassword);

      // 3. Navigate to account page
      await page.goto('/account');

      // Wait for the page to fully load
      const oldPwdInput = page.locator('input#oldPassword');
      await expect(oldPwdInput).toBeVisible({timeout: 15000});

      // 4. Fill the password change form with WRONG current password via harness
      const env = createEnvironment(page);
      const harness = await env.getHarness(AccountComponentHarness);
      await harness.setOldPassword(wrongPassword);
      await harness.setNewPassword(newPassword);
      await harness.setConfirmPassword(newPassword);

      // 5. Verify the submit button is enabled (form is valid from validation perspective)
      await expect
        .poll(() => harness.isPasswordSubmitEnabled(), {timeout: 5000})
        .toBe(true);

      // 6. Submit the form
      await harness.submitPassword();

      // 7. Wait for the error message to appear (backend rejects wrong password)
      // The component displays passwordError() which contains the backend error message
      await expect
        .poll(() => harness.getPasswordError(), {timeout: 20000})
        .toMatch(/incorrect|invalid|wrong|failed/i);
    });

    test('should show error when passwords do not match', async ({
      page,
      convexHelper,
    }) => {
      // 1. Seed a test user
      const testEmail = `account-pwd-mismatch-${Date.now()}@example.com`;
      const originalPassword = 'OriginalPassword123!';

      await convexHelper.action(api.testing.users_node.seedUserAndGetTokens, {
        email: testEmail,
        password: originalPassword,
        name: 'Password Mismatch Test User',
      });

      // 2. Login via UI (token injection doesn't work in E2E mode)
      await signInUser(page, testEmail, originalPassword);

      // 3. Navigate to account page
      await page.goto('/account');

      // Wait for the page to fully load
      const oldPwdInput = page.locator('input#oldPassword');
      await expect(oldPwdInput).toBeVisible({timeout: 15000});

      // 4. Fill mismatched passwords via harness
      // setConfirmPassword() already calls blur() — no need for extra blur dispatch
      const env = createEnvironment(page);
      const harness = await env.getHarness(AccountComponentHarness);
      await harness.setOldPassword(originalPassword);
      await harness.setNewPassword('NewPassword123!');
      await harness.setConfirmPassword('DifferentPassword456!');

      // 5. Verify mismatch error is shown
      await expect
        .poll(
          async () => (await harness.getPasswordMismatchValidation()) ?? '',
          {timeout: 5000},
        )
        .toMatch(/passwords do not match/i);

      // 6. Verify submit button is disabled (passwordsMismatch disables submit)
      await expect
        .poll(() => harness.isPasswordSubmitDisabled(), {timeout: 5000})
        .toBe(true);
    });
  });

  test.describe('Account Page Baseline', () => {
    // Use the global authed user — these tests only read state and navigate
    test('should display current user email and navigate back to dashboard', async ({
      authedPage,
    }) => {
      // Intentional: references shared global user email for display-only verification
      const globalUserEmail = 'global-user@example.com';

      // 1. Navigate to account page
      await authedPage.goto('/account');
      await expect(authedPage).toHaveURL(/\/account/);
      await expect(
        authedPage.getByRole('heading', {name: /account/i}),
      ).toBeVisible({
        timeout: 10000,
      });

      // 2. Verify the global user's email is displayed via harness
      const env = createEnvironment(authedPage);
      const harness = await env.getHarness(AccountComponentHarness);
      await expect
        .poll(() => harness.getCurrentEmail(), {timeout: 15000})
        .toBe(globalUserEmail);

      // 3. Click the back link and verify navigation to home
      await authedPage.click('a[href="/"]');
      await waitForAuthenticatedDashboard(authedPage);
    });
  });
});

test.describe('Profile Name Persistence', () => {
  test('should persist profile name after page reload', async ({
    page,
    convexHelper,
  }) => {
    // 1. Seed a test user
    const testEmail = `profile-persist-${Date.now()}@example.com`;
    const password = 'TestPassword123!';

    await convexHelper.action(api.testing.users_node.seedUserAndGetTokens, {
      email: testEmail,
      password,
      name: 'Initial Name',
    });

    // 2. Login via UI
    await signInUser(page, testEmail, password);

    // 3. Navigate to account page
    await page.goto('/account');

    // 4. Wait for profile form to load
    const nameInput = page.locator('input#profile-name');
    await expect(nameInput).toBeVisible({timeout: 15000});

    // 5. Create harness and verify initial name is loaded (wait for the effect to populate the form)
    const env = createEnvironment(page);
    const harness = await env.getHarness(AccountComponentHarness);
    await expect
      .poll(() => harness.getProfileNameValue(), {timeout: 10000})
      .toBe('Initial Name');

    // 6. Update the name via harness
    const newName = 'Updated Profile Name';
    await harness.setProfileName(newName);

    // 7. Click save via harness
    await expect
      .poll(() => harness.isProfileSubmitEnabled(), {timeout: 5000})
      .toBe(true);
    await harness.submitProfile();

    // 8. Wait for success message
    // TODO: Add data-testid="profile-success-message" to component template
    await expect(page.getByText(/profile updated/i)).toBeVisible({
      timeout: 10000,
    });

    // 9. Reload the page
    // Intentional reload: verifying profile changes persist across page loads
    await page.reload();

    // 10. Wait for profile form to load again
    await expect(nameInput).toBeVisible({timeout: 15000});

    // 11. Verify the name persisted — use Playwright locator (auto-reconnects after reload)
    await expect(nameInput).toHaveValue(newName, {timeout: 10000});
  });

  test('should enforce maxlength of 100 characters on profile name (BRA-93)', async ({
    page,
    convexHelper,
  }) => {
    // 1. Seed a test user
    const testEmail = `profile-maxlen-${Date.now()}@example.com`;
    const password = 'TestPassword123!';

    await convexHelper.action(api.testing.users_node.seedUserAndGetTokens, {
      email: testEmail,
      password,
      name: 'Max Length Test User',
    });

    // 2. Sign in via Better Auth HTTP
    await signInUser(page, testEmail, password);

    // 3. Navigate to account page
    await page.goto('/account');

    // 4. Wait for profile form to load
    const nameInput = page.locator('input#profile-name');
    await expect(nameInput).toBeVisible({timeout: 15000});

    // 5. Verify the input has maxlength attribute (browser enforces the limit)
    const maxlength = await nameInput.getAttribute('maxlength');
    expect(maxlength).toBe('100');

    // 6. Attempt to enter a name that exceeds 100 characters — browser should truncate
    const env = createEnvironment(page);
    const harness = await env.getHarness(AccountComponentHarness);
    const longName = 'A'.repeat(200); // 200 characters, way over the limit
    await harness.setProfileName(longName);

    // 7. Verify browser truncated to 100 chars and button remains enabled (truncated input is valid)
    const truncatedValue = await harness.getProfileNameValue();
    expect(truncatedValue.length).toBeLessThanOrEqual(100);
    await expect
      .poll(() => harness.isProfileSubmitEnabled(), {timeout: 5000})
      .toBe(true);

    // 8. Verify a name exactly at the limit (100 chars) also enables the save button
    const exactLimitName = 'B'.repeat(100);
    await harness.setProfileName(exactLimitName);
    await expect
      .poll(() => harness.isProfileSubmitEnabled(), {timeout: 5000})
      .toBe(true);
  });
});
