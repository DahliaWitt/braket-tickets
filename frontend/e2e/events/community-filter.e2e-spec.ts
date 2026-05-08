import {test, expect, uniqueName} from '../helpers/test-setup';
import {api} from '@convex/_generated/api';

test.describe('Events — Community Filter (BRA-178 Regression)', () => {
  test('resolves valid organizer ID in query param for unauthenticated user', async ({
    page,
    convexHelper,
  }) => {
    const orgName = uniqueName('Target Community');
    const slug = uniqueName('target-comm').replace(/\s/g, '-');
    const eventTitle = uniqueName('Target Event');

    const orgId = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: orgName,
        slug,
        isPublicDirectory: true,
      },
    );

    await convexHelper.mutation(api.testing.events.seedEvent, {
      title: eventTitle,
      date: new Date(2030, 11, 20).toISOString(),
      price: 1000,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId: orgId,
    });

    // Navigate to events page with community ID
    await page.goto(`/events?community=${orgId}`);

    // Header should show the community name, not 'UNKNOWN COMMUNITY'
    const header = page.getByRole('heading', {level: 1});
    await expect(header).toBeVisible({timeout: 15000});
    await expect(header).toHaveText(new RegExp(orgName, 'i'), {timeout: 15000});
    await expect(header).not.toHaveText(/UNKNOWN COMMUNITY/i);

    // Event should be visible - use Playwright locators for reliability
    const eventCardTitle = page.locator('[data-testid="event-card-title"]');
    await expect(eventCardTitle).toContainText(eventTitle, {timeout: 15000});
  });

  test('resolves valid organizer slug in query param for unauthenticated user', async ({
    page,
    convexHelper,
  }) => {
    const orgName = uniqueName('Slug Community');
    const slug = uniqueName('slug-target').replace(/\s/g, '-');
    const eventTitle = uniqueName('Slug Event');

    const orgId = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: orgName,
        slug,

        isPublicDirectory: true,
      },
    );

    await convexHelper.mutation(api.testing.events.seedEvent, {
      title: eventTitle,
      date: new Date(2030, 11, 21).toISOString(),
      price: 1500,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId: orgId,
    });

    // Navigate to events page with community slug
    await page.goto(`/events?community=${slug}`);

    // Header should show the community name
    const header = page.getByRole('heading', {level: 1});
    await expect(header).toBeVisible({timeout: 15000});
    await expect(header).toHaveText(new RegExp(orgName, 'i'), {timeout: 15000});
    await expect(header).not.toHaveText(/UNKNOWN COMMUNITY/i);

    // Event should be visible - use Playwright locators for reliability
    const eventCardTitle = page.locator('[data-testid="event-card-title"]');
    await expect(eventCardTitle).toContainText(eventTitle, {timeout: 15000});
  });

  test('public community event-card More Info opens the selected event detail page', async ({
    page,
    convexHelper,
  }) => {
    const orgName = uniqueName('More Info Community');
    const slug = uniqueName('more-info-community').replace(/\s/g, '-');
    const eventTitle = uniqueName('More Info Event');

    const orgId = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: orgName,
        slug,
        isPublicDirectory: true,
      },
    );

    const eventId = await convexHelper.mutation(api.testing.events.seedEvent, {
      title: eventTitle,
      date: new Date(2030, 11, 22).toISOString(),
      price: 1500,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId: orgId,
    });

    await page.goto(`/communities/${slug}`);

    const eventCard = page
      .locator('[data-testid="community-event-card"]')
      .filter({
        hasText: eventTitle,
      });
    await expect(eventCard).toBeVisible({timeout: 15000});

    await eventCard.getByTestId('event-card-more-info').click();

    await expect(page).toHaveURL(new RegExp(`/events/${eventId}(?:[?#].*)?$`), {
      timeout: 10000,
    });
    await expect(
      page.getByRole('heading', {level: 1, name: eventTitle}),
    ).toBeVisible({
      timeout: 15000,
    });
  });
});
