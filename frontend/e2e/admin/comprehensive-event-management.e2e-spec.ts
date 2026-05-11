import {
  test,
  expect,
  uniqueName,
  createEnvironment,
  type ConvexHelper,
} from '../helpers/test-setup';
import type {Page} from '@playwright/test';
import {api} from '@convex/_generated/api';
import {Id} from '@convex/_generated/dataModel';
import {EventManagementHarness} from '../../src/app/features/admin/pages/event-management/event-management.harness';
import {EventEditorHarness} from '../../src/app/features/admin/pages/event-editor/event-editor.component.harness';
import {CheckInComponentHarness} from '../../src/app/features/admin/pages/check-in/check-in.component.harness';
import {ZardSelectComponentHarness} from '../../src/app/ui/components/primitives/select/select.component.harness';
import {BraToastHarness} from '../../src/app/ui/components/composites/toast/toast.component.harness';

async function setupOrgWithAdmin(
  convexHelper: ConvexHelper,
  suffix: string | number,
  orgName: string,
): Promise<{orgId: string; adminUserId: string}> {
  const orgId = await convexHelper.mutation(
    api.testing.communities.seedOrganizer,
    {
      name: `${orgName}_${suffix}`,
    },
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
  return {orgId, adminUserId: adminUser._id};
}

async function ensureManagementDataLoaded(
  adminPage: Page,
  eventId: string,
  opts: {navigate?: boolean} = {},
): Promise<void> {
  const maxAttempts = 3;
  const manageUrl = `/community-admin/events/${eventId}/manage`;
  const manageUrlPattern = new RegExp(
    `/community-admin/events/${eventId}/manage`,
  );
  const managementErrorAlert = adminPage
    .getByRole('alert')
    .filter({hasText: /Failed to load event management data/i})
    .first();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt === 1) {
      if (opts.navigate) {
        await adminPage.goto(manageUrl);
      }
    } else {
      // TODO: Remove reload — wait for reactive Convex update instead
      await adminPage.reload();
    }

    await expect(adminPage).toHaveURL(manageUrlPattern);

    const hasLoadError = await managementErrorAlert
      .waitFor({state: 'visible', timeout: 5000})
      .then(() => true)
      .catch(() => false);
    if (!hasLoadError) {
      await expect(adminPage.locator('h1')).toBeVisible({timeout: 10000});
      return;
    }

    await adminPage.keyboard.press('Escape');
    await expect(adminPage.locator('[role="alert"]'))
      .not.toBeVisible({timeout: 3000})
      .catch(() => {
        /* best-effort dismiss */
      });
  }

  throw new Error(
    `Failed to load event management data after ${maxAttempts} attempts for event ${eventId}`,
  );
}

async function updateTicketSalesStatusWithRetry(
  adminPage: Page,
  eventId: string,
  triggerLabel: 'Pause Sales' | 'Resume Sales' | 'End Sales',
  expectedStatusLabel: 'Paused' | 'Active' | 'Ended',
): Promise<void> {
  const maxAttempts = 3;
  // Buttons have descriptive aria-labels (e.g. "Pause ticket sales permanently")
  // that don't match the visible text. Use text content matching instead.
  const triggerButton = adminPage
    .locator('button')
    .filter({hasText: triggerLabel});
  // .first() retained: desktop + mobile layouts both render the status badge,
  // producing two DOM nodes that are layout-hidden but not display:none.
  const expectedBadge = adminPage
    .locator('span')
    .filter({hasText: expectedStatusLabel})
    .first();
  const updateErrorAlert = adminPage
    .getByRole('alert')
    .filter({hasText: /Failed to update ticket sales status/i})
    .first();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // If the trigger button is gone, the mutation already succeeded on a prior attempt.
    // Just wait for the badge to appear (resource reload may be slow).
    const buttonVisible = await triggerButton.isVisible().catch(() => false);
    if (!buttonVisible && attempt > 1) {
      await expect(expectedBadge).toBeVisible({timeout: 15000});
      return;
    }

    await expect(triggerButton).toBeVisible({timeout: 10000});
    await triggerButton.click();

    // The management page reloads via resource() action which can be slow
    // under memory pressure — give it 15s instead of 7s.
    const statusUpdated = await expect(expectedBadge)
      .toBeVisible({timeout: 15000})
      .then(() => true)
      .catch(() => false);
    if (statusUpdated) return;

    const hasUpdateError = await updateErrorAlert.isVisible();
    if (!hasUpdateError && attempt < maxAttempts) {
      await expect(triggerButton)
        .toBeVisible({timeout: 3000})
        .catch(() => {
          /* best-effort retry */
        });
      continue;
    }

    if (attempt < maxAttempts) {
      await ensureManagementDataLoaded(adminPage, eventId);
      await adminPage.keyboard.press('Escape');
      const env = createEnvironment(adminPage);
      const toastHarness = await env.getHarness(BraToastHarness);
      await toastHarness.waitForToastHidden();
      await expect(triggerButton)
        .toBeVisible({timeout: 3000})
        .catch(() => {
          /* best-effort retry */
        });
    }
  }

  throw new Error(
    `Failed to update ticket sales status to ${expectedStatusLabel} after ${maxAttempts} attempts`,
  );
}

/**
 * Comprehensive E2E Tests for Admin Event Management Workflow
 *
 * This test suite covers the complete admin event management lifecycle,
 * testing realistic workflows that an admin would perform:
 *
 * 1. Create a new event with all configuration options
 * 2. Manage guest lists (add/remove guests, send invites)
 * 3. Monitor ticket sales and revenue
 * 4. Handle refunds and cancellations
 * 5. Manage event status transitions
 * 6. View and verify event analytics
 *
 * This provides end-to-end coverage of admin workflows that aren't
 * fully tested in the individual feature test files.
 */
test.describe('Comprehensive Admin Event Management', () => {
  test.describe('Full Event Lifecycle', () => {
    test('create event via form, save as draft, and publish', async ({
      adminPage,
      convexHelper,
    }) => {
      // This test covers form creation, draft save, and publish — routinely takes 60-90s
      test.setTimeout(120_000);

      const suffix = Date.now();
      const {orgId} = await setupOrgWithAdmin(
        convexHelper,
        suffix,
        'CreatePublish Org',
      );
      const orgName = `CreatePublish Org_${suffix}`;

      // Create event with full configuration
      const eventTitle = uniqueName('Create Publish Event');
      const eventLocation = 'E2E Test Venue';
      const regularPrice = 25;
      const totalTickets = 150;
      const supporterPrice = 60;
      const maxTicketsPerUser = 4;
      // Navigate to community-admin to set the community context first.
      // The event editor auto-scopes the community from CommunityContextService,
      // which is only provided under the community-admin route.
      await adminPage.goto(`/community-admin/events?community=${orgId}`);
      await expect(adminPage).toHaveURL(/\/community-admin\/events/);

      await expect(adminPage.getByRole('heading', {name: orgName})).toBeVisible(
        {
          timeout: 15000,
        },
      );

      // Navigate to create event page within community-admin to preserve CommunityContextService
      await adminPage.goto(`/community-admin/events/new?community=${orgId}`);
      await expect(adminPage).toHaveURL(/\/community-admin\/events\/new/);
      // Wait for the form to be ready before filling fields
      await expect(adminPage.locator('#title')).toBeVisible({timeout: 15000});
      await expect(adminPage.getByText(orgName, {exact: true})).toBeVisible({
        timeout: 15000,
      });

      // Fill in basic event details via EventEditorHarness
      const editorEnv = createEnvironment(adminPage);
      const editorHarness = await editorEnv.getHarness(EventEditorHarness);
      await editorHarness.setTitle(eventTitle);
      await editorHarness.setLocation(eventLocation);
      await editorHarness.setPrice(regularPrice.toString());
      await editorHarness.setTotalTickets(totalTickets.toString());
      // supporterDefaultPrice has no harness method — fill directly
      await adminPage.fill('#supporterDefaultPrice', supporterPrice.toString());
      await editorHarness.setMaxTicketsPerUser(maxTicketsPerUser.toString());

      // Select date using date picker
      await adminPage
        .getByRole('button', {name: /Pick a date|Choose date/})
        .click();
      await expect(adminPage.locator('bra-calendar')).toBeVisible({
        timeout: 5000,
      });

      // Navigate the calendar to December 2030 using the month/year selects
      const calendarEnv = createEnvironment(adminPage);
      const calendarSelects = await calendarEnv.getAllHarnesses(
        ZardSelectComponentHarness,
      );
      expect(calendarSelects.length).toBeGreaterThanOrEqual(2);
      // First select is month, second is year (within the calendar popover)
      await calendarSelects[0].selectOption('Dec');
      await calendarSelects[1].selectOption('2030');

      // Now click on day 15 in the calendar grid
      // Use local date constructor to avoid UTC midnight -> previous day issue in US timezones
      const targetDate = new Date(2030, 11, 15); // month is 0-indexed, December = 11
      const dateName = targetDate.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      await adminPage
        .getByRole('button', {name: dateName, exact: false})
        .click();

      // Enable sliding scale
      const slidingScaleCheckbox = adminPage.locator('#slidingScaleEnabled');
      if (await slidingScaleCheckbox.isVisible()) {
        await slidingScaleCheckbox.check();
      } else {
        await adminPage.getByLabel('Enable Sliding Scale').click();
      }

      // Fill sliding scale values
      await expect(adminPage.locator('#slidingScaleMin')).toBeVisible();
      await adminPage.fill('#slidingScaleMin', '20');
      await adminPage.fill('#slidingScaleMax', '100');

      // Save as draft. Under heavy load the create mutation can fail once with a
      // transient server error, so retry the submit/redirect sequence before failing.
      const saveDraftBtn = adminPage.locator('[data-testid="save-draft-btn"]');
      let created = false;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        await expect(saveDraftBtn).toBeEnabled();
        await saveDraftBtn.click();

        const redirected = await adminPage
          .waitForURL(
            (url) =>
              /^\/community-admin\/events\/[^/]+\/manage$/.test(url.pathname) &&
              url.searchParams.get('community') === orgId,
            {timeout: 8000, waitUntil: 'domcontentloaded'},
          )
          .then(() => true)
          .catch(() => false);

        if (redirected) {
          created = true;
          break;
        }

        // Dismiss any toast/dialog overlays before retrying the submit.
        await adminPage.keyboard.press('Escape');
        const env = createEnvironment(adminPage);
        const toastHarness = await env.getHarness(BraToastHarness);
        await toastHarness.waitForToastHidden();
      }

      expect(created).toBe(true);

      await adminPage.goto(`/community-admin/events?community=${orgId}`);

      // Verify event appears in admin list (both desktop <tr> and mobile <z-card> share data-testid)
      const eventRow = adminPage
        .locator('[data-testid="event-entry"]:visible')
        .filter({hasText: eventTitle})
        .first();
      await expect(eventRow).toBeVisible({timeout: 10000});
      await expect(
        eventRow.locator('[data-testid="event-status"]').first(),
      ).toContainText('draft');

      // Publish the event
      // Click Edit to go back to event editor
      await eventRow.getByRole('link', {name: 'EDIT'}).click();

      // Publish the event
      const publishBtn = adminPage.locator('[data-testid="publish-save-btn"]');
      await expect(publishBtn).toBeEnabled({timeout: 10000});
      await publishBtn.click();
      // Confirm the publish dialog
      await expect(
        adminPage.locator('[data-testid="publish-dialog"]'),
      ).toBeVisible({
        timeout: 5000,
      });
      await adminPage.locator('[data-testid="publish-dialog-confirm"]').click();

      // Wait for publish to complete - button text changes to "[ save changes ]" indicating success
      await expect(publishBtn).toHaveText(/\[ save changes \]/i, {
        timeout: 15000,
      });

      // Navigate back to events list and verify published badge
      await adminPage.goto(`/community-admin/events?community=${orgId}`);
      const publishedRow = adminPage
        .locator('[data-testid="event-entry"]:visible')
        .filter({hasText: eventTitle})
        .first();
      await expect(publishedRow).toBeVisible({timeout: 10000});
      await expect(
        publishedRow.locator('[data-testid="event-status"]').first(),
      ).toContainText('published');
    });

    test('check-in attendees and guests from management page', async ({
      adminPage,
      convexHelper,
    }) => {
      test.setTimeout(120_000);

      const suffix = Date.now();
      const {orgId} = await setupOrgWithAdmin(
        convexHelper,
        suffix,
        'CheckIn Org',
      );

      // Seed a published event
      const eventTitle = uniqueName('CheckIn Event');
      const eventId = await convexHelper.mutation(
        api.testing.events.seedEvent,
        {
          title: eventTitle,
          date: '2030-12-15',
          price: 2500,
          totalTickets: 150,
          status: 'published',
          organizerId: orgId as Id<'organizers'>,
        },
      );

      // Seed ticket holders
      const buyer1Email = `buyer1-${Date.now()}@test.com`;
      const buyer1Id = await convexHelper.mutation(
        api.testing.users.createUserDirectly,
        {
          email: buyer1Email,
          name: 'Test Buyer One',
        },
      );

      await convexHelper.mutation(api.testing.tickets.seedTicket, {
        userId: buyer1Id as Id<'users'>,
        eventId: eventId as Id<'events'>,
        status: 'valid',
        tier: 'regular',
        trustSource: 'open_access',
      });

      const buyer2Email = `buyer2-${Date.now()}@test.com`;
      const buyer2Id = await convexHelper.mutation(
        api.testing.users.createUserDirectly,
        {
          email: buyer2Email,
          name: 'Test Buyer Two',
        },
      );

      await convexHelper.mutation(api.testing.tickets.seedTicket, {
        userId: buyer2Id as Id<'users'>,
        eventId: eventId as Id<'events'>,
        status: 'valid',
        tier: 'supporter',
        trustSource: 'open_access',
      });

      // Seed guests
      await convexHelper.mutation(api.testing.guests.seedGuest, {
        eventId: eventId as Id<'events'>,
        name: 'VIP Guest One',
        email: `vip1-${Date.now()}@test.com`,
        type: 'artist guest' as const,
        notes: 'Artist guest, +1 allowed',
      });

      // Navigate to check-in page
      // Note: /admin/check-in redirects to /scanner, so navigate directly to /scanner
      await adminPage.goto('/scanner');
      await expect(adminPage).toHaveURL(/\/scanner/);

      // Wait for the check-in component to load
      await expect(adminPage.locator('app-check-in')).toBeVisible({
        timeout: 15000,
      });

      // Get harness and select the event
      const checkInHarness = await createEnvironment(adminPage).getHarness(
        CheckInComponentHarness,
      );
      await expect(
        adminPage.locator('select[aria-label="Select event"] option', {
          hasText: eventTitle,
        }),
      ).toBeAttached({timeout: 10000});
      await checkInHarness.selectEventByLabel(eventTitle);

      // Verify tickets appear — longer timeout: Convex data loads after event selection
      // .first() retained: responsive layout renders separate desktop/mobile DOM trees
      await expect(adminPage.getByText('Test Buyer One').first()).toBeVisible({
        timeout: 15000,
      });
      await expect(adminPage.getByText('Test Buyer Two').first()).toBeVisible();

      // Check in first buyer's ticket — scoped to the buyer-entry row for Test Buyer One
      const buyerOneRow = adminPage
        .locator('[data-testid="buyer-entry"]')
        .filter({hasText: 'Test Buyer One'});
      const checkInButton = buyerOneRow.getByRole('button', {
        name: /Check.in/i,
      });
      await expect(checkInButton).toBeVisible({timeout: 10000});
      await checkInButton.click();

      // Verify success: after check-in, the ticket card shows "Verified" badge
      await expect(adminPage.getByText('Verified').first()).toBeVisible({
        timeout: 10000,
      });

      // Switch to Guestlist tab via native Playwright click (CDK tab.click() unreliable in zoneless)
      await adminPage.getByRole('tab', {name: /Guestlist/i}).click();
      await expect(
        adminPage.getByRole('tab', {name: /Guestlist/i}),
      ).toHaveAttribute('aria-selected', 'true', {timeout: 10000});
      // Wait for guest entries to render (outside the loading-state panel div in the template)
      await expect(
        adminPage.locator('[data-testid="buyer-entry"]').first(),
      ).toBeVisible({
        timeout: 20000,
      });

      // Check in VIP guest (aria-label is "Check in guest VIP Guest One")
      const guestCheckInButton = adminPage.getByRole('button', {
        name: /Check.in.*VIP Guest One/i,
      });
      await expect(guestCheckInButton).toBeVisible({timeout: 15000});
      await guestCheckInButton.click();

      // Verify guest check-in success: the button disappears, replaced by "Checked In" badge
      await expect(guestCheckInButton).not.toBeVisible({timeout: 10000});
    });

    test('pause, resume, and end ticket sales', async ({
      adminPage,
      convexHelper,
    }) => {
      test.setTimeout(120_000);

      const suffix = Date.now();
      const {orgId} = await setupOrgWithAdmin(
        convexHelper,
        suffix,
        'SalesStatus Org',
      );

      // Seed a published event
      const eventTitle = uniqueName('SalesStatus Event');
      const eventId = await convexHelper.mutation(
        api.testing.events.seedEvent,
        {
          title: eventTitle,
          date: '2030-12-15',
          price: 2500,
          totalTickets: 100,
          status: 'published',
          organizerId: orgId as Id<'organizers'>,
        },
      );

      // Navigate to management page
      await ensureManagementDataLoaded(adminPage, eventId, {navigate: true});

      // Initially should be Active
      // .first() retained: desktop + mobile layouts both render the status badge simultaneously.
      await expect(
        adminPage.locator('span').filter({hasText: 'Active'}).first(),
      ).toBeVisible();

      // Pause ticket sales
      await updateTicketSalesStatusWithRetry(
        adminPage,
        eventId,
        'Pause Sales',
        'Paused',
      );

      // Resume sales
      await updateTicketSalesStatusWithRetry(
        adminPage,
        eventId,
        'Resume Sales',
        'Active',
      );

      // End sales
      await updateTicketSalesStatusWithRetry(
        adminPage,
        eventId,
        'End Sales',
        'Ended',
      );

      // Verify Resume and Pause buttons are not shown (sales ended is final)
      await expect(
        adminPage.getByRole('button', {name: 'Resume Sales'}),
      ).not.toBeVisible();
      await expect(
        adminPage.getByRole('button', {name: 'Pause Sales'}),
      ).not.toBeVisible();
    });

    test('event editing: modify existing event and verify persistence', async ({
      adminPage,
      convexHelper,
    }) => {
      // Create initial event
      const originalTitle = uniqueName('Edit Test Event');
      const editTestOrgId = await convexHelper.mutation(
        api.testing.communities.seedOrganizer,
        {
          name: uniqueName('Edit Test Org'),
        },
      );
      const eventId = await convexHelper.mutation(
        api.testing.events.seedEvent,
        {
          title: originalTitle,
          date: '2030-06-15',
          price: 3000,
          totalTickets: 100,
          status: 'draft',
          organizerId: editTestOrgId,
        },
      );

      // Navigate to edit page
      await adminPage.goto(`/admin/events/${eventId}/edit`);
      // Wait for loading state to complete and form to be visible
      await expect(adminPage.locator('#title')).toBeVisible({timeout: 15000});
      await expect(adminPage.locator('#title')).toHaveValue(originalTitle, {
        timeout: 10000,
      });

      // Modify event details via EventEditorHarness
      const updatedTitle = `${originalTitle} [UPDATED]`;
      const updatedLocation = 'Updated Venue';
      const updatedPrice = 35;
      const updatedMaxTickets = 6;

      const editEnv = createEnvironment(adminPage);
      const editHarness = await editEnv.getHarness(EventEditorHarness);
      await editHarness.setTitle(updatedTitle);
      await editHarness.setLocation(updatedLocation);
      await editHarness.setPrice(updatedPrice.toString());
      await editHarness.setMaxTicketsPerUser(updatedMaxTickets.toString());

      // Save changes (in edit mode, save stays on the edit page and reloads the event)
      const saveDraftBtn = adminPage.locator('[data-testid="save-draft-btn"]');
      await expect(saveDraftBtn).toBeEnabled();
      await saveDraftBtn.click();

      // Wait for save to succeed — the event editor shows a toast on success
      await expect(adminPage.getByText('Draft saved successfully')).toBeVisible(
        {timeout: 15000},
      );

      // Verify all fields show updated values
      await expect(adminPage.locator('#title')).toHaveValue(updatedTitle);
      await expect(adminPage.locator('#location')).toHaveValue(updatedLocation);
      await expect(adminPage.locator('#price')).toHaveValue(
        updatedPrice.toString(),
      );
      await expect(adminPage.locator('#maxTicketsPerUser')).toHaveValue(
        updatedMaxTickets.toString(),
      );
    });

    test('guest management: add, send invite, and remove guests', async ({
      adminPage,
      convexHelper,
    }) => {
      // Extended timeout: 3 guest additions + send invite + remove guest + multiple data reloads
      test.setTimeout(60_000);
      const suffix = Date.now();
      const {orgId} = await setupOrgWithAdmin(
        convexHelper,
        suffix,
        'Guest Mgmt Org',
      );

      // Create event
      const eventTitle = uniqueName('Guest Management Event');
      const eventId = await convexHelper.mutation(
        api.testing.events.seedEvent,
        {
          title: eventTitle,
          date: '2030-08-20',
          price: 2500,
          totalTickets: 75,
          status: 'published',
          organizerId: orgId as Id<'organizers'>,
        },
      );

      // Navigate to event management
      await ensureManagementDataLoaded(adminPage, eventId, {navigate: true});

      // Switch to Guests tab (default tab is Analytics) via EventManagementHarness
      const mgmtEnv = createEnvironment(adminPage);
      const mgmtHarness = await mgmtEnv.getHarness(EventManagementHarness);
      await mgmtHarness.clickTab('guests');
      await expect(
        adminPage.getByRole('heading', {name: 'Guest List', level: 2}),
      ).toBeVisible();

      // Add multiple guests
      const guests = [
        {
          name: 'Guest One',
          email: `guest1-${Date.now()}@test.com`,
          type: 'guest',
          notes: 'Regular guest',
        },
        {
          name: 'Guest Two',
          email: `guest2-${Date.now()}@test.com`,
          type: 'artist guest',
          notes: 'Performing artist',
        },
        {
          name: 'Guest Three',
          email: `guest3-${Date.now()}@test.com`,
          type: 'staff',
          notes: 'Security team',
        },
      ];

      // Determine which guest-row container is visible for this viewport.
      // Desktop uses <tr> inside "hidden md:block", mobile uses <z-card> inside "md:hidden".
      // Playwright's CSS :visible pseudo-selector doesn't reliably filter responsive layouts,
      // so we detect the viewport width and pick the correct container selector.
      const viewport = adminPage.viewportSize();
      const isMobile = (viewport?.width ?? 0) < 768;
      const guestRowSelector = isMobile
        ? 'div.md\\:hidden z-card[data-testid="guest-row"]'
        : 'div.hidden.md\\:block tr[data-testid="guest-row"]';

      for (const guest of guests) {
        await adminPage.click('[data-testid="add-guest-button"]');

        // Wait for dialog to fully render before interacting
        const dialog = adminPage.getByRole('dialog');
        await expect(dialog).toBeVisible({timeout: 5000});

        // Fill inputs — use id-based locators scoped to the dialog.
        // Each fill dispatches the 'input' DOM event that zInput + the component handler consume.
        // In zoneless Angular, signal updates from (input) handlers need a microtask to propagate,
        // so we verify each field holds its value before moving on.
        const nameInput = dialog.locator('#guest-name');
        const emailInput = dialog.locator('#guest-email');
        const notesInput = dialog.locator('#guest-notes');

        await nameInput.fill(guest.name);
        await expect(nameInput).toHaveValue(guest.name);
        await emailInput.fill(guest.email);
        await expect(emailInput).toHaveValue(guest.email);
        await notesInput.fill(guest.notes);

        // Open the select dropdown and wait for the overlay item to appear.
        // Use [value="..."] for exact matching — :has-text("guest") also matches "artist guest".
        await dialog.locator('z-select').click();
        const selectItem = adminPage.locator(
          `z-select-item[value="${guest.type}"]`,
        );
        await expect(selectItem).toBeVisible({timeout: 3000});
        await selectItem.click();

        // Verify the Add Guest button is enabled (name is required for isValid())
        const addGuestBtn = dialog.getByRole('button', {name: 'Add Guest'});
        await expect(addGuestBtn).toBeEnabled({timeout: 3000});
        await addGuestBtn.click();

        // Wait for dialog to close (guest add is async via afterClosed$)
        await expect(dialog).not.toBeVisible({timeout: 5000});

        // Wait for guest to appear in the correct layout container
        const guestRow = adminPage
          .locator(guestRowSelector)
          .filter({hasText: guest.name})
          .first();
        await expect(guestRow).toBeVisible({timeout: 10000});
      }

      // Verify guest count
      const guestCount = adminPage.locator('[data-testid="guest-count"]');
      await expect(guestCount).toContainText('3 records', {timeout: 5000});

      // Send guest ticket/invite
      const firstGuestRow = adminPage
        .locator(guestRowSelector)
        .filter({hasText: 'Guest One'})
        .first();

      const sendButton = firstGuestRow.locator(
        '[data-testid="send-guest-ticket"]',
      );
      await expect(sendButton).toBeVisible();
      await sendButton.click();

      // Wait for the send action to complete. In local E2E without SMTP, the action
      // will either succeed quickly or error quickly. Either way the button text returns
      // from "Sending..." to "Send" or "Resend". Also check aria-busy going false.
      await expect(sendButton).not.toHaveAttribute('aria-busy', 'true', {
        timeout: 15000,
      });

      // Dismiss any toast (success or error) that may overlay subsequent buttons
      await adminPage.keyboard.press('Escape');
      const env = createEnvironment(adminPage);
      const toastHarness = await env.getHarness(BraToastHarness);
      await toastHarness.waitForToastHidden();

      // Remove a guest
      const thirdGuestRow = adminPage
        .locator(guestRowSelector)
        .filter({hasText: 'Guest Three'})
        .first();

      const removeButton = thirdGuestRow.locator(
        '[data-testid="remove-guest"]',
      );

      // Scroll into view on mobile where the card may be below the fold
      await removeButton.scrollIntoViewIfNeeded();

      // Use once('dialog') + click in parallel so the confirm() is accepted immediately.
      // This avoids timing issues on WebKit where `page.on('dialog')` can race with the click.
      await Promise.all([
        adminPage.waitForEvent('dialog').then((dialog) => dialog.accept()),
        removeButton.click(),
      ]);

      // Verify guest is removed
      await expect(
        adminPage
          .locator(guestRowSelector)
          .filter({hasText: 'Guest Three'})
          .first(),
      ).not.toBeVisible({timeout: 10000});

      // Verify guest count updated
      await expect(guestCount).toContainText('2 records', {timeout: 5000});
    });

    test('event status transitions: draft -> published -> ended', async ({
      adminPage,
      convexHelper,
    }) => {
      // Extended timeout: create draft + publish + navigate to manage + end sales + verify
      test.setTimeout(60_000);
      const suffix = Date.now();
      const {orgId} = await setupOrgWithAdmin(
        convexHelper,
        suffix,
        'Status Transition Org',
      );

      // Create draft event
      const eventTitle = uniqueName('Status Transition Event');
      const eventId = await convexHelper.mutation(
        api.testing.events.seedEvent,
        {
          title: eventTitle,
          date: '2030-10-01',
          price: 2000,
          totalTickets: 100,
          status: 'draft',
          organizerId: orgId as Id<'organizers'>,
        },
      );

      // Verify draft status in admin list
      await adminPage.goto(`/community-admin/events?community=${orgId}`);
      // Wait for the events list to render before looking for the row
      await expect(
        adminPage.locator('[data-testid="event-entry"]').first(),
      ).toBeVisible({
        timeout: 10000,
      });
      // Both desktop <tr> and mobile <z-card> share data-testid="event-entry"
      const eventRow = adminPage
        .locator('[data-testid="event-entry"]:visible')
        .filter({hasText: eventTitle})
        .first();
      await expect(eventRow).toBeVisible({timeout: 10000});
      await expect(
        eventRow.locator('[data-testid="event-status"]').first(),
      ).toContainText('draft');

      // Publish the event
      await eventRow.getByRole('link', {name: 'EDIT'}).click();

      const publishBtn = adminPage.locator('[data-testid="publish-save-btn"]');
      await expect(publishBtn).toBeEnabled({timeout: 10000});
      await publishBtn.click();
      // Confirm the publish dialog
      await expect(
        adminPage.locator('[data-testid="publish-dialog"]'),
      ).toBeVisible({
        timeout: 5000,
      });
      await adminPage.locator('[data-testid="publish-dialog-confirm"]').click();

      // Wait for publish to complete - button text changes to "[ save changes ]" indicating success
      await expect(publishBtn).toHaveText(/\[ save changes \]/i, {
        timeout: 15000,
      });

      // Navigate to management page and end ticket sales
      await ensureManagementDataLoaded(adminPage, eventId, {navigate: true});

      // Initially should be Active
      // .first() retained: desktop + mobile layouts both render the status badge simultaneously.
      await expect(
        adminPage.locator('span').filter({hasText: 'Active'}).first(),
      ).toBeVisible();

      // End sales
      await updateTicketSalesStatusWithRetry(
        adminPage,
        eventId,
        'End Sales',
        'Ended',
      );

      // Verify ended status persists via Convex subscription (longer timeout instead of reload)
      // .first() retained: desktop + mobile layouts both render the status badge simultaneously.
      await expect(
        adminPage.locator('span').filter({hasText: 'Ended'}).first(),
      ).toBeVisible({
        timeout: 20000,
      });

      // Verify Resume and Pause buttons are not shown (sales ended is final)
      await expect(
        adminPage.getByRole('button', {name: 'Resume Sales'}),
      ).not.toBeVisible();
      await expect(
        adminPage.getByRole('button', {name: 'Pause Sales'}),
      ).not.toBeVisible();
    });
  });
});
