import {
  test,
  expect,
  uniqueName,
  createEnvironment,
} from '../helpers/test-setup';
import {api} from '@convex/_generated/api';
import {EventEditorHarness} from '../../src/app/features/admin/pages/event-editor/event-editor.component.harness';

/**
 * E2E Tests for Event Status Lifecycle
 *
 * Events go through states: draft -> published -> cancelled
 * Admins control these transitions via the event editor.
 *
 * Visibility rules:
 * - Draft events: Only visible to admins
 * - Published events: Visible to all vetted users on dashboard
 * - Cancelled events: Only visible to admins (hidden from public)
 */
test.describe('Event Status Lifecycle', () => {
  test.describe('Admin Event Management', () => {
    test.slow();

    test('admin can seed and view a draft event', async ({
      adminPage,
      convexHelper,
    }) => {
      const eventTitle = uniqueName('Draft Event');

      // Seed a draft event directly
      const draftOrgId = await convexHelper.mutation(
        api.testing.communities.seedOrganizer,
        {
          name: uniqueName('Draft Event Org'),
        },
      );
      const eventId = await convexHelper.mutation(
        api.testing.events.seedEvent,
        {
          title: eventTitle,
          date: '2030-01-15',
          price: 2000,
          totalTickets: 50,
          status: 'draft',
          organizerId: draftOrgId,
        },
      );

      // Navigate to admin events list
      await adminPage.goto(`/community-admin/events?community=${draftOrgId}`);

      // Wait for the events table/list to load, then check for the event
      // Support both desktop (tr) and mobile card view
      const eventItem = adminPage
        .locator('[data-testid="event-entry"]:visible')
        .filter({hasText: eventTitle});
      await expect(eventItem).toBeVisible({timeout: 15000});

      // Verify draft badge is shown
      await expect(
        eventItem.locator('[data-testid="event-status"]'),
      ).toContainText('draft');

      // Verify event details page is accessible to admin
      await adminPage.goto(
        `/community-admin/events/${eventId}/edit?community=${draftOrgId}`,
      );
      // Wait for loading state to complete and form to be visible
      await expect(adminPage.locator('#title')).toBeVisible({timeout: 15000});
      await expect(adminPage.locator('#title')).toHaveValue(eventTitle, {
        timeout: 10000,
      });
    });

    test('admin can publish a draft event', async ({
      adminPage,
      convexHelper,
    }) => {
      const eventTitle = uniqueName('Publish Event');

      // Seed a draft event
      const publishOrgId = await convexHelper.mutation(
        api.testing.communities.seedOrganizer,
        {
          name: uniqueName('Publish Event Org'),
        },
      );
      const eventId = await convexHelper.mutation(
        api.testing.events.seedEvent,
        {
          title: eventTitle,
          date: '2030-03-01',
          price: 2500,
          totalTickets: 100,
          status: 'draft',
          organizerId: publishOrgId,
        },
      );

      // Navigate to edit page and wait for it to load
      await adminPage.goto(
        `/community-admin/events/${eventId}/edit?community=${publishOrgId}`,
      );
      // Wait for loading state to complete and form to be visible
      await expect(adminPage.locator('#title')).toBeVisible({timeout: 15000});
      await expect(adminPage.locator('#title')).toHaveValue(eventTitle, {
        timeout: 10000,
      });

      // Click Publish button (for draft events, the green button says "[ PUBLISH ]")
      const publishBtn = adminPage.locator('[data-testid="publish-save-btn"]');
      await expect(publishBtn).toBeEnabled();
      // Use EventEditorHarness to open the publish dialog, then confirm it
      const editorHarness =
        await createEnvironment(adminPage).getHarness(EventEditorHarness);
      await editorHarness.openPublishDialog();
      // The publish button opens a confirmation dialog — confirm to complete the publish
      await expect
        .poll(() => editorHarness.isPublishDialogVisible(), {timeout: 5000})
        .toBe(true);
      await editorHarness.confirmPublish();

      // Wait for save to complete - button text changes to "[ save changes ]" indicating published status
      await expect(publishBtn).toHaveText(/\[ save changes \]/i, {
        timeout: 15000,
      });

      // Navigate to admin list to verify status
      await adminPage.goto(`/community-admin/events?community=${publishOrgId}`);

      // Verify status changed to published in admin list
      const eventItem = adminPage
        .locator('[data-testid="event-entry"]:visible')
        .filter({hasText: eventTitle});
      await expect(eventItem).toBeVisible({timeout: 15000});
      await expect(
        eventItem.locator('[data-testid="event-status"]'),
      ).toContainText('published');
    });

    test('admin can unpublish a published event', async ({
      adminPage,
      convexHelper,
    }) => {
      // Extended timeout: edit page load + unpublish + navigate to list + verify status
      test.setTimeout(60_000);
      const eventTitle = uniqueName('Unpublish Event');

      // Seed a published event
      const unpublishOrgId = await convexHelper.mutation(
        api.testing.communities.seedOrganizer,
        {
          name: uniqueName('Unpublish Event Org'),
        },
      );
      const eventId = await convexHelper.mutation(
        api.testing.events.seedEvent,
        {
          title: eventTitle,
          date: '2030-05-01',
          price: 2000,
          totalTickets: 100,
          status: 'published',
          organizerId: unpublishOrgId,
        },
      );

      // Navigate to edit page and wait for it to load
      await adminPage.goto(
        `/community-admin/events/${eventId}/edit?community=${unpublishOrgId}`,
      );
      // Wait for loading state to complete and form to be visible
      await expect(adminPage.locator('#title')).toBeVisible({timeout: 15000});
      await expect(adminPage.locator('#title')).toHaveValue(eventTitle, {
        timeout: 10000,
      });

      // For published events, the outline button says "[ UNPUBLISH ]"
      const unpublishBtn = adminPage.locator('[data-testid="save-draft-btn"]');
      await expect(unpublishBtn).toBeEnabled();
      await unpublishBtn.click();

      // Wait for save to complete - button text changes from "[ UNPUBLISH ]" to "[ save draft ]"
      // (In edit mode, the component stays on the page after saving)
      await expect(
        adminPage.locator('[data-testid="save-draft-btn"]'),
      ).toHaveText(/\[ save draft \]/i, {
        timeout: 10000,
      });

      // Navigate to admin list to verify status
      await adminPage.goto(
        `/community-admin/events?community=${unpublishOrgId}`,
      );

      // Verify status changed back to draft
      const eventItem = adminPage
        .locator('[data-testid="event-entry"]:visible')
        .filter({hasText: eventTitle});
      await expect(eventItem).toBeVisible({timeout: 15000});
      await expect(
        eventItem.locator('[data-testid="event-status"]'),
      ).toContainText('draft');
    });

    test('admin can view cancelled events', async ({
      adminPage,
      convexHelper,
    }) => {
      // Extended timeout: seed + navigate + 15s visibility wait in CI
      test.setTimeout(60_000);
      const eventTitle = uniqueName('Cancelled Event');

      // Seed a cancelled event
      const cancelledOrgId = await convexHelper.mutation(
        api.testing.communities.seedOrganizer,
        {
          name: uniqueName('Cancelled Event Org'),
        },
      );
      await convexHelper.mutation(api.testing.events.seedEvent, {
        title: eventTitle,
        date: '2030-07-01',
        price: 2000,
        totalTickets: 100,
        status: 'cancelled',
        organizerId: cancelledOrgId,
      });

      // Navigate to admin events list
      await adminPage.goto(
        `/community-admin/events?community=${cancelledOrgId}`,
      );

      // Cancelled event should be visible in admin list
      const eventItem = adminPage
        .locator('[data-testid="event-entry"]:visible')
        .filter({hasText: eventTitle});
      await expect(eventItem).toBeVisible({timeout: 15000});
      await expect(
        eventItem.locator('[data-testid="event-status"]'),
      ).toContainText('cancelled');
    });
  });
});
