import {test, expect, uniqueName} from './helpers/test-setup';
import {getHarnessWhenVisible} from './helpers/harness-helpers';
import {signInUser} from './test-utils/auth-helpers';
import {
  fillAndSubmitPayment,
  waitForPaymentSuccess,
} from './test-utils/payment-helpers';
import {api} from '@convex/_generated/api';
import type {Id} from '@convex/_generated/dataModel';
import {ZardTicketsHarness} from '../src/app/features/tickets/pages/tickets/tickets.component.harness';
import {EventManagementHarness} from '../src/app/features/admin/pages/event-management/event-management.harness';
import {EventDetailsHarness} from '../src/app/features/tickets/pages/event-details/event-details.component.harness';
import {CheckoutSidebarHarness} from '../src/app/features/tickets/components/checkout-sidebar/checkout-sidebar.component.harness';

/**
 * E2E Tests for Ticket Resale Flow
 *
 * Every test exercises real UI interactions — navigating pages, clicking
 * buttons, and verifying visible outcomes. Backend seeding via convexHelper
 * is only used to set up prerequisite data (events, users, tickets).
 */
test.describe('Resale: Buyer Purchase Flow', () => {
  test.slow();

  test('buyer can purchase a resale ticket on a sold-out event', async ({
    page,
    convexHelper,
  }) => {
    // --- Setup: sold-out event with one resale listing ---
    const sellerEmail = `seller-${Date.now()}@test.com`;
    const seller = await convexHelper.action(
      api.testing.users_node.seedUserAndGetTokens,
      {
        email: sellerEmail,
        password: 'SellerPass123!',
        name: 'Resale Seller',
      },
    );

    const eventTitle = uniqueName('Resale Purchase Event');
    const organizerId = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: uniqueName('Resale Purchase Org'),
        isPlatformOrganizer: true,
      },
    );
    const eventId = await convexHelper.mutation(api.testing.events.seedEvent, {
      title: eventTitle,
      date: new Date(2030, 5, 1).toISOString(),
      price: 1000, // $10.00
      totalTickets: 1, // Only 1 ticket — sold out once seller has it
      status: 'published',
      visibility: 'public',
      organizerId,
      resaleEnabled: true,
      resaleFeePct: 4.2,
      maxTicketsPerUser: 4,
    });

    // Seller owns the only ticket — event is now sold out
    const ticketId = await convexHelper.mutation(
      api.testing.tickets.seedTicket,
      {
        userId: seller.userId as Id<'users'>,
        eventId: eventId as Id<'events'>,
        status: 'valid',
        tier: 'regular',
        trustSource: 'open_access',
      },
    );

    // Seller lists their ticket for resale
    await convexHelper.mutation(api.testing.resale.seedResaleListing, {
      ticketId: ticketId as Id<'tickets'>,
      eventId: eventId as Id<'events'>,
      sellerId: seller.userId as Id<'users'>,
      status: 'listed',
    });

    // --- Buyer: seed, vet, and login ---
    const buyerEmail = `buyer-${Date.now()}@test.com`;
    await convexHelper.action(api.testing.users_node.seedUserAndGetTokens, {
      email: buyerEmail,
      password: 'BuyerPass123!',
      name: 'Resale Buyer',
    });

    await signInUser(page, buyerEmail, 'BuyerPass123!');

    // --- Act: navigate to event and purchase resale ticket ---
    await page.goto(`/events/${eventId}`);
    const eventDetails = await getHarnessWhenVisible(page, EventDetailsHarness);
    await expect
      .poll(() => eventDetails.getEventTitle(), {timeout: 15000})
      .toBe(eventTitle);

    // Verify resale availability banner
    await expect
      .poll(() => eventDetails.isResaleAvailableBannerVisible(), {
        timeout: 10000,
      })
      .toBe(true);

    // Click the resale purchase button
    await expect
      .poll(() => eventDetails.isGetTicketsButtonVisible())
      .toBe(true);
    await eventDetails.clickGetTickets();

    // Verify embedded checkout shell opened
    const checkout = await getHarnessWhenVisible(
      page,
      CheckoutSidebarHarness,
      15000,
      'attached',
    );
    await expect
      .poll(() => checkout.getHeadingText(), {timeout: 10000})
      .toBe('Checkout');

    // Mount embedded checkout and complete the mock payment
    await fillAndSubmitPayment(page);

    // Verify success
    await waitForPaymentSuccess(page);

    // Navigate to tickets page and verify buyer has the ticket
    await expect
      .poll(() => checkout.isViewTicketsVisible(), {timeout: 20000})
      .toBe(true);
    await checkout.clickViewTickets();
    await expect(page).toHaveURL(/.*tickets/);
    const buyerTicketsHarness = await getHarnessWhenVisible(
      page,
      ZardTicketsHarness,
    );
    await expect
      .poll(() => buyerTicketsHarness.getTicketCardByEventTitle(eventTitle), {
        timeout: 30000,
        message: `Ticket card for "${eventTitle}" not found`,
      })
      .toBeTruthy();
    const buyerTicketCard =
      (await buyerTicketsHarness.getTicketCardByEventTitle(eventTitle))!;
    await expect
      .poll(() => buyerTicketCard.getStatusBadgeText(), {timeout: 10000})
      .toBe('VALID');
  });

  test('buyer sees notification option on sold-out event with no resale listings', async ({
    page,
    convexHelper,
  }) => {
    // --- Setup: sold-out event, resale enabled, but no listings ---
    const sellerEmail = `seller-notify-${Date.now()}@test.com`;
    const seller = await convexHelper.action(
      api.testing.users_node.seedUserAndGetTokens,
      {
        email: sellerEmail,
        password: 'SellerPass123!',
        name: 'Notify Seller',
      },
    );

    const eventTitle = uniqueName('Resale Notify Event');
    const notifyOrgId = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: uniqueName('Resale Notify Org'),
        isPlatformOrganizer: true,
      },
    );
    const eventId = await convexHelper.mutation(api.testing.events.seedEvent, {
      title: eventTitle,
      date: new Date(2030, 5, 2).toISOString(),
      price: 1500,
      totalTickets: 1,
      status: 'published',
      organizerId: notifyOrgId,
      resaleEnabled: true,
    });

    // Seller owns the only ticket (sold out), but does NOT list for resale
    await convexHelper.mutation(api.testing.tickets.seedTicket, {
      userId: seller.userId as Id<'users'>,
      eventId: eventId as Id<'events'>,
      status: 'valid',
      tier: 'regular',
      trustSource: 'open_access',
    });

    // --- Buyer navigates to sold-out event ---
    const buyerEmail = `buyer-notify-${Date.now()}@test.com`;
    const buyer = await convexHelper.action(
      api.testing.users_node.seedUserAndGetTokens,
      {
        email: buyerEmail,
        password: 'BuyerPass123!',
        name: 'Notify Buyer',
      },
    );

    // Vet the buyer so they can see resale options on private events
    await convexHelper.mutation(api.testing.applications.seedApplication, {
      userId: buyer.userId as Id<'users'>,
      organizerId: notifyOrgId,
      status: 'approved',
    });

    await signInUser(page, buyerEmail, 'BuyerPass123!');

    await page.goto(`/events/${eventId}`);
    const eventDetails = await getHarnessWhenVisible(page, EventDetailsHarness);
    await expect
      .poll(() => eventDetails.getEventTitle(), {timeout: 15000})
      .toBe(eventTitle);

    // Should show sold out state
    await expect
      .poll(() => eventDetails.isSoldOutBannerVisible(), {timeout: 10000})
      .toBe(true);

    // Should show "Get Notified" button (resale enabled but no listings)
    await expect
      .poll(() => eventDetails.isResaleNotifyButtonVisible())
      .toBe(true);

    // Click to subscribe
    await eventDetails.clickResaleNotifyButton();

    // Verify subscription confirmation (bell-ring banner replaces button)
    await expect
      .poll(() => eventDetails.isResaleNotifyButtonVisible(), {timeout: 10000})
      .toBe(false);
    await expect
      .poll(() => eventDetails.isResaleNotifySubscribedVisible(), {
        timeout: 10000,
      })
      .toBe(true);
    await expect
      .poll(() => eventDetails.getResaleNotifySubscribedText(), {
        timeout: 10000,
      })
      .toContain("You'll be notified when a resale ticket becomes available");
  });
});

test.describe('Resale: Seller Listing Flow', () => {
  test.slow();

  test('seller can list a ticket for resale from tickets page', async ({
    page,
    convexHelper,
  }) => {
    // --- Setup: seller with a valid ticket on resale-enabled event ---
    const sellerEmail = `seller-list-${Date.now()}@test.com`;
    const seller = await convexHelper.action(
      api.testing.users_node.seedUserAndGetTokens,
      {
        email: sellerEmail,
        password: 'SellerPass123!',
        name: 'Listing Seller',
      },
    );

    const eventTitle = uniqueName('Resale List Event');
    const listOrgId = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: uniqueName('Resale List Org'),
        isPlatformOrganizer: true,
      },
    );
    const eventId = await convexHelper.mutation(api.testing.events.seedEvent, {
      title: eventTitle,
      date: new Date(2030, 6, 1).toISOString(),
      price: 2500,
      totalTickets: 10,
      status: 'published',
      organizerId: listOrgId,
      resaleEnabled: true,
    });

    await convexHelper.mutation(api.testing.tickets.seedTicket, {
      userId: seller.userId as Id<'users'>,
      eventId: eventId as Id<'events'>,
      status: 'valid',
      tier: 'regular',
      trustSource: 'open_access',
    });

    // --- Act: login, navigate to tickets, list for resale ---
    await signInUser(page, sellerEmail, 'SellerPass123!');

    await page.goto('/tickets');
    const listTicketsHarness = await getHarnessWhenVisible(
      page,
      ZardTicketsHarness,
    );
    await expect
      .poll(() => listTicketsHarness.getTicketCardByEventTitle(eventTitle), {
        timeout: 30000,
        message: `Ticket card for "${eventTitle}" not found`,
      })
      .toBeTruthy();
    const listTicketCard =
      (await listTicketsHarness.getTicketCardByEventTitle(eventTitle))!;

    // Click "List for Resale" button via harness
    await listTicketCard.clickListForResale();
    await expect
      .poll(() => listTicketCard.hasResaleConfirmationPanel(), {timeout: 10000})
      .toBe(true);
    await listTicketCard.clickConfirmResaleListing();

    // Verify listing status appears (blue "LISTED" badge) via harness
    await expect
      .poll(() => listTicketCard.getStatusBadgeText(), {timeout: 10000})
      .toBe('LISTED');
    // Cancel button should now be visible via harness
    await expect
      .poll(() => listTicketCard.hasCancelListingButton(), {timeout: 10000})
      .toBe(true);
  });

  test('seller can cancel a resale listing from tickets page', async ({
    page,
    convexHelper,
  }) => {
    // --- Setup: seller with an existing resale listing ---
    const sellerEmail = `seller-cancel-${Date.now()}@test.com`;
    const seller = await convexHelper.action(
      api.testing.users_node.seedUserAndGetTokens,
      {
        email: sellerEmail,
        password: 'SellerPass123!',
        name: 'Cancel Seller',
      },
    );

    const eventTitle = uniqueName('Resale Cancel Event');
    const cancelOrgId = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: uniqueName('Resale Cancel Org'),
        isPlatformOrganizer: true,
      },
    );
    const eventId = await convexHelper.mutation(api.testing.events.seedEvent, {
      title: eventTitle,
      date: new Date(2030, 6, 2).toISOString(),
      price: 2500,
      totalTickets: 10,
      status: 'published',
      organizerId: cancelOrgId,
      resaleEnabled: true,
    });

    const ticketId = await convexHelper.mutation(
      api.testing.tickets.seedTicket,
      {
        userId: seller.userId as Id<'users'>,
        eventId: eventId as Id<'events'>,
        status: 'valid',
        tier: 'regular',
        trustSource: 'open_access',
      },
    );

    // Pre-seed an active listing (seller already listed via backend)
    await convexHelper.mutation(api.testing.resale.seedResaleListing, {
      ticketId: ticketId as Id<'tickets'>,
      eventId: eventId as Id<'events'>,
      sellerId: seller.userId as Id<'users'>,
      status: 'listed',
    });

    // --- Act: login, navigate to tickets, cancel listing ---
    await signInUser(page, sellerEmail, 'SellerPass123!');

    await page.goto('/tickets');
    const cancelTicketsHarness = await getHarnessWhenVisible(
      page,
      ZardTicketsHarness,
    );
    await expect
      .poll(() => cancelTicketsHarness.getTicketCardByEventTitle(eventTitle), {
        timeout: 30000,
        message: `Ticket card for "${eventTitle}" not found`,
      })
      .toBeTruthy();
    const cancelTicketCard =
      (await cancelTicketsHarness.getTicketCardByEventTitle(eventTitle))!;

    // Verify listing is shown (LISTED badge) via harness
    await expect
      .poll(() => cancelTicketCard.getStatusBadgeText(), {timeout: 10000})
      .toBe('LISTED');

    // Click cancel via harness
    await cancelTicketCard.clickCancelListing();

    // Verify listing is cancelled — cancel button gone and list button reappears
    await expect
      .poll(() => cancelTicketCard.hasCancelListingButton(), {timeout: 10000})
      .toBe(false);
    await expect
      .poll(() => cancelTicketCard.hasListForResaleButton(), {timeout: 10000})
      .toBe(true);
  });
});

test.describe('Resale: Admin Management', () => {
  test.slow();

  test('admin can view resale listings in event management', async ({
    adminPage,
    convexHelper,
  }) => {
    // --- Setup: event with resale listing ---
    const eventTitle = uniqueName('Admin Resale Event');
    const adminResaleOrgId = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: uniqueName('Admin Resale Org'),
        isPlatformOrganizer: true,
      },
    );
    const eventId = await convexHelper.mutation(api.testing.events.seedEvent, {
      title: eventTitle,
      date: new Date(2030, 7, 1).toISOString(),
      price: 2500,
      totalTickets: 10,
      status: 'published',
      organizerId: adminResaleOrgId,
      resaleEnabled: true,
      resaleFeePct: 4.2,
    });

    const sellerId = await convexHelper.mutation(
      api.testing.users.createUserDirectly,
      {
        email: `admin-view-seller-${Date.now()}@test.com`,
        name: 'Admin View Seller',
      },
    );

    const ticketId = await convexHelper.mutation(
      api.testing.tickets.seedTicket,
      {
        userId: sellerId as Id<'users'>,
        eventId: eventId as Id<'events'>,
        status: 'valid',
        tier: 'regular',
        trustSource: 'open_access',
      },
    );

    await convexHelper.mutation(api.testing.resale.seedResaleListing, {
      ticketId: ticketId as Id<'tickets'>,
      eventId: eventId as Id<'events'>,
      sellerId: sellerId as Id<'users'>,
      status: 'listed',
    });

    // --- Act: navigate to admin management, click resale tab ---
    await adminPage.goto(`/admin/events/${eventId}/manage`);
    const eventMgmtHarness = await getHarnessWhenVisible(
      adminPage,
      EventManagementHarness,
    );
    await expect
      .poll(() => eventMgmtHarness.getActiveTabAttribute('analytics'), {
        timeout: 15000,
      })
      .toBe('true');

    // Click resale tab via harness
    await eventMgmtHarness.clickTab('resale');

    // Verify resale toggle is on via harness
    await expect
      .poll(() => eventMgmtHarness.isResaleToggleChecked(), {timeout: 10000})
      .toBe(true);

    // Verify queue shows 1 active listing via harness
    await expect
      .poll(() => eventMgmtHarness.getResaleQueueCountText(), {timeout: 10000})
      .toContain('1 ACTIVE');

    // Verify seller listing is present in the resale panel
    await expect
      .poll(() => eventMgmtHarness.getResaleListingRowCount(), {timeout: 10000})
      .toBe(1);
  });
});
