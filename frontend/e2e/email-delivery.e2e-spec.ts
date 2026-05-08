import {test, expect, createEnvironment} from './helpers/test-setup';
import {EmailHarness} from './helpers/email-harness';
import {signInUser, signOutUser} from './test-utils/auth-helpers';
import {api} from '@convex/_generated/api';
import {AccountComponentHarness} from '../src/app/features/auth/pages/account/account.component.harness';

test.describe('Email Delivery & Content Verification', () => {
  test('should complete email change verification flow and update account email', async ({
    page,
    convexHelper,
  }, testInfo) => {
    testInfo.setTimeout(300_000);
    const testEmail = `email-test-${Date.now()}@example.com`;
    const testPassword = 'EmailTestPassword123!';
    const newEmail = `new-${Date.now()}@ethereal.email`;

    const seededUser = await convexHelper.action(
      api.testing.users_node.seedUserAndGetTokens,
      {
        email: testEmail,
        password: testPassword,
        name: 'Email Test User',
        verifyBetterAuth: true,
      },
    );
    await Promise.all([
      convexHelper.mutation(api.testing.utilities.resetRateLimit, {
        name: 'requestEmailChange',
        key: seededUser.userId,
      }),
      convexHelper.mutation(api.testing.utilities.resetRateLimit, {
        name: 'cancelEmailChange',
        key: seededUser.userId,
      }),
    ]);

    await signInUser(page, testEmail, testPassword);

    const emailHarness = new EmailHarness(page, convexHelper);

    await page.goto('/account', {waitUntil: 'domcontentloaded'});
    await expect
      .poll(
        async () => {
          try {
            const harness = await createEnvironment(page).getHarness(
              AccountComponentHarness,
            );
            return await harness.isVisible();
          } catch {
            return false;
          }
        },
        {timeout: 15000},
      )
      .toBe(true);
    const harness = await createEnvironment(page).getHarness(
      AccountComponentHarness,
    );
    const cancelledEmail = `cancel-${Date.now()}@ethereal.email`;
    await harness.setNewEmail(cancelledEmail);
    await expect
      .poll(() => harness.isEmailSubmitEnabled(), {timeout: 5000})
      .toBe(true);
    await harness.submitEmailChange();

    await expect
      .poll(
        async () => {
          const pendingEmail = await harness.getPendingEmailAddress();
          return pendingEmail?.includes(cancelledEmail) ?? false;
        },
        {timeout: 15000},
      )
      .toBe(true);

    const cancelButton = await harness.getCancelEmailChangeButton();
    if (!cancelButton) {
      throw new Error('Cancel email change button not found');
    }
    await cancelButton.click();
    await expect
      .poll(
        async () => {
          const pendingEmail = await harness.getPendingEmailAddress();
          return pendingEmail === null || pendingEmail.length === 0;
        },
        {timeout: 15000},
      )
      .toBe(true);

    await harness.setNewEmail(newEmail);
    await expect
      .poll(() => harness.isEmailSubmitEnabled(), {timeout: 5000})
      .toBe(true);
    await harness.submitEmailChange();

    await expect
      .poll(
        async () => {
          const pendingEmail = await harness.getPendingEmailAddress();
          return pendingEmail?.includes(newEmail) ?? false;
        },
        {timeout: 15000},
      )
      .toBe(true);
    await expect(page.getByTestId('pending-email-banner')).toContainText(
      /awaiting verification/i,
    );

    // Step 1: confirm the request from the CURRENT email inbox.
    await emailHarness.navigateToLatestEmail(
      testEmail,
      /confirm.*email change/i,
      {
        timeoutMs: 60000,
      },
    );
    await emailHarness.expectText(/change your account email/i);
    await emailHarness.clickLink(/yEs i aSkEd 4 tHiS|confirm/i);
    await expect(page).toHaveURL(/\/confirm\/email-change\?flow=email-change/);
    await expect(page.getByText('Almost Done')).toBeVisible({timeout: 15000});
    await expect(page.getByText(/Invalid email change link/i)).toHaveCount(0);

    // Some environments require a second verification from the new inbox.
    try {
      await emailHarness.navigateToLatestEmail(
        newEmail,
        /(verify|confirm|new email who dis)/i,
        {
          timeoutMs: 30000,
        },
      );
      await emailHarness.clickLink(/verify|confirm|yA tHaTs My NuU eMaiL/i);
    } catch (e) {
      // Only swallow "no email found" / timeout errors — unexpected failures should propagate.
      if (
        e instanceof Error &&
        !e.message.includes('No email found') &&
        !e.message.includes('timed out')
      )
        throw e;
      // If no second-step email appears, continue and verify final account state.
    }

    await page.goto('/account', {waitUntil: 'domcontentloaded'});
    await expect
      .poll(
        async () => {
          try {
            const harness = await createEnvironment(page).getHarness(
              AccountComponentHarness,
            );
            return await harness.isVisible();
          } catch {
            return false;
          }
        },
        {timeout: 15000},
      )
      .toBe(true);
    const resultHarness = await createEnvironment(page).getHarness(
      AccountComponentHarness,
    );
    await expect
      .poll(() => resultHarness.getCurrentEmail(), {timeout: 45000})
      .toContain(newEmail);

    await signOutUser(page);
    await expect(signInUser(page, testEmail, testPassword)).rejects.toThrow(
      /INVALID_EMAIL_OR_PASSWORD|401/,
    );
    await signInUser(page, newEmail, testPassword);

    await page.goto('/account', {waitUntil: 'domcontentloaded'});
    await expect
      .poll(
        async () => {
          try {
            const harness = await createEnvironment(page).getHarness(
              AccountComponentHarness,
            );
            return await harness.getCurrentEmail();
          } catch {
            return '';
          }
        },
        {timeout: 15000},
      )
      .toContain(newEmail);
  });

  test('should show clear error when requesting a duplicate email', async ({
    page,
    convexHelper,
  }) => {
    const firstEmail = `email-dup-a-${Date.now()}@example.com`;
    const secondEmail = `email-dup-b-${Date.now()}@example.com`;
    const password = 'EmailDupPassword123!';

    await convexHelper.action(api.testing.users_node.seedUserAndGetTokens, {
      email: firstEmail,
      password,
      name: 'Email Dup A',
    });

    await convexHelper.action(api.testing.users_node.seedUserAndGetTokens, {
      email: secondEmail,
      password,
      name: 'Email Dup B',
    });

    await signInUser(page, firstEmail, password);
    await page.goto('/account', {waitUntil: 'domcontentloaded'});
    await expect
      .poll(
        async () => {
          try {
            const harness = await createEnvironment(page).getHarness(
              AccountComponentHarness,
            );
            return await harness.isVisible();
          } catch {
            return false;
          }
        },
        {timeout: 15000},
      )
      .toBe(true);
    const dupHarness = await createEnvironment(page).getHarness(
      AccountComponentHarness,
    );
    await dupHarness.setNewEmail(secondEmail);
    await expect
      .poll(() => dupHarness.isEmailSubmitEnabled(), {timeout: 5000})
      .toBe(true);
    await dupHarness.submitEmailChange();

    await expect(page.getByText('Email address already in use')).toBeVisible({
      timeout: 15000,
    });
  });
});
