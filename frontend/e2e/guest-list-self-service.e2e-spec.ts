import {api} from '@convex/_generated/api';
import {
  createEnvironment,
  expect,
  test,
  uniqueName,
} from './helpers/test-setup';
import {EmailHarness} from './helpers/email-harness';
import {SHARED_USER_ACCOUNT} from './test-utils/auth-accounts';
import {EventManagementHarness} from '../src/app/features/admin/pages/event-management/event-management.harness';
import {EventManagementGuestsTabHarness} from '../src/app/features/admin/pages/event-management/components/event-management-guests-tab/event-management-guests-tab.component.harness';
import {GuestListAssignmentsHarness} from '../src/app/features/admin/pages/event-management/components/guest-list-assignments/guest-list-assignments.component.harness';
import {GuestListManageComponentHarness} from '../src/app/features/guest-lists/pages/guest-list-manage/guest-list-manage.component.harness';
import {GuestListsComponentHarness} from '../src/app/features/guest-lists/pages/guest-lists/guest-lists.component.harness';
import type {ConvexHelper} from './helpers/test-setup';
import type {Page} from '@playwright/test';

const futureEventDates = (): {date: string; endDate: string} => {
  const date = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const endDate = new Date(date.getTime() + 4 * 60 * 60 * 1000);
  return {date: date.toISOString(), endDate: endDate.toISOString()};
};

async function seedManagedEvent(
  convexHelper: ConvexHelper,
  eventTitle: string,
): Promise<string> {
  await convexHelper.mutation(api.testing.guest_list.enableFeature, {});
  const organizerId = await convexHelper.mutation(
    api.testing.communities.seedOrganizer,
    {name: uniqueName('Self-service guest list community')},
  );
  const admin = await convexHelper.query(api.testing.users.getByEmail, {
    email: 'global-admin@example.com',
  });
  if (!admin) throw new Error('Global E2E admin was not seeded');
  await convexHelper.mutation(api.testing.communities.seedCommunityAdmin, {
    organizerId,
    userId: admin._id,
    grantedBy: admin._id,
  });
  return convexHelper.mutation(api.testing.events.seedEvent, {
    organizerId,
    title: eventTitle,
    ...futureEventDates(),
    price: 2000,
    totalTickets: 100,
    status: 'published',
    visibility: 'public',
    ticketSalesStatus: 'active',
  });
}

async function openGuestManagement(
  adminPage: Page,
  eventId: string,
): Promise<GuestListAssignmentsHarness> {
  await adminPage.goto(`/community-admin/events/${eventId}/manage`);
  await expect(adminPage).toHaveURL(
    new RegExp(`/community-admin/events/${eventId}/manage`),
  );
  await expect
    .poll(
      async () => {
        try {
          const harness = await createEnvironment(adminPage).getHarness(
            EventManagementHarness,
          );
          return (await harness.getManagementLoadErrorText()) === null;
        } catch {
          return false;
        }
      },
      {timeout: 20_000},
    )
    .toBe(true);
  const management = await createEnvironment(adminPage).getHarness(
    EventManagementHarness,
  );
  await management.clickTab('guests');
  return createEnvironment(adminPage).getHarness(GuestListAssignmentsHarness);
}

async function createAssignment(
  harness: GuestListAssignmentsHarness,
  args: {
    displayName: string;
    email: string;
    role: 'artist' | 'staff';
  },
): Promise<void> {
  await harness.setDisplayName(args.displayName);
  await harness.setEmail(args.email);
  await harness.setRole(args.role);
  await harness.clickInvite();
  await expect
    .poll(async () => (await harness.getRowTexts()).join('\n'), {
      timeout: 20_000,
    })
    .toContain(args.displayName);
}

async function expectOrganizerAttribution(
  adminPage: Page,
  guestName: string,
  sourceLabel: string,
): Promise<void> {
  const guests = await createEnvironment(adminPage).getHarness(
    EventManagementGuestsTabHarness,
  );
  await expect
    .poll(async () => (await guests.getGuestRowTexts()).join('\n'), {
      timeout: 20_000,
    })
    .toContain(guestName);
  await expect
    .poll(async () => (await guests.getGuestRowTexts()).join('\n'), {
      timeout: 20_000,
    })
    .toContain(sourceLabel);
}

async function waitForGuestListsHarness(
  page: Page,
): Promise<GuestListsComponentHarness> {
  await expect
    .poll(
      async () => {
        try {
          await createEnvironment(page).getHarness(GuestListsComponentHarness);
          return true;
        } catch {
          return false;
        }
      },
      {timeout: 20_000},
    )
    .toBe(true);
  return createEnvironment(page).getHarness(GuestListsComponentHarness);
}

async function waitForGuestListManageHarness(
  page: Page,
): Promise<GuestListManageComponentHarness> {
  await expect
    .poll(
      async () => {
        try {
          const harness = await createEnvironment(page).getHarness(
            GuestListManageComponentHarness,
          );
          return await harness.hasEventDetails();
        } catch {
          return false;
        }
      },
      {timeout: 20_000},
    )
    .toBe(true);
  return createEnvironment(page).getHarness(GuestListManageComponentHarness);
}

test.describe('Self-service guest lists', () => {
  test('signed-in delegate adds a guest and organizer sees artist attribution', async ({
    adminPage,
    authedPage,
    convexHelper,
    page,
  }) => {
    test.setTimeout(120_000);
    const eventTitle = uniqueName('Signed-in delegate event');
    const eventId = await seedManagedEvent(convexHelper, eventTitle);
    const assignmentName = uniqueName('Signed-in Artist');
    const guestName = uniqueName('Artist Guest');
    const guestEmail = `signed-in-guest-${Date.now()}@example.com`;

    const assignments = await openGuestManagement(adminPage, eventId);
    await createAssignment(assignments, {
      displayName: assignmentName,
      email: SHARED_USER_ACCOUNT.email,
      role: 'artist',
    });

    await authedPage.goto('/guest-lists');
    const list = await waitForGuestListsHarness(authedPage);
    await expect
      .poll(
        async () =>
          (await list.getAssignmentLinks())
            .map((link) => link.text)
            .join('\n')
            .toLowerCase(),
        {timeout: 20_000},
      )
      .toContain(eventTitle.toLowerCase());
    await list.clickAssignment();
    await expect(authedPage).toHaveURL(/\/guest-lists\/[^/]+$/);

    const manage = await waitForGuestListManageHarness(authedPage);
    await manage.fillGuest(guestName, guestEmail);
    await manage.submitGuest();
    await expect
      .poll(async () => (await manage.getGuestRows()).join('\n'), {
        timeout: 20_000,
      })
      .toContain(guestName);
    await expect
      .poll(() => manage.getUsageText(), {timeout: 20_000})
      .toContain('1 of 2');

    const email = new EmailHarness(page, convexHelper);
    await email.navigateToLatestEmail(
      guestEmail,
      new RegExp(`Your ticket for ${eventTitle}`, 'i'),
      {timeoutMs: 60_000},
    );
    await email.expectText(guestName);
    await email.expectText(eventTitle);
    await expectOrganizerAttribution(
      adminPage,
      guestName,
      `Added by Artist ${assignmentName}`,
    );
  });

  test('accountless delegate reuses the invite link and adds an attributed guest', async ({
    adminPage,
    convexHelper,
    page,
  }) => {
    test.setTimeout(120_000);
    const eventTitle = uniqueName('Accountless delegate event');
    const eventId = await seedManagedEvent(convexHelper, eventTitle);
    const assignmentName = uniqueName('Accountless Staff');
    const assignmentEmail = `accountless-staff-${Date.now()}@example.com`;
    const guestName = uniqueName('Staff Guest');
    const guestEmail = `accountless-guest-${Date.now()}@example.com`;

    const assignments = await openGuestManagement(adminPage, eventId);
    await createAssignment(assignments, {
      displayName: assignmentName,
      email: assignmentEmail,
      role: 'staff',
    });

    const invite = new EmailHarness(page, convexHelper);
    await invite.navigateToLatestEmail(
      assignmentEmail,
      new RegExp(`Manage your guest list for ${eventTitle}`, 'i'),
      {timeoutMs: 60_000},
    );
    await invite.clickLink(/Manage guest list/i);
    await expect(page).toHaveURL(/\/guest-list\/manage$/);

    let manage = await waitForGuestListManageHarness(page);
    await manage.fillGuest(guestName, guestEmail);
    await manage.submitGuest();
    await expect
      .poll(async () => (await manage.getGuestRows()).join('\n'), {
        timeout: 20_000,
      })
      .toContain(guestName);

    await page.reload();
    manage = await waitForGuestListManageHarness(page);
    await expect
      .poll(async () => (await manage.getGuestRows()).join('\n'), {
        timeout: 20_000,
      })
      .toContain(guestName);
    await expect
      .poll(() => manage.getUsageText(), {timeout: 20_000})
      .toContain('1 of 2');

    const ticket = new EmailHarness(page, convexHelper);
    await ticket.navigateToLatestEmail(
      guestEmail,
      new RegExp(`Your ticket for ${eventTitle}`, 'i'),
      {timeoutMs: 60_000},
    );
    await ticket.expectText(guestName);
    await ticket.expectText(eventTitle);
    await expectOrganizerAttribution(
      adminPage,
      guestName,
      `Added by Staff ${assignmentName}`,
    );
  });
});
