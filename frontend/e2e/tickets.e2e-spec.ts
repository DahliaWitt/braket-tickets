import { test, expect, uniqueName, createEnvironment } from './helpers/test-setup';
import { api } from '@convex/_generated/api';
import { signInUser } from './test-utils/auth-helpers';

// Need to match the Convex ID types or use string if implicit
// We rely on the helper which handles mapping
import { Id } from '@convex/_generated/dataModel';
import { ZardTicketsHarness } from '../src/app/features/tickets/pages/tickets/tickets.component.harness';

test.describe('My Tickets Page', () => {
  test('should display purchased tickets and QR code', async ({ page, convexHelper }) => {
    // 1. Setup Data
    const testEmail = `ticket-owner-${Date.now()}@example.com`;
    const testPassword = 'Password123!';

    // Seed User
    const tokens = await convexHelper.action(api.testing.users_node.seedUserAndGetTokens, {
      email: testEmail,
      password: testPassword,
      name: `Ticket Owner ${Date.now()}`,
    });

    const userId = tokens.userId as Id<'users'>;

    // Sign in via Better Auth HTTP (still cookie-based, but avoids login-form UI)
    await signInUser(page, testEmail, testPassword);

    // 2. Seed Event
    const title = uniqueName('E2E Ticket Event');
    const organizerId = await convexHelper.mutation(api.testing.communities.seedOrganizer, {
      name: uniqueName('Ticket Org'),
    });
    const eventId = await convexHelper.mutation(api.testing.events.seedEvent, {
      title,
      date: new Date(Date.now() + 86400000).toISOString(),
      price: 1000,
      totalTickets: 50,
      status: 'published',
      organizerId,
    });

    // 3. Seed Ticket
    await convexHelper.mutation(api.testing.tickets.seedTicket, {
      userId,
      eventId,
      status: 'valid',
      tier: 'regular',
      trustSource: 'open_access',
    });

    // 4. Navigate to Tickets
    await page.goto('/tickets');
    await expect(page.locator('header')).toBeVisible({ timeout: 10000 });
    // Wait for Angular to hydrate the component content before CDK snapshot queries
    await expect(page.getByRole('heading', { name: /MY TICKETS/i })).toBeVisible({
      timeout: 10000,
    });

    // 5. Verify Content via CDK harnesses
    const env = createEnvironment(page);
    const ticketsHarness = await env.getHarness(ZardTicketsHarness);
    const ticketCard = await (async () => {
      let card = await ticketsHarness.getTicketCardByEventTitle(title);
      const deadline = Date.now() + 15000;
      while (!card && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500));
        card = await ticketsHarness.getTicketCardByEventTitle(title);
      }
      return card;
    })();
    if (!ticketCard) throw new Error(`Ticket card for "${title}" not found`);

    await expect.poll(() => ticketCard.getStatusBadgeText(), { timeout: 10000 }).toMatch(/valid/i);

    // Verify QR Code is rendered via TicketCardHarness
    await expect.poll(() => ticketCard.hasQrRendered(), { timeout: 10000 }).toBe(true);
  });
});
