import {
  test,
  expect,
  uniqueName,
  type ConvexHelper,
} from '../helpers/test-setup';
import { type Page } from '@playwright/test';
import { getHarnessWhenVisible } from '../helpers/harness-helpers';
import { signInUser } from '../test-utils/auth-helpers';
import { fillAndSubmitPayment, waitForPaymentSuccess } from '../test-utils/payment-helpers';
import { seedStripeReadyOrganizer } from '../test-utils/stripe-organizer-fixture';
import { api } from '@convex/_generated/api';
import { Id } from '@convex/_generated/dataModel';
import { CheckoutSidebarHarness } from '../../src/app/features/tickets/components/checkout-sidebar/checkout-sidebar.component.harness';
import { EventDetailsHarness } from '../../src/app/features/tickets/pages/event-details/event-details.component.harness';
import { ZardTicketsHarness } from '../../src/app/features/tickets/pages/tickets/tickets.component.harness';
import { EventManagementHarness } from '../../src/app/features/admin/pages/event-management/event-management.harness';

interface TierTestOptions {
  testEmail: string;
  userName: string;
  eventTitle: string;
  price: number;
  supporterDefaultPrice: number;
  slidingScaleEnabled: boolean;
  slidingScaleMin?: number;
  slidingScaleMax?: number;
}

interface TierTestResult {
  eventId: string;
  user: { userId: string };
  checkout: CheckoutSidebarHarness;
}

async function goToMyTickets(page: Page): Promise<ZardTicketsHarness> {
  const checkout = await getHarnessWhenVisible(page, CheckoutSidebarHarness, 15000, 'attached');
  await expect.poll(() => checkout.isViewTicketsVisible(), { timeout: 20000 }).toBe(true);
  await checkout.clickViewTickets();
  await expect(page).toHaveURL(/\/tickets/, { timeout: 20000 });
  return getHarnessWhenVisible(page, ZardTicketsHarness);
}

/**
 * Seeds a vetted user and a tiered event, logs in, navigates to the event page,
 * and opens the checkout sidebar. Returns the seeded eventId and user.
 */
async function setupTierTest(
  convexHelper: ConvexHelper,
  page: Page,
  options: TierTestOptions,
): Promise<TierTestResult> {
  const {
    testEmail,
    userName,
    eventTitle,
    price,
    supporterDefaultPrice,
    slidingScaleEnabled,
    slidingScaleMin,
    slidingScaleMax,
  } = options;

  const user = await convexHelper.action(api.testing.users_node.seedUserAndGetTokens, {
    email: testEmail,
    password: 'Password123!',
    name: userName,
  });

  const organizerId = await seedStripeReadyOrganizer(convexHelper, uniqueName('Tier Test Org'));

  const eventId = await convexHelper.mutation(api.testing.events.seedEvent, {
    title: eventTitle,
    date: new Date(2030, 0, 1).toISOString(),
    price,
    totalTickets: 100,
    status: 'published',
    visibility: 'public',
    organizerId: organizerId as Id<'organizers'>,
    supporterDefaultPrice,
    slidingScaleEnabled,
    ...(slidingScaleEnabled && slidingScaleMin !== undefined ? { slidingScaleMin } : {}),
    ...(slidingScaleEnabled && slidingScaleMax !== undefined ? { slidingScaleMax } : {}),
    maxTicketsPerUser: 4,
  });

  await signInUser(page, testEmail, 'Password123!');

  await page.goto(`/events/${eventId}`);
  const eventDetails = await getHarnessWhenVisible(page, EventDetailsHarness);
  await expect.poll(() => eventDetails.getEventTitle(), { timeout: 30000 }).toBe(eventTitle);
  await expect.poll(() => eventDetails.isGetTicketsButtonVisible(), { timeout: 20000 }).toBe(true);
  await eventDetails.clickGetTickets();

  const checkout = await getHarnessWhenVisible(page, CheckoutSidebarHarness, 15000, 'attached');
  await expect.poll(() => checkout.getHeadingText(), { timeout: 10000 }).toBe('Checkout');
  await expect.poll(() => checkout.isTierVisible('regular'), { timeout: 20000 }).toBe(true);
  await expect.poll(() => checkout.isTierVisible('supporter'), { timeout: 20000 }).toBe(true);
  if (slidingScaleEnabled) {
    await expect.poll(() => checkout.isTierVisible('notaflof'), { timeout: 20000 }).toBe(true);
  }
  return { eventId, user, checkout };
}

/**
 * E2E Tests for Tiered/Sliding-Scale Purchase Flow
 *
 * Tests the ability to select different pricing tiers (regular, supporter, community/notaflof)
 * during checkout and verifies the correct tier is recorded on tickets and revenue.
 */
test.describe('Tiered Purchase Flow', () => {
  test.describe('Tier Selection Visibility', () => {
    test('event with tiers shows tier selection options', async ({ page, convexHelper }) => {
      const testEmail = `tier-test-${Date.now()}@example.com`;
      const eventTitle = `E2E Tiered Event ${Date.now()}`;

      const { checkout } = await setupTierTest(convexHelper, page, {
        testEmail,
        userName: 'Tier Test User',
        eventTitle,
        price: 2000, // $20.00 regular price
        supporterDefaultPrice: 3000, // $30.00 supporter default
        slidingScaleEnabled: true,
        slidingScaleMin: 500, // $5.00 minimum for community tier
        slidingScaleMax: 2000, // $20.00 max (same as regular)
      });

      // Verify all tier options are visible via harness
      await expect.poll(() => checkout.isTierVisible('regular')).toBe(true);
      await expect.poll(() => checkout.isTierVisible('supporter')).toBe(true);
      await expect.poll(() => checkout.isTierVisible('notaflof')).toBe(true);
    });

    test('event without sliding scale hides community tier', async ({ page, convexHelper }) => {
      const testEmail = `tier-noslidingscale-${Date.now()}@example.com`;
      const eventTitle = `E2E No Sliding Scale ${Date.now()}`;

      const { checkout } = await setupTierTest(convexHelper, page, {
        testEmail,
        userName: 'No Sliding Scale User',
        eventTitle,
        price: 2000,
        supporterDefaultPrice: 3000,
        slidingScaleEnabled: false,
      });

      // Regular and Supporter should be visible
      await expect.poll(() => checkout.isTierVisible('regular')).toBe(true);
      await expect.poll(() => checkout.isTierVisible('supporter')).toBe(true);

      // Community tier should NOT be visible
      await expect.poll(() => checkout.isTierVisible('notaflof')).toBe(false);
    });
  });

  test.describe('Tier Price Updates', () => {
    test('selecting supporter tier updates displayed price', async ({ page, convexHelper }) => {
      const testEmail = `tier-price-${Date.now()}@example.com`;
      const eventTitle = `E2E Price Update ${Date.now()}`;

      const { checkout } = await setupTierTest(convexHelper, page, {
        testEmail,
        userName: 'Price Update User',
        eventTitle,
        price: 2000, // $20.00
        supporterDefaultPrice: 3000, // $30.00
        slidingScaleEnabled: true,
        slidingScaleMin: 500,
        slidingScaleMax: 2000,
      });

      // Initially Regular tier should be selected, showing $20.00 in the Total Due section
      await expect.poll(() => checkout.getTotalText()).toContain('$20.00');

      // Click Supporter tier via harness
      await checkout.selectTier('supporter');

      // Total should now show $30.00
      await expect.poll(() => checkout.getTotalText()).toContain('$30.00');
    });
  });

  test.describe('Complete Purchase with Tier', () => {
    test('purchase with supporter tier records correct tier on ticket', async ({
      page,
      convexHelper,
    }) => {
      // Capture console errors for debugging
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          console.log(`BROWSER [${msg.type()}]: ${msg.text()}`);
        }
      });

      const testEmail = `tier-purchase-${Date.now()}@example.com`;
      const eventTitle = `E2E Tier Purchase ${Date.now()}`;

      // 1. Seed user, vet, seed event, login, navigate, open checkout
      const { checkout: purchaseCheckout } = await setupTierTest(convexHelper, page, {
        testEmail,
        userName: 'Tier Purchase User',
        eventTitle,
        price: 1500, // $15.00
        supporterDefaultPrice: 2500, // $25.00
        slidingScaleEnabled: true,
        slidingScaleMin: 500,
        slidingScaleMax: 1500,
      });

      // 2. Select Supporter tier via harness
      await purchaseCheckout.selectTier('supporter');

      // 4. Mount embedded checkout and complete the mock payment
      await fillAndSubmitPayment(page);

      // 5. Verify Success
      await waitForPaymentSuccess(page);

      // 7. Navigate to tickets page
      const tierTicketsHarness = await goToMyTickets(page);

      // 8. Verify ticket card appears with correct tier in the UI via harness
      await expect
        .poll(() => tierTicketsHarness.getTicketCardByEventTitle(eventTitle), {
          timeout: 30000,
          message: `Ticket card for "${eventTitle}" not found`,
        })
        .toBeTruthy();
      const tierTicketCard = (await tierTicketsHarness.getTicketCardByEventTitle(eventTitle))!;
      await expect
        .poll(() => tierTicketCard.getTierText(), { timeout: 10000 })
        .toMatch(/supporter/i);
    });

    test('purchase with community tier records notaflof on ticket', async ({
      page,
      convexHelper,
    }) => {
      const testEmail = `community-tier-${Date.now()}@example.com`;
      const eventTitle = `E2E Community ${Date.now()}`;

      // 1. Seed user, vet, seed event, login, navigate, open checkout
      const { checkout: communityCheckout } = await setupTierTest(convexHelper, page, {
        testEmail,
        userName: 'Community Tier User',
        eventTitle,
        price: 2000, // $20.00
        supporterDefaultPrice: 3000,
        slidingScaleEnabled: true,
        slidingScaleMin: 500, // $5.00
        slidingScaleMax: 2000,
      });

      // 2. Select Community tier via harness
      await communityCheckout.selectTier('notaflof');

      // 4. Community tier should show a slider - verify minimum amount shows ($5.00)
      await expect
        .poll(() => communityCheckout.getTotalText(), { timeout: 10000 })
        .toContain('$5.00');

      // 5. Mount embedded checkout and complete the mock payment
      await fillAndSubmitPayment(page);

      // 6. Verify Success
      await waitForPaymentSuccess(page);

      // 7. Navigate to tickets page
      const communityTicketsHarness = await goToMyTickets(page);

      // 8. Verify ticket card is present with notaflof tier in the UI via harness
      await expect
        .poll(() => communityTicketsHarness.getTicketCardByEventTitle(eventTitle), {
          timeout: 30000,
          message: `Ticket card for "${eventTitle}" not found`,
        })
        .toBeTruthy();
      const communityTicketCard =
        (await communityTicketsHarness.getTicketCardByEventTitle(eventTitle))!;
      await expect
        .poll(() => communityTicketCard.getTierText(), { timeout: 10000 })
        .toMatch(/notaflof/i);
    });
  });

  test.describe('Revenue Verification', () => {
    test('admin event management shows revenue by tier', async ({
      page,
      adminPage,
      convexHelper,
    }) => {
      test.slow(); // This test performs a full purchase flow + admin verification, taking longer

      const testEmail = `revenue-test-${Date.now()}@example.com`;
      const eventTitle = `E2E Revenue Test ${Date.now()}`;

      // 1. Seed user, vet, seed event, login, navigate, open checkout
      const { eventId, checkout: revenueCheckout } = await setupTierTest(convexHelper, page, {
        testEmail,
        userName: 'Revenue Test User',
        eventTitle,
        price: 2000, // $20.00
        supporterDefaultPrice: 4000, // $40.00
        slidingScaleEnabled: false,
      });

      // 2. User purchases with supporter tier via harness
      await revenueCheckout.selectTier('supporter');

      await fillAndSubmitPayment(page);
      await waitForPaymentSuccess(page);

      // 3. Admin navigates to event management
      // Note: adminPage is a shared fixture — this test reads admin data but does not mutate admin user state
      await adminPage.goto(`/admin/events/${eventId}/manage`);
      await expect(adminPage).toHaveURL(new RegExp(`/admin/events/${eventId}/manage`), {
        timeout: 15000,
      });

      // 4. Verify revenue by tier is displayed correctly
      const eventManagement = await getHarnessWhenVisible(adminPage, EventManagementHarness);
      await expect.poll(() => eventManagement.getTicketsSoldText(), { timeout: 10000 }).not.toBe('');
      await expect
        .poll(() => eventManagement.getRevenueTierText('supporter'), { timeout: 10000 })
        .toContain('$40.00');
    });
  });
});
