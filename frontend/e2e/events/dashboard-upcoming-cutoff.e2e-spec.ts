import { test, expect, uniqueName } from '../helpers/test-setup';
import { getHarnessWhenVisible } from '../helpers/harness-helpers';
import { signInUser } from '../test-utils/auth-helpers';
import { api } from '@convex/_generated/api';
import { Id } from '@convex/_generated/dataModel';
import { AdminEventsTableHarness } from '../../src/app/features/admin/components/events-table/events-table.component.harness';
import { CommunityAdminHarness } from '../../src/app/features/admin/pages/community-admin/community-admin.harness';
import { DashboardComponentHarness } from '../../src/app/features/dashboard/pages/dashboard/dashboard.component.harness';

/**
 * Use a near-future date so the event sorts before far-future (2030+) events
 * seeded by other parallel tests. The landing/dashboard pages cap visible
 * events at 4, so a far-future date risks being pushed out by other tests'
 * earlier-dated public events.
 */
const FUTURE_EVENT_DATE = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

test.describe('Dashboard Upcoming Event Cutoff', () => {
  test.slow();

  test('future event is visible on dashboard and in admin', async ({
    page,
    adminPage,
    convexHelper,
  }) => {
    const testEmail = `dashboard-cutoff-${Date.now()}@example.com`;
    const testPassword = 'Password123!';

    const user = await convexHelper.action(api.testing.users_node.seedUserAndGetTokens, {
      email: testEmail,
      password: testPassword,
      name: 'Dashboard Cutoff User',
    });

    // Root admin needs at least one organizer to see any community in the admin panel
    const orgId = await convexHelper.mutation(api.testing.communities.seedOrganizer, {
      name: uniqueName('Dashboard Cutoff Org'),
      vettingQuestions: [
        { id: 'q1', question: 'How did you hear about us?', type: 'text' as const, required: true },
      ],
    });

    const eventTitle = uniqueName('Dashboard Cutoff Event');
    const eventId = await convexHelper.mutation(api.testing.events.seedEvent, {
      title: eventTitle,
      date: FUTURE_EVENT_DATE,
      price: 2500,
      totalTickets: 1,
      status: 'published',
      visibility: 'public',
      organizerId: orgId,
    });

    await convexHelper.mutation(api.testing.tickets.seedTicket, {
      userId: user.userId as Id<'users'>,
      eventId,
      status: 'valid',
      tier: 'regular',
      trustSource: 'open_access',
    });

    // Read-only: navigates admin view but does not mutate admin state
    // Event is visible in admin panel after selecting the seeded community.
    // When only one community exists, it auto-selects — no dropdown rendered.
    await adminPage.goto('/community-admin/events');
    const communityAdmin = await getHarnessWhenVisible(adminPage, CommunityAdminHarness);
    // Wait for community context to resolve before checking selector presence
    await expect
      .poll(() => communityAdmin.hasEventsTable(), { timeout: 15000 })
      .toBe(true);
    const hasSelector = await communityAdmin.hasCommunitySelector();
    if (hasSelector) {
      const communitySelector = await communityAdmin.getCommunitySelector();
      if (!communitySelector) {
        throw new Error('Community selector not available on community admin events page');
      }
      await expect.poll(() => communitySelector.isDropdownVisible(), { timeout: 15000 }).toBe(true);
      await communitySelector.selectCommunity(orgId as Id<'organizers'>);
    }

    const adminEventsTable = await getHarnessWhenVisible(adminPage, AdminEventsTableHarness);
    await expect
      .poll(
        async () => (await adminEventsTable.getEntryTexts()).some((text) => text.includes(eventTitle)),
        { timeout: 15000 },
      )
      .toBe(true);

    // Event is visible on the user dashboard (cutoff is server-side).
    await signInUser(page, testEmail, testPassword);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const dashboard = await getHarnessWhenVisible(page, DashboardComponentHarness);
    await expect
      .poll(
        async () => (await dashboard.getVisibleEventTitles()).some((title) => title.includes(eventTitle)),
        { timeout: 15000 },
      )
      .toBe(true);
  });
});
