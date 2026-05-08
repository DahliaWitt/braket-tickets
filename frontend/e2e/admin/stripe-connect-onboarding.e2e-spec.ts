import { test, expect, uniqueName, createEnvironment } from '../helpers/test-setup';
import { signInUser } from '../test-utils/auth-helpers';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { CommunityAdminSettingsHarness } from '../../src/app/features/admin/pages/community-admin-settings/community-admin-settings.component.harness';
import { StripeConnectEmbedComponentHarness } from '../../src/app/features/admin/components/stripe-connect/stripe-connect-embed.component.harness';

/**
 * E2E coverage for the embedded Stripe Connect onboarding surface.
 *
 * V2 replaced the hosted Express dashboard + AccountLink onboarding redirect
 * with embedded Connect components mounted inline in community-admin settings.
 * If this surface silently breaks, every new promoter is stuck — there is no
 * fallback path. These tests verify the happy path end-to-end through the
 * Angular wrapper with the Stripe SDK short-circuited via `mockPayments`.
 *
 * What is NOT tested here:
 * - Stripe-hosted iframe contents (outside our contract)
 * - Real KYC flow (not reachable from an automated browser)
 * - Webhook-driven state transitions (covered in backend tests)
 *
 * Backend actions `createConnectedAccount`, `createAccountSession`, and
 * `checkAccountStatus` short-circuit on `isTestEnvironment()` so the auth +
 * permission gates still execute but no real Stripe call is made. The
 * frontend `stripe-connect-embed` component swaps its `@stripe/connect-js`
 * mount for placeholder elements when `environment.stripe.mockPayments` is
 * true, keeping the same `data-testid` contract either way.
 */

type ConvexHelper = Parameters<Parameters<typeof test>[2]>[0]['convexHelper'];

async function seedCommunityAdminContext(
  convexHelper: ConvexHelper,
  orgArgs: {
    name: string;
    stripeConnectedAccountId?: string;
  },
): Promise<{ email: string; password: string; orgId: Id<'organizers'> }> {
  const adminUser = await convexHelper.query(api.testing.users.getByEmail, {
    email: 'global-admin@example.com',
  });
  if (!adminUser) {
    throw new Error('Root admin not found — global.setup.ts may not have run');
  }
  const grantedBy = adminUser._id as Id<'users'>;

  const orgId = (await convexHelper.mutation(api.testing.communities.seedOrganizer, {
    name: orgArgs.name,
    ...(orgArgs.stripeConnectedAccountId
      ? { stripeConnectedAccountId: orgArgs.stripeConnectedAccountId }
      : {}),
  })) as Id<'organizers'>;

  const nonce = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const email = `stripe-ca-${nonce}@example.test`;
  const password = 'StripeAdmin123!';
  const tokens = await convexHelper.action(api.testing.users_node.seedUserAndGetTokens, {
    email,
    password,
    name: uniqueName('Stripe CA'),
  });
  await convexHelper.mutation(api.testing.communities.seedCommunityAdmin, {
    userId: tokens.userId as Id<'users'>,
    organizerId: orgId,
    grantedBy,
  });

  return { email, password, orgId };
}

test.describe('Stripe Connect Onboarding (embedded)', () => {
  test.slow();

  test('connected organizer renders Account Management + Payments + Balances', async ({
    page,
    convexHelper,
  }) => {
    const nonce = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    // Seeding with stripeConnectedAccountId flips the V2 defaults to the
    // fully-onboarded state (complete / chargesEnabled / payoutsEnabled).
    // See backend/convex/testing/communities.ts seedOrganizer defaulting logic.
    const { email, password } = await seedCommunityAdminContext(convexHelper, {
      name: uniqueName('Connected Org'),
      stripeConnectedAccountId: `acct_e2e_${nonce.replace('-', '')}`,
    });

    await signInUser(page, email, password);
    await page.goto('/community-admin/settings');
    await expect(page.locator('header')).toBeVisible({ timeout: 10000 });
    // Community context resolves async; the settings component only
    // mounts once `selectedCommunityId()` is non-null. Wait for a
    // stable landmark inside the settings page before acquiring the
    // harness.
    await expect(page.getByTestId('stripe-connect-section')).toBeVisible({
      timeout: 20000,
    });

    const settings = await createEnvironment(page).getHarness(CommunityAdminSettingsHarness);

    await expect
      .poll(() => settings.isStripeConnected(), { timeout: 15000 })
      .toBe(true);
    await expect
      .poll(() => settings.hasStripeConnectEmbed(), { timeout: 15000 })
      .toBe(true);
    // Error state must stay empty while the embed comes up.
    expect(await settings.getStripeError()).toBeNull();

    const embed = await createEnvironment(page).getHarness(
      StripeConnectEmbedComponentHarness,
    );
    await expect.poll(() => embed.isHostVisible(), { timeout: 15000 }).toBe(true);
    expect(await embed.getErrorText()).toBeNull();
    // Onboarding-complete accounts mount the self-serve cluster that used
    // to live in the removed Express dashboard.
    expect(await embed.hasAccountManagement()).toBe(true);
    expect(await embed.hasPayments()).toBe(true);
    expect(await embed.hasBalances()).toBe(true);
    expect(await embed.hasNotificationBanner()).toBe(true);
    // Onboarding component is mutually exclusive with management surfaces.
    expect(await embed.hasAccountOnboarding()).toBe(false);
  });

  test('unconnected organizer: clicking Connect mounts the Account Onboarding component', async ({
    page,
    convexHelper,
  }) => {
    const { email, password } = await seedCommunityAdminContext(convexHelper, {
      name: uniqueName('Unconnected Org'),
    });

    await signInUser(page, email, password);
    await page.goto('/community-admin/settings');
    await expect(page.locator('header')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('stripe-connect-section')).toBeVisible({
      timeout: 20000,
    });

    const settings = await createEnvironment(page).getHarness(CommunityAdminSettingsHarness);

    // Pre-state: no connected account, no embed yet.
    expect(await settings.isStripeConnected()).toBe(false);
    expect(await settings.hasStripeConnectEmbed()).toBe(false);

    await settings.clickConnectWithStripe();

    // Backend `createConnectedAccount` + `checkAccountStatus` both
    // short-circuit via isTestEnvironment(), so the organizer row lands
    // in the fully-onboarded state and the embedded surface switches
    // to the management cluster (onboarding-complete branch).
    await expect
      .poll(() => settings.hasStripeConnectEmbed(), { timeout: 20000 })
      .toBe(true);
    await expect
      .poll(() => settings.isStripeConnected(), { timeout: 15000 })
      .toBe(true);
    expect(await settings.getStripeError()).toBeNull();

    const embed = await createEnvironment(page).getHarness(
      StripeConnectEmbedComponentHarness,
    );
    await expect.poll(() => embed.isHostVisible(), { timeout: 15000 }).toBe(true);
    expect(await embed.getErrorText()).toBeNull();
    expect(await embed.hasAccountManagement()).toBe(true);
  });
});
