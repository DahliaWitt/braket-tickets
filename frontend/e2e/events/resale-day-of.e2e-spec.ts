import {test, expect, uniqueName} from '../helpers/test-setup';
import {signInUser} from '../test-utils/auth-helpers';
import {api} from '@convex/_generated/api';
import type {Id} from '@convex/_generated/dataModel';
import {todayDateKey} from '@shared/event-time';

test.describe('Resale Day-Of Listing', () => {
  test.slow();

  test('seller can list ticket for resale on the event day (LA timezone)', async ({
    page,
    convexHelper,
  }) => {
    const eventDateKey = todayDateKey();

    const sellerEmail = `seller-dayof-${Date.now()}@test.com`;
    const seller = await convexHelper.action(
      api.testing.users_node.seedUserAndGetTokens,
      {
        email: sellerEmail,
        password: 'SellerPass123!',
        name: 'Day Of Seller',
      },
    );

    const eventTitle = uniqueName('Resale Day Of Event');
    const organizerId = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: uniqueName('Resale Day Of Org'),
      },
    );
    const eventId = await convexHelper.mutation(api.testing.events.seedEvent, {
      title: eventTitle,
      date: eventDateKey,
      price: 2500,
      totalTickets: 10,
      status: 'published',
      organizerId,
      resaleEnabled: true,
    });

    await convexHelper.mutation(api.testing.tickets.seedTicket, {
      userId: seller.userId as Id<'users'>,
      eventId: eventId as Id<'events'>,
      status: 'valid',
      tier: 'regular',
      trustSource: 'open_access',
    });

    await signInUser(page, sellerEmail, 'SellerPass123!');

    await page.goto('/tickets');
    await expect(page.locator('header')).toBeVisible({timeout: 10000});
    await expect(page.getByText(eventTitle)).toBeVisible({timeout: 30000});

    const listButton = page.getByRole('button', {
      name: /list this ticket for resale/i,
    });
    await expect(listButton).toBeVisible();
    await listButton.click();

    const confirmButton = page.getByRole('button', {
      name: /confirm resale listing/i,
    });
    await expect(confirmButton).toBeVisible({timeout: 10000});
    await confirmButton.click();

    await expect(
      page.getByRole('button', {name: /cancel resale listing/i}),
    ).toBeVisible({timeout: 10000});
  });
});
