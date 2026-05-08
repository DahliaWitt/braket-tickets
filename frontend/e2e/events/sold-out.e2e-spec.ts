import { test, expect, uniqueName } from '../helpers/test-setup';
import { signInUser } from '../test-utils/auth-helpers';
import { api } from '@convex/_generated/api';
import { Id } from '@convex/_generated/dataModel';

/**
 * Core sold-out E2E journey only.
 * Inventory-edge and UI-detail assertions are covered in event-details/event-card component tests.
 */
test.describe('Event Sold Out', () => {
  test('cannot open checkout when event is sold out', async ({ page, convexHelper }) => {
    const uniqueId = Date.now();
    const testEmail = `soldout-checkout-${uniqueId}@example.com`;
    const user = await convexHelper.action(api.testing.users_node.seedUserAndGetTokens, {
      email: testEmail,
      password: 'Password123!',
      name: 'Sold Out Checkout User',
    });

    const eventTitle = uniqueName('Sold Out Checkout Event');
    const soldOutCheckoutOrgId = await convexHelper.mutation(api.testing.communities.seedOrganizer, {
      name: uniqueName('Sold Out Checkout Org'),
    });
    const eventId = await convexHelper.mutation(api.testing.events.seedEvent, {
      title: eventTitle,
      date: '2030-01-01',
      price: 2500,
      totalTickets: 1,
      status: 'published',
      visibility: 'public',
      organizerId: soldOutCheckoutOrgId,
    });

    await convexHelper.mutation(api.testing.tickets.seedTicket, {
      userId: user.userId as Id<'users'>,
      eventId,
      status: 'valid',
      tier: 'regular',
      trustSource: 'open_access',
    });

    await signInUser(page, testEmail, 'Password123!');

    await page.goto(`/events/${eventId}?buy=true`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: eventTitle })).toBeVisible({ timeout: 15_000 });

    await expect(page.getByRole('heading', { name: 'Checkout', exact: true })).toBeHidden({
      timeout: 10_000,
    });
    await expect(page.getByText('Sold Out', { exact: true })).toBeVisible({ timeout: 10_000 });
  });
});
