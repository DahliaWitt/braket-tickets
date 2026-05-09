import {
  test,
  expect,
  uniqueName,
  createEnvironment,
} from '../helpers/test-setup';
import {api} from '@convex/_generated/api';
import {Id} from '@convex/_generated/dataModel';
import {CheckInComponentHarness} from '../../src/app/features/admin/pages/check-in/check-in.component.harness';
import {BraDatePickerComponentHarness} from '../../src/app/ui/components/composites/date-picker/date-picker.component.harness';

test.describe('Admin Audit Logs', () => {
  test.slow();

  test('should generate an audit log when an admin updates an event', async ({
    adminPage,
    convexHelper,
  }) => {
    // 1. Seed an organizer (required for community-admin routes) and an event
    const orgId = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: uniqueName('Audit Log Org'),
      },
    );
    const eventTitle = uniqueName('Audit Log Test Event');
    await convexHelper.mutation(api.testing.events.seedEvent, {
      title: eventTitle,
      date: '2030-06-15T20:00:00.000Z',
      price: 1000,
      totalTickets: 50,
      status: 'draft',
      organizerId: orgId,
    });

    // 2. Navigate to event list and edit
    await adminPage.goto(`/community-admin/events?community=${orgId}`);

    const eventItem = adminPage
      .locator('[data-testid="event-entry"]:visible')
      .filter({hasText: eventTitle});
    await expect(eventItem).toBeVisible({timeout: 15000});
    await eventItem.getByRole('link', {name: /EDIT/i}).click();

    // Wait for form to load using #title (Signal Forms uses [field] with id attribute)
    // The editor shows a loading state first, so wait for the actual input
    await expect(adminPage.locator('#title')).toBeVisible({timeout: 15000});

    // Wait for form to be populated from backend
    await expect(adminPage.locator('#title')).toHaveValue(
      new RegExp(eventTitle),
      {
        timeout: 5000,
      },
    );

    // Wait for date picker to show a date (not placeholder)
    const datePickerEnv = createEnvironment(adminPage);
    const datePicker = await datePickerEnv.getHarness(
      BraDatePickerComponentHarness,
    );
    const displayText = await datePicker.getDisplayText();
    expect(displayText).not.toContain('Pick a date');

    // Wait for form to be fully interactive (title input populated + save button enabled)
    const saveButton = adminPage.locator('[data-testid="save-draft-btn"]');
    await expect(saveButton).toBeEnabled({timeout: 5000});

    // Clear and retype title using keyboard simulation for Signal Forms
    const titleInput = adminPage.locator('#title');
    await titleInput.click();
    await titleInput.selectText();
    const newTitle = `Updated Audit Event ${Date.now()}`;
    await titleInput.pressSequentially(newTitle, {delay: 10});
    await titleInput.blur();

    // Click save button
    await expect(saveButton).toBeEnabled({timeout: 5000});
    await saveButton.click();

    // Wait for success toast to appear (confirms save completed)
    // Seeded event is a draft → saving produces "Draft saved successfully"
    await expect(adminPage.getByText(/draft saved successfully/i)).toBeVisible({
      timeout: 10000,
    });

    // 3. Verify Audit Log entry appears in the UI
    // Pass organizerId as query param so the community context selects the correct org
    await adminPage.goto(`/community-admin/audit-log?community=${orgId}`);
    // Desktop table rows are inside div.hidden.md:block; scope to avoid strict-mode violation
    // with the duplicate mobile rows (both share data-testid="audit-log-row")
    const desktopTable = adminPage.locator('div.hidden.md\\:block');
    const updateRow = desktopTable
      .locator('[data-testid="audit-log-row"]')
      .filter({hasText: newTitle});
    await expect(updateRow).toBeVisible({timeout: 15000});
    await expect(updateRow).toContainText(/updated event/i);
  });

  test('should generate an audit log when an admin checks in a user', async ({
    adminPage,
    convexHelper,
  }) => {
    // 1. Setup Data
    const checkInAuditOrgId = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: uniqueName('Check-in Audit Org'),
      },
    );
    const checkInAuditEventTitle = `Check-in Audit Event ${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const eventId = await convexHelper.mutation(api.testing.events.seedEvent, {
      title: checkInAuditEventTitle,
      date: new Date().toISOString(),
      price: 0,
      totalTickets: 100,
      organizerId: checkInAuditOrgId,
    });

    const userTokens = await convexHelper.action(
      api.testing.users_node.seedUserAndGetTokens,
      {
        email: `audit-attendee-${Date.now()}@example.com`,
        password: 'Password123!',
        name: 'Audit Attendee',
      },
    );

    const userId = userTokens.userId as Id<'users'>;

    await convexHelper.mutation(api.testing.tickets.seedTicket, {
      userId,
      eventId,
      status: 'valid',
      tier: 'regular',
      trustSource: 'open_access',
    });

    // 2. Navigate to check-in and select event
    // Note: /admin/check-in redirects to /scanner, so navigate directly to /scanner
    await adminPage.goto('/scanner');
    await expect(adminPage).toHaveURL(/\/scanner/);

    // Wait for the check-in component to load
    await expect(adminPage.locator('app-check-in')).toBeVisible({
      timeout: 15000,
    });

    // Get harness and select event (wait for option to appear before selecting)
    const checkInAuditHarness = await createEnvironment(adminPage).getHarness(
      CheckInComponentHarness,
    );
    await expect(
      adminPage.locator('select[aria-label="Select event"] option', {
        hasText: checkInAuditEventTitle,
      }),
    ).toBeAttached({timeout: 10000});
    await checkInAuditHarness.selectEventByLabel(checkInAuditEventTitle);

    // Wait for ticket list to load (tickets tab is default)
    await expect(adminPage.getByText(/Audit Attendee/i)).toBeVisible({
      timeout: 10000,
    });

    // 3. Find the Check-in button for the attendee
    await expect
      .poll(() => checkInAuditHarness.getCheckInButtonLabels(), {
        timeout: 5000,
      })
      .toContainEqual(expect.stringMatching(/for Audit Attendee/i));
    await checkInAuditHarness.clickCheckInOnItem(0);

    // 4. Verify success - after check-in, the ticket card shows "Verified" badge
    const verifiedBadge = adminPage.getByText('Verified').first();
    await expect(verifiedBadge).toBeVisible({timeout: 20000});

    // 5. Verify Audit Log entry appears in the UI
    // Pass organizerId as query param so the community context selects the correct org
    await adminPage.goto(
      `/community-admin/audit-log?community=${checkInAuditOrgId}`,
    );
    // Scope to desktop table to avoid strict-mode violation with duplicate mobile rows
    const desktopTable = adminPage.locator('div.hidden.md\\:block');
    const checkInRow = desktopTable
      .locator('[data-testid="audit-log-row"]')
      .filter({hasText: /checked in ticket/i});
    await expect(checkInRow).toBeVisible({timeout: 15000});
  });
});
