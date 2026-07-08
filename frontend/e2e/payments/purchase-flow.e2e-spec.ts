import {
  test,
  expect,
  uniqueName,
  type ConvexHelper,
} from '../helpers/test-setup';
import {type Page} from '@playwright/test';
import {getHarnessWhenVisible} from '../helpers/harness-helpers';
import {signInUser} from '../test-utils/auth-helpers';
import {
  fillAndSubmitPayment,
  waitForPaymentSuccess,
} from '../test-utils/payment-helpers';
import {seedStripeReadyOrganizer} from '../test-utils/stripe-organizer-fixture';
import {EventDetailsHarness} from '../../src/app/features/tickets/pages/event-details/event-details.component.harness';
import {CheckoutSidebarHarness} from '../../src/app/features/tickets/components/checkout-sidebar/checkout-sidebar.component.harness';
import {AppStripePaymentHarness} from '../../src/app/features/tickets/components/stripe-payment/stripe-payment.component.harness';
import {ZardTicketsHarness} from '../../src/app/features/tickets/pages/tickets/tickets.component.harness';
import {LoginPage} from '../page-objects/login.page';

import {api} from '@convex/_generated/api';
import {Id} from '@convex/_generated/dataModel';

async function goToMyTickets(page: Page): Promise<ZardTicketsHarness> {
  const checkout = await getHarnessWhenVisible(
    page,
    CheckoutSidebarHarness,
    15000,
    'attached',
  );
  await expect
    .poll(() => checkout.isViewTicketsVisible(), {timeout: 20000})
    .toBe(true);
  await checkout.clickViewTickets();
  await expect(page).toHaveURL(/\/tickets/, {timeout: 20000});
  return getHarnessWhenVisible(page, ZardTicketsHarness);
}

type DemoSeedKey =
  | 'cooperId'
  | 'kimId'
  | 'nomiId'
  | 'barneyId'
  | 'charlieId'
  | 'tobiasId'
  | 'cherylId';

const DEMO_CHECKOUT_USERS: Array<{key: DemoSeedKey; name: string}> = [
  {key: 'cooperId', name: 'Dale Cooper'},
  {key: 'kimId', name: 'Kim Wexler'},
  {key: 'nomiId', name: 'Nomi Marks'},
  {key: 'barneyId', name: 'Barney Calhoun'},
  {key: 'charlieId', name: 'Charlie Kelly'},
  {key: 'tobiasId', name: 'Tobias Funke'},
  {key: 'cherylId', name: 'Cheryl Tunt'},
];

async function seedDemoCheckoutFixture(convexHelper: ConvexHelper) {
  const nonce = Date.now();
  const password = 'Password123!';
  const seededUsers = await Promise.all(
    DEMO_CHECKOUT_USERS.map(async (user) => {
      const email = `seeded-checkout-${user.key}-${nonce}@example.com`;
      const result = (await convexHelper.action(
        api.testing.users_node.seedUserAndGetTokens,
        {
          email,
          password,
          name: `${user.name} ${nonce}`,
        },
      )) as {userId: Id<'users'>};
      return [user.key, {email, userId: result.userId}] as const;
    }),
  );
  const usersByKey = Object.fromEntries(seededUsers) as Record<
    DemoSeedKey,
    {email: string; userId: Id<'users'>}
  >;

  const demo = await convexHelper.mutation(api.testing.demo.seedDemoData, {
    cooperId: usersByKey.cooperId.userId,
    kimId: usersByKey.kimId.userId,
    nomiId: usersByKey.nomiId.userId,
    barneyId: usersByKey.barneyId.userId,
    charlieId: usersByKey.charlieId.userId,
    tobiasId: usersByKey.tobiasId.userId,
    cherylId: usersByKey.cherylId.userId,
  });

  return {
    eventId: demo.events.rooftopListeningId as Id<'events'>,
    tobiasEmail: usersByKey.tobiasId.email,
    password,
  };
}

test.describe('Payment Purchase Flow', () => {
  test(
    'seeded Rooftop Listening checkout exposes embedded payment',
    {tag: '@smoke'},
    async ({page, convexHelper}) => {
      test.slow();

      const {eventId, tobiasEmail, password} =
        await seedDemoCheckoutFixture(convexHelper);

      await signInUser(page, tobiasEmail, password);
      await page.goto(`/events/${eventId}?buy=true`);

      const checkout = await getHarnessWhenVisible(
        page,
        CheckoutSidebarHarness,
        15000,
        'attached',
      );
      await expect
        .poll(() => checkout.getHeadingText(), {timeout: 10000})
        .toBe('Checkout');
      await expect
        .poll(() => checkout.isPaymentSetupIncomplete(), {timeout: 10000})
        .toBe(false);

      const stripePayment = await getHarnessWhenVisible(
        page,
        AppStripePaymentHarness,
        15000,
        'attached',
      );
      await expect
        .poll(() => stripePayment.isReady(), {timeout: 10000})
        .toBe(true);
      await stripePayment.clickPay();
      await expect
        .poll(() => stripePayment.isPaymentElementVisible(), {timeout: 15000})
        .toBe(true);
    },
  );

  test('guest can complete a public ticket purchase', async ({
    page,
    convexHelper,
  }) => {
    test.slow();

    const guestEmail = `guest-purchase-${Date.now()}@example.com`;
    const eventTitle = `E2E Guest Payment Event ${Date.now()}`;
    const purchaseOrgId = await seedStripeReadyOrganizer(
      convexHelper,
      uniqueName('Guest Purchase Org'),
    );
    const eventId = await convexHelper.mutation(api.testing.events.seedEvent, {
      title: eventTitle,
      date: new Date(2030, 0, 2).toISOString(),
      price: 1000,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId: purchaseOrgId as Id<'organizers'>,
      supporterDefaultPrice: 1500,
      maxTicketsPerUser: 4,
    });

    await page.goto(`/events/${eventId}`);
    const eventDetails = await getHarnessWhenVisible(page, EventDetailsHarness);

    await expect(page).toHaveURL(new RegExp(`/events/${eventId}`), {
      timeout: 15000,
    });
    await expect
      .poll(() => eventDetails.getEventTitle(), {timeout: 20000})
      .toBe(eventTitle);
    await expect
      .poll(() => eventDetails.isGetTicketsButtonVisible(), {timeout: 20000})
      .toBe(true);

    await eventDetails.clickGetTickets();

    const checkout = await getHarnessWhenVisible(
      page,
      CheckoutSidebarHarness,
      15000,
      'attached',
    );
    await expect
      .poll(() => checkout.getHeadingText(), {timeout: 10000})
      .toBe('Checkout');

    await checkout.setGuestEmail(guestEmail);
    await checkout.submitGuestEmail();

    // Guests must assent to the ToS + privacy terms before the Stripe payment
    // element mounts (BRA-455). Without this the checkout gate never opens and
    // the payment harness wait below would hang.
    await expect
      .poll(() => checkout.isTermsCheckboxVisible(), {timeout: 10000})
      .toBe(true);
    await checkout.acceptTerms();

    const stripePayment = await getHarnessWhenVisible(
      page,
      AppStripePaymentHarness,
      15000,
      'attached',
    );
    await expect
      .poll(() => stripePayment.isReady(), {timeout: 10000})
      .toBe(true);

    await fillAndSubmitPayment(page);

    await waitForPaymentSuccess(page, 'guest');
    await expect(page.getByTestId('checkout-view-tickets')).toHaveCount(0);
  });

  test('signing in from checkout preserves the buy return URL and reopens checkout', async ({
    page,
    convexHelper,
  }) => {
    test.slow();

    const testEmail = `checkout-return-${Date.now()}@example.com`;
    const testPassword = 'Password123!';
    await convexHelper.action(api.testing.users_node.seedUserAndGetTokens, {
      email: testEmail,
      password: testPassword,
      name: `Checkout Return User ${Date.now()}`,
    });

    const eventTitle = `E2E Checkout Return Event ${Date.now()}`;
    const purchaseOrgId = await seedStripeReadyOrganizer(
      convexHelper,
      uniqueName('Checkout Return Org'),
    );
    const eventId = await convexHelper.mutation(api.testing.events.seedEvent, {
      title: eventTitle,
      date: new Date(2030, 0, 3).toISOString(),
      price: 1200,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId: purchaseOrgId as Id<'organizers'>,
      supporterDefaultPrice: 1800,
      maxTicketsPerUser: 4,
    });

    await page.goto(`/events/${eventId}`);
    const eventDetails = await getHarnessWhenVisible(page, EventDetailsHarness);

    await expect
      .poll(() => eventDetails.getEventTitle(), {timeout: 20000})
      .toBe(eventTitle);
    await expect
      .poll(() => eventDetails.isGetTicketsButtonVisible(), {timeout: 20000})
      .toBe(true);

    await eventDetails.clickGetTickets();

    const checkout = await getHarnessWhenVisible(
      page,
      CheckoutSidebarHarness,
      15000,
      'attached',
    );
    await expect(page).toHaveURL(new RegExp(`/events/${eventId}\\?buy=true`), {
      timeout: 15000,
    });

    const signInHref = await checkout.getGuestSidebarSignInHref();
    expect(signInHref).toBeTruthy();

    const signInUrl = new URL(signInHref!, 'http://127.0.0.1');
    expect(signInUrl.pathname).toBe('/login');
    expect(signInUrl.searchParams.get('returnUrl')).toBe(
      `/events/${eventId}?buy=true`,
    );

    await checkout.clickGuestSidebarSignIn();

    const loginPage = new LoginPage(page);
    await loginPage.waitForReady();
    await loginPage.setLoginEmail(testEmail);
    await loginPage.setLoginPassword(testPassword);
    await loginPage.submitLogin();

    await expect(page).toHaveURL(new RegExp(`/events/${eventId}\\?buy=true`), {
      timeout: 20000,
    });

    const reopenedCheckout = await getHarnessWhenVisible(
      page,
      CheckoutSidebarHarness,
      15000,
      'attached',
    );
    await expect
      .poll(() => reopenedCheckout.getHeadingText(), {timeout: 10000})
      .toBe('Checkout');
  });

  test('browser back closes the checkout sidebar and clears the buy query param', async ({
    page,
    convexHelper,
  }) => {
    test.slow();

    const testEmail = `checkout-back-${Date.now()}@example.com`;
    const testPassword = 'Password123!';
    await convexHelper.action(api.testing.users_node.seedUserAndGetTokens, {
      email: testEmail,
      password: testPassword,
      name: `Checkout Back User ${Date.now()}`,
    });

    const eventTitle = `E2E Checkout Back Event ${Date.now()}`;
    const purchaseOrgId = await seedStripeReadyOrganizer(
      convexHelper,
      uniqueName('Checkout Back Org'),
    );
    const eventId = await convexHelper.mutation(api.testing.events.seedEvent, {
      title: eventTitle,
      date: new Date(2030, 0, 4).toISOString(),
      price: 1500,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId: purchaseOrgId as Id<'organizers'>,
      supporterDefaultPrice: 2200,
      maxTicketsPerUser: 4,
    });

    await signInUser(page, testEmail, testPassword);

    await page.goto(`/events/${eventId}`);
    const eventDetails = await getHarnessWhenVisible(page, EventDetailsHarness);

    await expect
      .poll(() => eventDetails.getEventTitle(), {timeout: 20000})
      .toBe(eventTitle);
    await expect
      .poll(() => eventDetails.isGetTicketsButtonVisible(), {timeout: 20000})
      .toBe(true);

    await eventDetails.clickGetTickets();

    const checkout = await getHarnessWhenVisible(
      page,
      CheckoutSidebarHarness,
      15000,
      'attached',
    );
    await expect
      .poll(() => checkout.getHeadingText(), {timeout: 10000})
      .toBe('Checkout');
    await expect(page).toHaveURL(new RegExp(`/events/${eventId}\\?buy=true`), {
      timeout: 15000,
    });

    await page.goBack({waitUntil: 'domcontentloaded'});

    await page.waitForURL(
      (url) =>
        url.pathname === `/events/${eventId}` && !url.searchParams.has('buy'),
      {timeout: 15000},
    );
    await expect(
      page.getByRole('heading', {name: 'Checkout', exact: true}),
    ).toBeHidden({
      timeout: 10000,
    });
    const refreshedEventDetails = await getHarnessWhenVisible(
      page,
      EventDetailsHarness,
    );
    await expect
      .poll(() => refreshedEventDetails.isGetTicketsButtonVisible(), {
        timeout: 10000,
      })
      .toBe(true);
  });

  test(
    'should complete a ticket purchase',
    {tag: '@smoke'},
    async ({page, convexHelper}) => {
      test.slow();

      // 1. Seed User and Event
      const testEmail = `test-user-${Date.now()}@example.com`;
      await convexHelper.action(api.testing.users_node.seedUserAndGetTokens, {
        email: testEmail,
        password: 'Password123!',
        name: `Test Purchase User ${Date.now()}`,
      });

      const eventTitle = `E2E Payment Event ${Date.now()}`;
      const purchaseOrgId = await seedStripeReadyOrganizer(
        convexHelper,
        uniqueName('Purchase Org'),
      );
      const eventId = await convexHelper.mutation(
        api.testing.events.seedEvent,
        {
          title: eventTitle,
          date: new Date(2030, 0, 1).toISOString(),
          price: 1000, // $10.00
          totalTickets: 100,
          status: 'published',
          visibility: 'public',
          organizerId: purchaseOrgId as Id<'organizers'>,
          supporterDefaultPrice: 1500,
          maxTicketsPerUser: 4,
        },
      );

      // Capture console errors for debugging
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          console.log(`BROWSER [${msg.type()}]: ${msg.text()}`);
        }
      });

      // 2. Login as User via UI (Better Auth uses cookies, not localStorage tokens)
      await signInUser(page, testEmail, 'Password123!');

      await page.goto(`/events/${eventId}`);
      const eventDetails = await getHarnessWhenVisible(
        page,
        EventDetailsHarness,
      );

      // 3. Purchase Flow
      await expect(page).toHaveURL(new RegExp(`/events/${eventId}`), {
        timeout: 15000,
      });
      await expect
        .poll(() => eventDetails.getEventTitle(), {timeout: 20000})
        .toBe(eventTitle);
      await expect
        .poll(() => eventDetails.isGetTicketsButtonVisible(), {timeout: 20000})
        .toBe(true);

      // Click checkout
      await eventDetails.clickGetTickets();

      // Verify embedded checkout shell
      const checkout = await getHarnessWhenVisible(
        page,
        CheckoutSidebarHarness,
        15000,
        'attached',
      );
      await expect
        .poll(() => checkout.getHeadingText(), {timeout: 10000})
        .toBe('Checkout');

      // 4. Mount embedded checkout and complete the mock payment
      await fillAndSubmitPayment(page);

      // 5. Verify Success
      await waitForPaymentSuccess(page);

      // 6. Open ticket wallet via the post-payment checkout CTA.
      const ticketsHarness = await goToMyTickets(page);

      // 7. Verify Ticket in UI via harness
      await expect
        .poll(() => ticketsHarness.getTicketCardByEventTitle(eventTitle), {
          timeout: 30000,
          message: `Ticket card for "${eventTitle}" not found`,
        })
        .toBeTruthy();
      const ticketCard =
        (await ticketsHarness.getTicketCardByEventTitle(eventTitle))!;
      await expect
        .poll(() => ticketCard.getStatusBadgeText(), {timeout: 10000})
        .toMatch(/valid/i);
    },
  );

  test('should show purchased ticket immediately on tickets page', async ({
    page,
    convexHelper,
  }) => {
    test.slow();

    const testEmail = `ticket-purchase-${Date.now()}@example.com`;
    const testPassword = 'TicketTestPassword123!';
    const eventTitle = uniqueName('Tickets Immediate Visibility Event');

    await convexHelper.action(api.testing.users_node.seedUserAndGetTokens, {
      email: testEmail,
      password: testPassword,
      name: 'Ticket Purchase Test User',
    });

    const immediateOrgId = await seedStripeReadyOrganizer(
      convexHelper,
      uniqueName('Immediate Visibility Org'),
    );

    const eventId = await convexHelper.mutation(api.testing.events.seedEvent, {
      title: eventTitle,
      date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      price: 2500,
      totalTickets: 10,
      status: 'published',
      visibility: 'public',
      organizerId: immediateOrgId as Id<'organizers'>,
      maxTicketsPerUser: 2,
    });

    await signInUser(page, testEmail, testPassword);

    await page.goto(`/events/${eventId}`);
    const eventDetails = await getHarnessWhenVisible(page, EventDetailsHarness);
    await expect(page).toHaveURL(new RegExp(`/events/${eventId}`), {
      timeout: 15000,
    });
    await expect
      .poll(() => eventDetails.getEventTitle(), {timeout: 20000})
      .toBe(eventTitle);
    await expect
      .poll(() => eventDetails.isGetTicketsButtonVisible(), {timeout: 20000})
      .toBe(true);
    await eventDetails.clickGetTickets();

    const checkout = await getHarnessWhenVisible(
      page,
      CheckoutSidebarHarness,
      15000,
      'attached',
    );
    await expect
      .poll(() => checkout.getHeadingText(), {timeout: 10000})
      .toBe('Checkout');

    await fillAndSubmitPayment(page);

    await waitForPaymentSuccess(page);

    const ticketsHarness2 = await goToMyTickets(page);

    await expect
      .poll(() => ticketsHarness2.getTicketCardByEventTitle(eventTitle), {
        timeout: 30000,
        message: `Ticket card for "${eventTitle}" not found`,
      })
      .toBeTruthy();
  });
});
