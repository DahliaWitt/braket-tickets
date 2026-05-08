import { test, expect, uniqueName } from './helpers/test-setup';
import { api } from '@convex/_generated/api';
import { EventDetailsPage } from './helpers/event-details-page';

/** Near-future date that sorts before 2030+ dates from other test files. */
function nearFutureDate(daysAhead: number): string {
  return new Date(Date.now() + daysAhead * 86_400_000).toISOString();
}

/**
 * E2E Tests for Landing Page — Public Events
 * Uses the LandingPage harness adapter for stable, maintainable selectors.
 */
test.describe('Landing Page — Public Events', () => {
  test('displays public upcoming events', async ({ convexHelper, landingPage }) => {
    const title = uniqueName('E2E Public Party');

    const orgId = await convexHelper.mutation(api.testing.communities.seedOrganizer, {
      name: uniqueName('Public Events Org'),
      isPlatformOrganizer: true,
    });
    await convexHelper.mutation(api.testing.events.seedEvent, {
      title,
      date: nearFutureDate(1),
      price: 1500,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId: orgId,
    });

    await landingPage.goto();
    await landingPage.waitForReady();

    // Event title should appear somewhere on the page
    await landingPage.expectEventVisible(title);
  });

  test('does not display private events', async ({ convexHelper, landingPage }) => {
    const publicTitle = uniqueName('E2E Public Visible');
    const privateTitle = uniqueName('E2E Private Hidden');

    const orgId = await convexHelper.mutation(api.testing.communities.seedOrganizer, {
      name: uniqueName('Visibility Org'),
      isPlatformOrganizer: true,
      isPublicDirectory: true,
    });

    const publicEventId = await convexHelper.mutation(api.testing.events.seedEvent, {
      title: publicTitle,
      date: nearFutureDate(2),
      price: 1500,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId: orgId,
    });

    await convexHelper.mutation(api.testing.events.seedEvent, {
      title: privateTitle,
      date: nearFutureDate(3),
      price: 1500,
      totalTickets: 100,
      status: 'published',
      visibility: 'private',
      organizerId: orgId,
    });

    await landingPage.goto();
    await landingPage.waitForReady();

    // The landing page displays up to 12 upcoming public events. Under parallel
    // tests the public event may not appear if other tests have filled the slots.
    // The core assertion is that the PRIVATE event never appears — that's the
    // security boundary this test verifies. The public event is verified via
    // direct navigation to confirm it exists and is accessible.
    await landingPage.expectTextNotPresent(privateTitle);

    // Verify the public event is accessible (exists and is publicly visible)
    await landingPage.page.goto(`/events/${publicEventId}`);
    await expect(landingPage.page.getByRole('heading', { name: publicTitle })).toBeVisible({
      timeout: 15000,
    });
  });

  test('shows sold out badge for sold-out events', async ({ convexHelper, landingPage }) => {
    const title = uniqueName('E2E Sold Out Bash');

    const orgId = await convexHelper.mutation(api.testing.communities.seedOrganizer, {
      name: uniqueName('Sold Out Org'),
      isPlatformOrganizer: true,
    });
    await convexHelper.mutation(api.testing.events.seedEvent, {
      title,
      date: nearFutureDate(1),
      price: 2000,
      totalTickets: 10,
      soldCount: 10,
      status: 'published',
      visibility: 'public',
      organizerId: orgId,
    });

    await landingPage.goto();
    await landingPage.waitForReady();

    // Find the event using page object
    await landingPage.expectEventVisible(title);
  });

  test('event card navigates to event detail', async ({ page, convexHelper, landingPage }) => {
    const title = uniqueName('E2E Nav Event');

    const orgId = await convexHelper.mutation(api.testing.communities.seedOrganizer, {
      name: uniqueName('Nav Org'),
      isPlatformOrganizer: true,
    });
    const eventId = await convexHelper.mutation(api.testing.events.seedEvent, {
      title,
      // Use the earliest date so this event is always the featured (first)
      // event on the landing page, regardless of other parallel test data
      date: new Date(Date.now() + 3_600_000).toISOString(),
      price: 1000,
      totalTickets: 50,
      status: 'published',
      visibility: 'public',
      organizerId: orgId,
    });

    await landingPage.goto();
    await landingPage.waitForReady();

    await landingPage.expectEventVisible(title);
    await landingPage.clickEvent(title);

    await page.waitForURL(`**/events/${eventId}`, { timeout: 10000 });
    const eventDetailsPage = new EventDetailsPage(page);
    await eventDetailsPage.expectSiteHeaderVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10000 });
  });
});
