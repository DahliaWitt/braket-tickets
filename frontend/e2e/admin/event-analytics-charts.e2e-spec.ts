import {
  test,
  expect,
  uniqueName,
  createEnvironment,
  type ConvexHelper,
} from '../helpers/test-setup';
import {api} from '@convex/_generated/api';
import type {Id} from '@convex/_generated/dataModel';
import {EventAnalyticsTabHarness} from '../../src/app/features/admin/components/event-analytics-tab/event-analytics-tab.component.harness';

/**
 * Cold-load regression for the ApexCharts chart-type registration race.
 *
 * SalesChart and CheckInChart load through concurrent `@defer (on immediate)`
 * blocks. Registration used to live only in SalesChart's chunk, so whenever
 * CheckInChart's chunk won the race the page crashed with
 * `ApexCharts: chart type "line" is not registered` (18/40 cold renders).
 * Each chart component now imports the registration boundary itself.
 *
 * Run with `--repeat-each=N` for a repeated cold-load matrix; combined with
 * the desktop/mobile Playwright projects this reproduces the original audit
 * sweep.
 */
async function seedAnalyticsEvent(
  convexHelper: ConvexHelper,
): Promise<Id<'events'>> {
  const orgId = await convexHelper.mutation(
    api.testing.communities.seedOrganizer,
    {name: uniqueName('Analytics Charts Org')},
  );
  const adminUser = await convexHelper.query(api.testing.users.getByEmail, {
    email: 'global-admin@example.com',
  });
  if (!adminUser) throw new Error('Admin user not found');
  await convexHelper.mutation(api.testing.communities.seedCommunityAdmin, {
    userId: adminUser._id,
    organizerId: orgId,
    grantedBy: adminUser._id,
  });

  const eventId = await convexHelper.mutation(api.testing.events.seedEvent, {
    title: uniqueName('Analytics Charts Event'),
    date: new Date(Date.now() + 86400000).toISOString(),
    price: 2000,
    totalTickets: 50,
    status: 'published',
    organizerId: orgId,
  });

  // Sales data: valid tickets auto-create completed orders → salesByDay.
  for (let i = 0; i < 2; i++) {
    await convexHelper.mutation(api.testing.tickets.seedTicket, {
      userId: adminUser._id,
      eventId,
      status: 'valid',
      tier: 'regular',
      trustSource: 'open_access',
    });
  }
  // Check-in data: used tickets with checkedInAt → checkInStats.buckets.
  for (const minutesAgo of [30, 15]) {
    await convexHelper.mutation(api.testing.tickets.seedTicket, {
      userId: adminUser._id,
      eventId,
      status: 'used',
      tier: 'regular',
      trustSource: 'open_access',
      checkedInAt: Date.now() - minutesAgo * 60 * 1000,
    });
  }

  return eventId;
}

test.describe('Event analytics charts', () => {
  test('both charts render on a cold load without chart-type registration errors @smoke', async ({
    adminPage,
    convexHelper,
  }) => {
    const pageErrors: string[] = [];
    adminPage.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    const eventId = await seedAnalyticsEvent(convexHelper);

    await adminPage.goto(`/community-admin/events/${eventId}/manage`);
    await expect(adminPage.locator('h1')).toBeVisible({timeout: 15000});

    // Analytics is the default tab; both defer blocks fire immediately.
    const env = createEnvironment(adminPage);
    const analyticsTab = await env.getHarness(EventAnalyticsTabHarness);

    await expect
      .poll(
        async () => {
          const salesChart = await analyticsTab.getSalesChart();
          return salesChart ? salesChart.hasRenderedSeries() : false;
        },
        {timeout: 20000},
      )
      .toBe(true);

    await expect
      .poll(
        async () => {
          const checkInChart = await analyticsTab.getCheckInChart();
          return checkInChart ? checkInChart.hasRenderedSeries() : false;
        },
        {timeout: 20000},
      )
      .toBe(true);

    expect(
      pageErrors.filter((message) =>
        /not registered|ApexCharts/i.test(message),
      ),
    ).toEqual([]);
  });
});
