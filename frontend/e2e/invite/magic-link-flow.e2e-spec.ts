import {test, expect, createEnvironment} from '../helpers/test-setup';
import {signInUser} from '../test-utils/auth-helpers';
import {api} from '@convex/_generated/api';
import {BraToastHarness} from '../../src/app/ui/components/composites/toast/toast.component.harness';

/**
 * E2E Tests for Magic Link Invite Flow
 *
 * Covers the /invite/:token page states:
 * - Valid link → "You're Invited" options (unauthenticated)
 * - Valid link + authenticated → auto-redeem → success
 * - Expired / paused / disabled / maxed → error messages
 *
 * Uses convexHelper for data SETUP only (seeding magic links).
 * The system under test is always the UI at /invite/:token.
 */
test.describe('Magic Link Invite Flow', () => {
  test('valid link shows invite options when not authenticated', async ({
    page,
    convexHelper,
  }) => {
    const suffix = Date.now();

    // Seed: create a user to own the link (admin)
    const adminUser = await convexHelper.mutation(
      api.testing.users.createUserDirectly,
      {
        email: `ml-admin-${suffix}@test.com`,
        name: `ML Admin ${suffix}`,
      },
    );

    // Seed: create an active magic link
    const {token} = await convexHelper.mutation(
      api.testing.magic_links.seedMagicLink,
      {
        createdBy: adminUser,
        label: `E2E_VALID_${suffix}`,
      },
    );

    // Navigate to the invite page (unauthenticated)
    await page.goto(`/invite/${token}`);

    // Should show "You're Invited" heading
    await expect(page.getByText("You're Invited")).toBeVisible({
      timeout: 15000,
    });

    // Should show Sign In and Create Account links
    await expect(page.getByRole('link', {name: /Sign In/i})).toBeVisible();
    await expect(
      page.getByRole('link', {name: /Create Account/i}),
    ).toBeVisible();

    // Sign In link should include returnUrl
    const signInHref = await page
      .getByRole('link', {name: /Sign In/i})
      .getAttribute('href');
    expect(signInHref).toContain(`returnUrl=%2Finvite%2F${token}`);
  });

  test('expired link shows expiry error', async ({page, convexHelper}) => {
    const suffix = Date.now();
    const adminUser = await convexHelper.mutation(
      api.testing.users.createUserDirectly,
      {
        email: `ml-exp-${suffix}@test.com`,
        name: `ML Exp ${suffix}`,
      },
    );

    // Create a link that already expired (1ms ago)
    const {token} = await convexHelper.mutation(
      api.testing.magic_links.seedMagicLink,
      {
        createdBy: adminUser,
        label: `E2E_EXPIRED_${suffix}`,
        expiresAt: Date.now() - 60_000, // 1 minute ago — avoids timing race with sub-ms margins
      },
    );

    await page.goto(`/invite/${token}`);

    await expect(page.getByText('Link Unavailable')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText(/expired/i)).toBeVisible();
  });

  test('paused link shows paused error', async ({page, convexHelper}) => {
    const suffix = Date.now();
    const adminUser = await convexHelper.mutation(
      api.testing.users.createUserDirectly,
      {
        email: `ml-pause-${suffix}@test.com`,
        name: `ML Pause ${suffix}`,
      },
    );

    const {token} = await convexHelper.mutation(
      api.testing.magic_links.seedMagicLink,
      {
        createdBy: adminUser,
        label: `E2E_PAUSED_${suffix}`,
        status: 'paused',
      },
    );

    await page.goto(`/invite/${token}`);

    await expect(page.getByText('Link Unavailable')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText(/temporarily paused/i)).toBeVisible();
  });

  test('disabled link shows disabled error', async ({page, convexHelper}) => {
    const suffix = Date.now();
    const adminUser = await convexHelper.mutation(
      api.testing.users.createUserDirectly,
      {
        email: `ml-dis-${suffix}@test.com`,
        name: `ML Dis ${suffix}`,
      },
    );

    const {token} = await convexHelper.mutation(
      api.testing.magic_links.seedMagicLink,
      {
        createdBy: adminUser,
        label: `E2E_DISABLED_${suffix}`,
        status: 'disabled',
      },
    );

    await page.goto(`/invite/${token}`);

    await expect(page.getByText('Link Unavailable')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText(/no longer active/i)).toBeVisible();
  });

  test('invalid token shows invalid error', async ({page}) => {
    await page.goto('/invite/this-token-does-not-exist-at-all');

    await expect(page.getByText('Link Unavailable')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText(/does not exist/i)).toBeVisible();
  });

  test('authenticated user auto-redeems and redirects to dashboard', async ({
    page,
    convexHelper,
  }) => {
    const suffix = Date.now();
    const testEmail = `ml-redeem-user-${suffix}@test.com`;
    const testPassword = 'MagicLinkRedeem123!';

    // Seed a fresh user (not the shared authedPage user) to avoid mutating global state
    await convexHelper.action(api.testing.users_node.seedUserAndGetTokens, {
      email: testEmail,
      password: testPassword,
      name: `ML Redeem User ${suffix}`,
    });

    // Seed admin user for the link
    const adminUser = await convexHelper.mutation(
      api.testing.users.createUserDirectly,
      {
        email: `ml-redeem-admin-${suffix}@test.com`,
        name: `ML Redeem Admin ${suffix}`,
      },
    );

    const organizerId = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: `ML Redeem Org ${suffix}`,
        status: 'published',
      },
    );

    await convexHelper.mutation(api.testing.communities.seedCommunityAdmin, {
      userId: adminUser,
      organizerId,
      grantedBy: adminUser,
    });

    const {token} = await convexHelper.mutation(
      api.testing.magic_links.seedMagicLink,
      {
        createdBy: adminUser,
        organizerId,
        label: `E2E_REDEEM_${suffix}`,
      },
    );

    // Sign in via Better Auth HTTP; the invite page itself is the system under test
    await signInUser(page, testEmail, testPassword);

    // Navigate to the invite page as authenticated user
    await page.goto(`/invite/${token}`);

    // Should show "verifying access" briefly then transition to success
    await expect(page.getByRole('heading', {name: 'Welcome'})).toBeVisible({
      timeout: 15000,
    });
    // Check for lowercase "access granted" text in the component
    await expect(page.getByText('access granted')).toBeVisible();

    // Toast should confirm redemption — assert BEFORE the 2-second redirect timer fires
    // (component calls setTimeout(navigate, 2000) on success)
    const env = createEnvironment(page);
    const toastHarness = await env.getHarness(BraToastHarness);
    await expect
      .poll(() => toastHarness.hasToastWithText(/welcome|community/i), {
        timeout: 5000,
      })
      .toBe(true);

    // Should redirect to home after ~2s delay
    await page.waitForURL('**/', {timeout: 10000});
  });

  test('maxed-out link shows max uses error', async ({page, convexHelper}) => {
    const suffix = Date.now();

    const adminUser = await convexHelper.mutation(
      api.testing.users.createUserDirectly,
      {
        email: `ml-max-admin-${suffix}@test.com`,
        name: `ML Max Admin ${suffix}`,
      },
    );

    // Create a link with max 1 redemption
    const {token, linkId} = await convexHelper.mutation(
      api.testing.magic_links.seedMagicLink,
      {
        createdBy: adminUser,
        label: `E2E_MAXED_${suffix}`,
        maxRedemptions: 1,
      },
    );

    // Seed a redemption to exhaust the link
    const redeemer = await convexHelper.mutation(
      api.testing.users.createUserDirectly,
      {
        email: `ml-max-redeemer-${suffix}@test.com`,
        name: `ML Max Redeemer ${suffix}`,
      },
    );
    await convexHelper.mutation(
      api.testing.magic_links.seedMagicLinkRedemption,
      {
        magicLinkId: linkId,
        userId: redeemer,
      },
    );

    await page.goto(`/invite/${token}`);

    await expect(page.getByText('Link Unavailable')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText(/maximum uses/i)).toBeVisible();
  });
});
