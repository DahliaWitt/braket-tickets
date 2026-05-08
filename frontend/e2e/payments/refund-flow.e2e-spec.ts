import {
  test,
  expect,
  uniqueName,
  createEnvironment,
} from '../helpers/test-setup';
import type {Page} from '@playwright/test';
import {api} from '@convex/_generated/api';
import {Id} from '@convex/_generated/dataModel';
import {seedStripeReadyOrganizer} from '../test-utils/stripe-organizer-fixture';
import {EventManagementHarness} from '../../src/app/features/admin/pages/event-management/event-management.harness';

async function clickRefundButton(row: ReturnType<Page['locator']>) {
  const refundBtn = row.getByTestId('refund-payment-action');
  await refundBtn.scrollIntoViewIfNeeded();
  await refundBtn.click();
}

async function clickForceRefundAllButton(row: ReturnType<Page['locator']>) {
  const forceRefundBtn = row.getByTestId('force-refund-all-action');
  await forceRefundBtn.scrollIntoViewIfNeeded();
  await forceRefundBtn.click();
}

async function confirmRefundDialog(
  page: Page,
  confirmButtonName: 'Refund Payment' | 'Force Refund All',
) {
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible({timeout: 5000});
  await dialog.getByRole('button', {name: confirmButtonName}).click();
  await expect(dialog).not.toBeVisible({timeout: 5000});
}

function stripeSeedFields() {
  return {
    stripePaymentIntentId: `pi_mock_refund_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`,
  };
}

/**
 * E2E tests for partial refund functionality.
 *
 * These tests verify that the refund system correctly calculates refund amounts
 * based on ticket usage. The backend logic at backend/convex/payments/refunds.ts uses
 * calculateRefundableAmount to determine: (validTicketCount / totalTicketCount) * amount.
 *
 * Orders are seeded with Stripe metadata so refund actions exercise the
 * Stripe refund path (not deprecated Square-only refund behavior).
 */
test.describe('Partial Refund Flow', () => {
  test.use({viewport: {width: 1280, height: 900}});

  test('should refund 100% when no tickets are used', async ({
    adminPage,
    convexHelper,
  }) => {
    // 1. Seed buyer user
    const buyerRes = await convexHelper.action(
      api.testing.users_node.seedUserAndGetTokens,
      {
        email: `buyer-full-refund-${Date.now()}@test.com`,
        password: 'Password123!',
        name: 'Full Refund Buyer',
      },
    );
    const buyerId = buyerRes.userId as Id<'users'>;

    // 2. Seed event with $10 tickets
    const eventTitle = `Full Refund Event ${Date.now()}`;
    const fullRefundOrgId = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: uniqueName('Full Refund Org'),
      },
    );
    const eventId = await convexHelper.mutation(api.testing.events.seedEvent, {
      title: eventTitle,
      date: new Date().toISOString(),
      price: 1000, // $10 in cents
      totalTickets: 100,
      organizerId: fullRefundOrgId,
    });

    // 3. Create completed Stripe order for 4 tickets ($40 total)
    const orderId = await convexHelper.mutation(
      api.testing.orders.seedPayment,
      {
        userId: buyerId,
        eventId,
        amount: 4000, // $40 in cents
        status: 'completed',
        quantity: 4,
        trustSource: 'open_access',
        ...stripeSeedFields(),
      },
    );

    // 4. Seed 4 valid (unused) tickets linked to this order
    for (let i = 0; i < 4; i++) {
      await convexHelper.mutation(api.testing.tickets.seedTicket, {
        userId: buyerId,
        eventId,
        orderId,
        status: 'valid',
        tier: 'regular',
        trustSource: 'open_access',
      });
    }

    // 5. Navigate to Event Management
    await adminPage.goto(`/admin/events/${eventId}/manage`);
    await expect(
      adminPage.getByRole('heading', {name: eventTitle}),
    ).toBeVisible({
      timeout: 15000,
    });

    // 6. Switch to Buyers tab (default tab is Analytics)
    await adminPage.getByRole('tab', {name: /Buyers/i}).click();

    // 7. Find the buyer entry — scope to desktop container to avoid strict-mode
    // violation from duplicate data-testid on mobile card (div.md:hidden)
    const buyersContainer = adminPage.locator('div.hidden.md\\:block');
    const row = buyersContainer
      .locator('[data-testid="buyer-entry"]')
      .filter({hasText: 'Full Refund Buyer'});
    await expect(row).toBeVisible();
    await clickRefundButton(row);
    await confirmRefundDialog(adminPage, 'Refund Payment');

    // 8. Verify entry shows REFUNDED status
    // Increased timeout — backend contention can slow mutation processing
    await expect(row.getByText('REFUNDED')).toBeVisible({timeout: 20000});

    // 9. Verify Refund button is now disabled
    await expect(row.getByTestId('refund-payment-action')).toBeDisabled();
  });

  test('should refund 50% when half of tickets are used', async ({
    adminPage,
    convexHelper,
  }) => {
    // 1. Seed buyer user
    const buyerRes = await convexHelper.action(
      api.testing.users_node.seedUserAndGetTokens,
      {
        email: `buyer-partial-refund-${Date.now()}@test.com`,
        password: 'Password123!',
        name: 'Partial Refund Buyer',
      },
    );
    const buyerId = buyerRes.userId as Id<'users'>;

    // 2. Seed event with $10 tickets
    const eventTitle = `Partial Refund Event ${Date.now()}`;
    const partialRefundOrgId = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: uniqueName('Partial Refund Org'),
      },
    );
    const eventId = await convexHelper.mutation(api.testing.events.seedEvent, {
      title: eventTitle,
      date: new Date().toISOString(),
      price: 1000, // $10 in cents
      totalTickets: 100,
      organizerId: partialRefundOrgId,
    });

    // 3. Create completed Stripe order for 4 tickets ($40 total)
    const orderId = await convexHelper.mutation(
      api.testing.orders.seedPayment,
      {
        userId: buyerId,
        eventId,
        amount: 4000, // $40 in cents
        status: 'completed',
        quantity: 4,
        trustSource: 'open_access',
        ...stripeSeedFields(),
      },
    );

    // 4. Seed 2 valid (unused) tickets - these are refundable
    for (let i = 0; i < 2; i++) {
      await convexHelper.mutation(api.testing.tickets.seedTicket, {
        userId: buyerId,
        eventId,
        orderId,
        status: 'valid',
        tier: 'regular',
        trustSource: 'open_access',
      });
    }

    // 5. Seed 2 used tickets - these are NOT refundable
    for (let i = 0; i < 2; i++) {
      await convexHelper.mutation(api.testing.tickets.seedTicket, {
        userId: buyerId,
        eventId,
        orderId,
        status: 'used',
        tier: 'regular',
        trustSource: 'open_access',
      });
    }

    // 6. Navigate to Event Management
    await adminPage.goto(`/admin/events/${eventId}/manage`);
    await expect(
      adminPage.getByRole('heading', {name: eventTitle}),
    ).toBeVisible({
      timeout: 15000,
    });

    // 7. Switch to Buyers tab (default tab is Analytics)
    await adminPage.getByRole('tab', {name: /Buyers/i}).click();

    // 8. Find the buyer entry — scope to desktop container to avoid strict-mode
    // violation from duplicate data-testid on mobile card (div.md:hidden)
    const buyersContainer = adminPage.locator('div.hidden.md\\:block');
    const row = buyersContainer
      .locator('[data-testid="buyer-entry"]')
      .filter({hasText: 'Partial Refund Buyer'});
    await expect(row).toBeVisible();
    await clickRefundButton(row);
    await confirmRefundDialog(adminPage, 'Refund Payment');

    // 9. Partial refunds keep the purchase open for any remaining used tickets.
    // The standard refund path should be exhausted, but force refund all remains.
    await expect(row.getByTestId('refund-payment-action')).toBeDisabled();
    await expect(row.getByTestId('force-refund-all-action')).toBeEnabled();
    await expect(row.getByText('REFUNDED')).toHaveCount(0);
  });

  test('should show error when all tickets are used (must use force refund)', async ({
    adminPage,
    convexHelper,
  }) => {
    // 1. Seed buyer user
    const buyerRes = await convexHelper.action(
      api.testing.users_node.seedUserAndGetTokens,
      {
        email: `buyer-zero-refund-${Date.now()}@test.com`,
        password: 'Password123!',
        name: 'Zero Refund Buyer',
      },
    );
    const buyerId = buyerRes.userId as Id<'users'>;

    // 2. Seed event with $10 tickets
    const eventTitle = `Zero Refund Event ${Date.now()}`;
    const zeroRefundOrgId = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: uniqueName('Zero Refund Org'),
      },
    );
    const eventId = await convexHelper.mutation(api.testing.events.seedEvent, {
      title: eventTitle,
      date: new Date().toISOString(),
      price: 1000, // $10 in cents
      totalTickets: 100,
      organizerId: zeroRefundOrgId,
    });

    // 3. Create completed Stripe order for 4 tickets ($40 total)
    const orderId = await convexHelper.mutation(
      api.testing.orders.seedPayment,
      {
        userId: buyerId,
        eventId,
        amount: 4000, // $40 in cents
        status: 'completed',
        quantity: 4,
        trustSource: 'open_access',
        ...stripeSeedFields(),
      },
    );

    // 4. Seed 4 used tickets - ALL are used, so regular refund should fail
    for (let i = 0; i < 4; i++) {
      await convexHelper.mutation(api.testing.tickets.seedTicket, {
        userId: buyerId,
        eventId,
        orderId,
        status: 'used',
        tier: 'regular',
        trustSource: 'open_access',
      });
    }

    // 5. Navigate to Event Management
    await adminPage.goto(`/admin/events/${eventId}/manage`);
    await expect(
      adminPage.getByRole('heading', {name: eventTitle}),
    ).toBeVisible({
      timeout: 15000,
    });

    // 6. Switch to Buyers tab (default tab is Analytics)
    await adminPage.getByRole('tab', {name: /Buyers/i}).click();

    // 7. Find the buyer entry — scope to desktop container to avoid strict-mode
    // violation from duplicate data-testid on mobile card (div.md:hidden)
    const buyersContainer = adminPage.locator('div.hidden.md\\:block');
    const row = buyersContainer
      .locator('[data-testid="buyer-entry"]')
      .filter({hasText: 'Zero Refund Buyer'});
    await expect(row).toBeVisible();

    // 8. Regular refund is disabled because all tickets are used.
    await expect(row.getByTestId('refund-payment-action')).toBeDisabled();
    await expect(row.getByTestId('force-refund-all-action')).toBeEnabled();

    // 9. Force refund all should recover the order even when every ticket was used.
    await clickForceRefundAllButton(row);
    await confirmRefundDialog(adminPage, 'Force Refund All');

    await expect(row.getByText('REFUNDED')).toBeVisible({timeout: 20000});
    await expect(row.getByTestId('refund-payment-action')).toBeDisabled();
    await expect(row.getByTestId('force-refund-all-action')).toHaveCount(0);
  });

  test('should refund against a connected organizer (direct-charge path)', async ({
    adminPage,
    convexHelper,
  }) => {
    // 1. Seed buyer user
    const buyerRes = await convexHelper.action(
      api.testing.users_node.seedUserAndGetTokens,
      {
        email: `buyer-connect-refund-${Date.now()}@test.com`,
        password: 'Password123!',
        name: 'Connect Refund Buyer',
      },
    );
    const buyerId = buyerRes.userId as Id<'users'>;

    // 2. Seed a Stripe-ready (connected) organizer — this sets
    // `stripeConnectedAccountId` on the org row so
    // `insertSeedOrder` snapshots it onto `ticket_orders.connectedAccountId`.
    // The refund action then routes through the direct-charge branch
    // (`{stripeAccount}` + `refund_application_fee`) instead of the
    // platform refund branch the other tests in this file cover.
    const eventTitle = `Connect Refund Event ${Date.now()}`;
    const connectedOrgId = await seedStripeReadyOrganizer(
      convexHelper,
      uniqueName('Connect Refund Org'),
    );
    const eventId = await convexHelper.mutation(api.testing.events.seedEvent, {
      title: eventTitle,
      date: new Date().toISOString(),
      price: 1000,
      totalTickets: 100,
      organizerId: connectedOrgId as Id<'organizers'>,
    });

    // 3. Create a completed Stripe order on the connected organizer.
    const orderId = await convexHelper.mutation(
      api.testing.orders.seedPayment,
      {
        userId: buyerId,
        eventId,
        amount: 4000,
        status: 'completed',
        quantity: 4,
        trustSource: 'open_access',
        ...stripeSeedFields(),
      },
    );

    // 4. Seed 4 valid tickets so the full refund path is available.
    for (let i = 0; i < 4; i++) {
      await convexHelper.mutation(api.testing.tickets.seedTicket, {
        userId: buyerId,
        eventId,
        orderId,
        status: 'valid',
        tier: 'regular',
        trustSource: 'open_access',
      });
    }

    // 5. Navigate to Event Management and issue the refund through the UI.
    await adminPage.goto(`/admin/events/${eventId}/manage`);
    await expect(
      adminPage.getByRole('heading', {name: eventTitle}),
    ).toBeVisible({
      timeout: 15000,
    });

    // Switch to the Buyers tab via the CDK harness.
    const eventMgmt = await createEnvironment(adminPage).getHarness(
      EventManagementHarness,
    );
    await eventMgmt.clickTab('buyers');

    // Scope assertions to the specific order's row inside the desktop
    // container. `purchase-status` and `refund-payment-action` are
    // emitted in both the desktop table and the mobile card, so a bare
    // page-level selector would trip Playwright's strict-mode check.
    // Using a scoped locator is consistent with the rest of this spec —
    // after a refund the event-management subtree is re-rendered, which
    // can leave `@ngx-playwright/test`'s snapshotted harness handles
    // pointing at detached DOM nodes.
    const desktopContainer = adminPage.locator('div.hidden.md\\:block');
    const statusBadge = desktopContainer.locator(
      `[data-testid="purchase-status"][data-purchase-id="${orderId}"]`,
    );
    await expect(statusBadge).toHaveText(/regular/i, {timeout: 15000});

    await eventMgmt.clickRefundPaymentAction(orderId);
    await confirmRefundDialog(adminPage, 'Refund Payment');

    // 6. UI must flip to REFUNDED via the Convex subscription — full
    // stack assertion: direct-charge refund → order row update →
    // subscription push → signal → DOM.
    await expect(statusBadge).toHaveText('REFUNDED', {timeout: 20000});

    const refundBtn = desktopContainer.locator(
      `[data-testid="refund-payment-action"][data-purchase-id="${orderId}"]`,
    );
    await expect(refundBtn).toBeDisabled({timeout: 10000});
  });

  test('admin UI displays correct refund amount in revenue card', async ({
    adminPage,
    convexHelper,
  }) => {
    // 1. Seed buyer user
    const buyerRes = await convexHelper.action(
      api.testing.users_node.seedUserAndGetTokens,
      {
        email: `buyer-revenue-display-${Date.now()}@test.com`,
        password: 'Password123!',
        name: 'Revenue Display Buyer',
      },
    );
    const buyerId = buyerRes.userId as Id<'users'>;

    // 2. Seed event with $25 tickets
    const eventTitle = `Revenue Display Event ${Date.now()}`;
    const revenueDisplayOrgId = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: uniqueName('Revenue Display Org'),
      },
    );
    const eventId = await convexHelper.mutation(api.testing.events.seedEvent, {
      title: eventTitle,
      date: new Date().toISOString(),
      price: 2500, // $25 in cents
      totalTickets: 100,
      organizerId: revenueDisplayOrgId,
    });

    // 3. Create completed Stripe order for 4 tickets ($100 total)
    const orderId = await convexHelper.mutation(
      api.testing.orders.seedPayment,
      {
        userId: buyerId,
        eventId,
        amount: 10000, // $100 in cents
        status: 'completed',
        quantity: 4,
        trustSource: 'open_access',
        ...stripeSeedFields(),
      },
    );

    // 4. Seed 2 valid (unused) tickets - $50 refundable
    for (let i = 0; i < 2; i++) {
      await convexHelper.mutation(api.testing.tickets.seedTicket, {
        userId: buyerId,
        eventId,
        orderId,
        status: 'valid',
        tier: 'regular',
        trustSource: 'open_access',
      });
    }

    // 5. Seed 2 used tickets - NOT refundable
    for (let i = 0; i < 2; i++) {
      await convexHelper.mutation(api.testing.tickets.seedTicket, {
        userId: buyerId,
        eventId,
        orderId,
        status: 'used',
        tier: 'regular',
        trustSource: 'open_access',
      });
    }

    // 6. Navigate to Event Management
    await adminPage.goto(`/admin/events/${eventId}/manage`);
    await expect(
      adminPage.getByRole('heading', {name: eventTitle}),
    ).toBeVisible({
      timeout: 15000,
    });

    // 7. Switch to Buyers tab (default tab is Analytics)
    await adminPage.getByRole('tab', {name: /Buyers/i}).click();

    // Scope to desktop container to avoid strict-mode violation from duplicate
    // data-testid on mobile card (div.md:hidden)
    const buyersContainer = adminPage.locator('div.hidden.md\\:block');
    const row = buyersContainer
      .locator('[data-testid="buyer-entry"]')
      .filter({hasText: 'Revenue Display Buyer'});
    await expect(row).toBeVisible();
    await clickRefundButton(row);
    await confirmRefundDialog(adminPage, 'Refund Payment');

    // 9. Wait for the partial refund state to reload.
    await expect(row.getByTestId('refund-payment-action')).toBeDisabled({
      timeout: 10000,
    });
    await expect(row.getByTestId('force-refund-all-action')).toBeEnabled();

    // 10. Switch to Analytics tab to verify revenue card
    await adminPage.getByRole('tab', {name: /Analytics/i}).click();

    // 11. Verify the revenue card now shows refund amount
    // After partial refund of $50, the Refunds line should appear
    // The refund display is a div with "Refunds" label and the amount as "-$50.00"
    // Use data-testid for reliable targeting across viewports
    const refundsRow = adminPage.locator('[data-testid="revenue-refunds"]');
    await expect(refundsRow).toBeVisible({timeout: 5000});

    // Verify the refund amount is shown
    await expect(refundsRow).toContainText(/\$50\.00/);
  });
});
