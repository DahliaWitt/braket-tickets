import { test, expect, uniqueName, createEnvironment } from '../helpers/test-setup';
import { api } from '@convex/_generated/api';
import { Id } from '@convex/_generated/dataModel';
import { CheckInComponentHarness } from '../../src/app/features/admin/pages/check-in/check-in.component.harness';

/**
 * E2E Tests for Check-In Flow (UI-focused)
 *
 * Tests the check-in page UI: event selection, filtering, tier/type display,
 * and status badges. Backend check-in logic (success, errors, audit) is
 * covered by Convex unit tests (backend/convex/events/check_in.test.ts).
 */
test.describe.serial('Check-In Flow', () => {
  test.slow();

  test.describe('Event Selection', () => {
    test(
      'admin navigates to check-in page, selects event, and sees tickets and guests tabs',
      { tag: '@smoke' },
      async ({ adminPage, convexHelper }) => {
        // Seed a published event
        const eventTitle = uniqueName('Check-in Event');
        const checkInOrgId = await convexHelper.mutation(api.testing.communities.seedOrganizer, {
          name: uniqueName('Check-in Org'),
        });
        await convexHelper.mutation(api.testing.events.seedEvent, {
          title: eventTitle,
          date: '2030-06-01',
          price: 2000,
          totalTickets: 100,
          status: 'published',
          organizerId: checkInOrgId,
        });

        // Navigate and verify URL + heading
        // Note: /admin/check-in redirects to /scanner, so navigate directly to /scanner
        await adminPage.goto('/scanner');
        await expect(adminPage).toHaveURL(/\/scanner/);
        await expect(adminPage.getByRole('heading', { name: 'Check-In' })).toBeVisible();

        // Get harness (implicitly waits for app-check-in host element to be in DOM)
        const eventSelectionHarness =
          await createEnvironment(adminPage).getHarness(CheckInComponentHarness);

        // Wait for at least one event option to appear in the selector, then assert the seeded event is present
        await expect
          .poll(() => eventSelectionHarness.getListItemsCount().catch(() => -1), { timeout: 10000 })
          .toBeGreaterThanOrEqual(0);
        await expect(
          adminPage.locator('select[aria-label="Select event"] option', { hasText: eventTitle }),
        ).toHaveCount(1, { timeout: 10000 });

        // Select the event via harness and verify tabs appear
        await eventSelectionHarness.selectEventByLabel(eventTitle);
        await expect(adminPage.getByRole('tab', { name: /Tickets/i })).toBeVisible();
        await expect(adminPage.getByRole('tab', { name: /Guestlist/i })).toBeVisible();
      },
    );
  });

  test.describe('Status Display', () => {
    test('check-in shows refunded ticket status', async ({ adminPage, convexHelper }) => {
      const eventTitle = uniqueName('Refunded Ticket Event');
      const refundedTicketOrgId = await convexHelper.mutation(api.testing.communities.seedOrganizer, {
        name: uniqueName('Refunded Ticket Org'),
      });
      const eventId = await convexHelper.mutation(api.testing.events.seedEvent, {
        title: eventTitle,
        date: '2030-07-03',
        price: 2000,
        totalTickets: 50,
        status: 'published',
        organizerId: refundedTicketOrgId,
      });

      const testEmail = `refunded-holder-${Date.now()}@test.com`;
      const userId = await convexHelper.mutation(api.testing.users.createUserDirectly, {
        email: testEmail,
        name: 'Refunded User',
      });

      // Seed a refunded ticket
      await convexHelper.mutation(api.testing.tickets.seedTicket, {
        userId: userId as Id<'users'>,
        eventId: eventId as Id<'events'>,
        status: 'refunded',
        tier: 'regular',
        trustSource: 'open_access',
      });

      // Verify UI shows refunded status
      // Note: /admin/check-in redirects to /scanner, so navigate directly to /scanner
      await adminPage.goto('/scanner');
      await expect(adminPage.getByRole('heading', { name: 'Check-In' })).toBeVisible();
      const refundedHarness =
        await createEnvironment(adminPage).getHarness(CheckInComponentHarness);
      await expect(
        adminPage.locator('select[aria-label="Select event"] option', { hasText: eventTitle }),
      ).toBeAttached({ timeout: 10000 });
      await refundedHarness.selectEventByLabel(eventTitle);

      const ticketRow = adminPage
        .locator('[data-testid="buyer-entry"]')
        .filter({ hasText: 'Refunded User' });
      await expect(ticketRow).toBeVisible({ timeout: 10000 });

      // Should not have Check-in button (refunded tickets cannot be checked in)
      await expect(ticketRow.getByRole('button', { name: /Check-in/i })).not.toBeVisible();
      // Should show refunded text somewhere in the row (could be in badge, status text, etc.)
      await expect(ticketRow.getByText('refunded', { exact: true })).toBeVisible();
    });

    test('guest types are displayed correctly', async ({ adminPage, convexHelper }) => {
      const eventTitle = uniqueName('Guest Types Event');
      const guestTypesOrgId = await convexHelper.mutation(api.testing.communities.seedOrganizer, {
        name: uniqueName('Guest Types Org'),
      });
      const eventId = await convexHelper.mutation(api.testing.events.seedEvent, {
        title: eventTitle,
        date: '2030-08-03',
        price: 2000,
        totalTickets: 100,
        status: 'published',
        organizerId: guestTypesOrgId,
      });

      // Seed different guest types
      await convexHelper.mutation(api.testing.guests.seedGuest, {
        eventId: eventId as Id<'events'>,
        name: 'Regular Guest',
        type: 'guest',
      });

      await convexHelper.mutation(api.testing.guests.seedGuest, {
        eventId: eventId as Id<'events'>,
        name: 'Artist Guest Person',
        type: 'artist guest',
      });

      await convexHelper.mutation(api.testing.guests.seedGuest, {
        eventId: eventId as Id<'events'>,
        name: 'Staff Member',
        type: 'staff',
      });

      // Note: /admin/check-in redirects to /scanner, so navigate directly to /scanner
      await adminPage.goto('/scanner');
      await expect(adminPage.getByRole('heading', { name: 'Check-In' })).toBeVisible();
      const guestTypesHarness =
        await createEnvironment(adminPage).getHarness(CheckInComponentHarness);
      await expect(
        adminPage.locator('select[aria-label="Select event"] option', { hasText: eventTitle }),
      ).toBeAttached({ timeout: 10000 });
      await guestTypesHarness.selectEventByLabel(eventTitle);
      // Switch to Guestlist tab via native Playwright click (CDK tab.click() unreliable in zoneless)
      await adminPage.getByRole('tab', { name: /Guestlist/i }).click();
      await expect(adminPage.getByRole('tab', { name: /Guestlist/i })).toHaveAttribute(
        'aria-selected',
        'true',
        { timeout: 10000 },
      );

      // Wait for guestlist data to load — guest entries are rendered outside the loading-state panel div
      await expect(adminPage.locator('[data-testid="buyer-entry"]').first()).toBeVisible({
        timeout: 20000,
      });

      // Verify each guest type badge is shown (filter to exact matches)
      await expect(adminPage.locator('span').filter({ hasText: /^guest$/ })).toBeVisible({
        timeout: 15000,
      });
      await expect(adminPage.locator('span').filter({ hasText: /^artist guest$/ })).toBeVisible({
        timeout: 15000,
      });
      await expect(adminPage.locator('span').filter({ hasText: /^staff$/ })).toBeVisible({
        timeout: 15000,
      });
    });

    test('different ticket tiers are displayed correctly', async ({ adminPage, convexHelper }) => {
      const eventTitle = uniqueName('Tier Display Event');
      const tierDisplayOrgId = await convexHelper.mutation(api.testing.communities.seedOrganizer, {
        name: uniqueName('Tier Display Org'),
      });
      const eventId = await convexHelper.mutation(api.testing.events.seedEvent, {
        title: eventTitle,
        date: '2030-11-01',
        price: 2000,
        totalTickets: 100,
        status: 'published',
        organizerId: tierDisplayOrgId,
      });

      // Create users for each tier
      const regularUser = await convexHelper.mutation(api.testing.users.createUserDirectly, {
        email: `regular-tier-${Date.now()}@test.com`,
        name: 'Regular Tier User',
      });

      const supporterUser = await convexHelper.mutation(api.testing.users.createUserDirectly, {
        email: `supporter-tier-${Date.now()}@test.com`,
        name: 'Supporter Tier User',
      });

      const notaflofUser = await convexHelper.mutation(api.testing.users.createUserDirectly, {
        email: `notaflof-tier-${Date.now()}@test.com`,
        name: 'Notaflof Tier User',
      });

      await convexHelper.mutation(api.testing.tickets.seedTicket, {
        userId: regularUser as Id<'users'>,
        eventId: eventId as Id<'events'>,
        status: 'valid',
        tier: 'regular',
        trustSource: 'open_access',
      });

      await convexHelper.mutation(api.testing.tickets.seedTicket, {
        userId: supporterUser as Id<'users'>,
        eventId: eventId as Id<'events'>,
        status: 'valid',
        tier: 'supporter',
        trustSource: 'open_access',
      });

      await convexHelper.mutation(api.testing.tickets.seedTicket, {
        userId: notaflofUser as Id<'users'>,
        eventId: eventId as Id<'events'>,
        status: 'valid',
        tier: 'notaflof',
        trustSource: 'open_access',
      });

      // Note: /admin/check-in redirects to /scanner, so navigate directly to /scanner
      await adminPage.goto('/scanner');
      await expect(adminPage.getByRole('heading', { name: 'Check-In' })).toBeVisible();
      const tierDisplayHarness =
        await createEnvironment(adminPage).getHarness(CheckInComponentHarness);
      await expect(
        adminPage.locator('select[aria-label="Select event"] option', { hasText: eventTitle }),
      ).toBeAttached({ timeout: 10000 });
      await tierDisplayHarness.selectEventByLabel(eventTitle);

      // Verify tier badges are displayed (filter to exact matches)
      await expect(adminPage.locator('span').filter({ hasText: /^regular$/ })).toBeVisible({
        timeout: 15000,
      });
      await expect(adminPage.locator('span').filter({ hasText: /^supporter$/ })).toBeVisible();
      await expect(adminPage.locator('span').filter({ hasText: /^notaflof$/ })).toBeVisible();
    });
  });

  test.describe('Filtering', () => {
    test('can filter tickets by name or email', async ({ adminPage, convexHelper }) => {
      const eventTitle = uniqueName('Filter Event');
      const filterOrgId = await convexHelper.mutation(api.testing.communities.seedOrganizer, {
        name: uniqueName('Filter Org'),
      });
      const eventId = await convexHelper.mutation(api.testing.events.seedEvent, {
        title: eventTitle,
        date: '2030-09-01',
        price: 2000,
        totalTickets: 100,
        status: 'published',
        organizerId: filterOrgId,
      });

      // Create multiple ticket holders
      const user1Id = await convexHelper.mutation(api.testing.users.createUserDirectly, {
        email: `alice-${Date.now()}@test.com`,
        name: 'Alice Johnson',
      });

      const user2Id = await convexHelper.mutation(api.testing.users.createUserDirectly, {
        email: `bob-${Date.now()}@test.com`,
        name: 'Bob Smith',
      });

      await convexHelper.mutation(api.testing.tickets.seedTicket, {
        userId: user1Id as Id<'users'>,
        eventId: eventId as Id<'events'>,
        status: 'valid',
        tier: 'regular',
        trustSource: 'open_access',
      });

      await convexHelper.mutation(api.testing.tickets.seedTicket, {
        userId: user2Id as Id<'users'>,
        eventId: eventId as Id<'events'>,
        status: 'valid',
        tier: 'supporter',
        trustSource: 'open_access',
      });

      // Note: /admin/check-in redirects to /scanner, so navigate directly to /scanner
      await adminPage.goto('/scanner');
      await expect(adminPage.getByRole('heading', { name: 'Check-In' })).toBeVisible();
      const filterTicketsHarness =
        await createEnvironment(adminPage).getHarness(CheckInComponentHarness);
      await expect(
        adminPage.locator('select[aria-label="Select event"] option', { hasText: eventTitle }),
      ).toBeAttached({ timeout: 10000 });
      await filterTicketsHarness.selectEventByLabel(eventTitle);

      // Wait for ticket list to load before asserting names
      await expect(adminPage.locator('[data-testid="buyer-entry"]').first()).toBeVisible({
        timeout: 15000,
      });

      // Verify both users appear initially
      await expect(adminPage.getByText('Alice Johnson')).toBeVisible({ timeout: 10000 });
      await expect(adminPage.getByText('Bob Smith')).toBeVisible();

      // Filter by name via harness
      await filterTicketsHarness.enterSearchTerm('ALICE');

      // Only Alice should be visible
      await expect(adminPage.getByText('Alice Johnson')).toBeVisible();
      await expect(adminPage.getByText('Bob Smith')).not.toBeVisible();

      // Clear and filter by different term
      await filterTicketsHarness.enterSearchTerm('BOB');

      await expect(adminPage.getByText('Alice Johnson')).not.toBeVisible();
      await expect(adminPage.getByText('Bob Smith')).toBeVisible();
    });

    test('can filter guests by name', async ({ adminPage, convexHelper }) => {
      const eventTitle = uniqueName('Guest Filter Event');
      const guestFilterOrgId = await convexHelper.mutation(api.testing.communities.seedOrganizer, {
        name: uniqueName('Guest Filter Org'),
      });
      const eventId = await convexHelper.mutation(api.testing.events.seedEvent, {
        title: eventTitle,
        date: '2030-09-02',
        price: 2000,
        totalTickets: 50,
        status: 'published',
        organizerId: guestFilterOrgId,
      });

      await convexHelper.mutation(api.testing.guests.seedGuest, {
        eventId: eventId as Id<'events'>,
        name: 'Charlie VIP',
        type: 'guest',
      });

      await convexHelper.mutation(api.testing.guests.seedGuest, {
        eventId: eventId as Id<'events'>,
        name: 'Diana Artist',
        type: 'artist guest',
      });

      // Note: /admin/check-in redirects to /scanner, so navigate directly to /scanner
      await adminPage.goto('/scanner');
      await expect(adminPage.getByRole('heading', { name: 'Check-In' })).toBeVisible();
      const filterGuestsHarness =
        await createEnvironment(adminPage).getHarness(CheckInComponentHarness);
      await expect(
        adminPage.locator('select[aria-label="Select event"] option', { hasText: eventTitle }),
      ).toBeAttached({ timeout: 10000 });
      await filterGuestsHarness.selectEventByLabel(eventTitle);
      // Switch to Guestlist tab via native Playwright click (CDK tab.click() unreliable in zoneless)
      await adminPage.getByRole('tab', { name: /Guestlist/i }).click();
      await expect(adminPage.getByRole('tab', { name: /Guestlist/i })).toHaveAttribute(
        'aria-selected',
        'true',
        { timeout: 10000 },
      );

      // Wait for guestlist data to load — guest entries are rendered outside the loading-state panel div
      await expect(adminPage.locator('[data-testid="buyer-entry"]').first()).toBeVisible({
        timeout: 20000,
      });

      // Verify both guests appear
      await expect(adminPage.getByText('Charlie VIP')).toBeVisible({ timeout: 15000 });
      await expect(adminPage.getByText('Diana Artist')).toBeVisible();

      // Filter via harness
      await filterGuestsHarness.enterSearchTerm('charlie');

      await expect(adminPage.getByText('Charlie VIP')).toBeVisible();
      await expect(adminPage.getByText('Diana Artist')).not.toBeVisible();
    });

    test('shows empty state when no results match filter', async ({ adminPage, convexHelper }) => {
      const eventTitle = uniqueName('Empty Filter Event');
      const emptyFilterOrgId = await convexHelper.mutation(api.testing.communities.seedOrganizer, {
        name: uniqueName('Empty Filter Org'),
      });
      const eventId = await convexHelper.mutation(api.testing.events.seedEvent, {
        title: eventTitle,
        date: '2030-09-03',
        price: 2000,
        totalTickets: 50,
        status: 'published',
        organizerId: emptyFilterOrgId,
      });

      const userId = await convexHelper.mutation(api.testing.users.createUserDirectly, {
        email: `someone-${Date.now()}@test.com`,
        name: 'Someone Here',
      });

      await convexHelper.mutation(api.testing.tickets.seedTicket, {
        userId: userId as Id<'users'>,
        eventId: eventId as Id<'events'>,
        status: 'valid',
        tier: 'regular',
        trustSource: 'open_access',
      });

      // Note: /admin/check-in redirects to /scanner, so navigate directly to /scanner
      await adminPage.goto('/scanner');
      await expect(adminPage.getByRole('heading', { name: 'Check-In' })).toBeVisible();
      const emptyFilterHarness =
        await createEnvironment(adminPage).getHarness(CheckInComponentHarness);
      await expect(
        adminPage.locator('select[aria-label="Select event"] option', { hasText: eventTitle }),
      ).toBeAttached({ timeout: 10000 });
      await emptyFilterHarness.selectEventByLabel(eventTitle);

      // Wait for ticket data to load before filtering
      await expect(adminPage.getByText('Someone Here')).toBeVisible({ timeout: 10000 });

      // Filter with no matches via harness
      await emptyFilterHarness.enterSearchTerm('ZZZNOMATCH');

      // Should show empty state
      await expect(adminPage.getByText(/No tickets found/i)).toBeVisible({ timeout: 5000 });
    });
  });
});
