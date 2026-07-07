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
import {ImportSurfaceComponentHarness} from '../../src/app/features/admin/import/import-surface.component.harness';
import {CheckInComponentHarness} from '../../src/app/features/admin/pages/check-in/check-in.component.harness';

/**
 * WAVE 3 E2E — the two critical import journeys, driven end-to-end through the
 * UI (never asserted via convexHelper):
 *
 *   (a) guest bulk add — paste rows, preview, confirm, see the guest in the list
 *   (b) external ticket import + door scan — import an RA-style CSV via the buyer
 *       flow, see the source badge, then check one entry in from the door via the
 *       roster barcode-search fallback and see the checked-in state.
 *
 * Seeding uses production/testing mutations for SETUP ONLY. Every assertion is
 * on DOM state. Removing the `page.*`/harness interactions would break both
 * tests, satisfying the litmus test.
 */

async function seedOrgWithAdmin(
  convexHelper: ConvexHelper,
  orgName: string,
): Promise<string> {
  const orgId = await convexHelper.mutation(
    api.testing.communities.seedOrganizer,
    {name: orgName},
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
  return orgId;
}

async function seedEvent(
  convexHelper: ConvexHelper,
  orgId: string,
  title: string,
): Promise<string> {
  return convexHelper.mutation(api.testing.events.seedEvent, {
    title,
    date: '2030-12-15',
    price: 2500,
    totalTickets: 150,
    status: 'published',
    organizerId: orgId as Id<'organizers'>,
  });
}

async function gotoManage(adminPage: Page, eventId: string): Promise<void> {
  await adminPage.goto(`/community-admin/events/${eventId}/manage`);
  await expect(adminPage).toHaveURL(
    new RegExp(`/community-admin/events/${eventId}/manage`),
  );
  await expect(adminPage.locator('h1')).toBeVisible({timeout: 15000});
}

test.describe('CSV import — external tickets & guest bulk add', () => {
  test('bulk-adds guests from a pasted block and shows them in the roster', async ({
    adminPage,
    convexHelper,
  }) => {
    const orgId = await seedOrgWithAdmin(
      convexHelper,
      uniqueName('Guest Import Org'),
    );
    const eventTitle = uniqueName('Guest Import Event');
    const eventId = await seedEvent(convexHelper, orgId, eventTitle);

    await gotoManage(adminPage, eventId);

    const mgmtHarness = await createEnvironment(adminPage).getHarness(
      EventManagementHarness,
    );
    await mgmtHarness.clickTab('guests');

    // Open the deferred import surface via the guests-tab button.
    await adminPage.getByTestId('import-guests-button').click();
    await expect(adminPage.locator('app-import-surface')).toBeVisible({
      timeout: 15000,
    });

    const guestName = uniqueName('Bulk Guest');
    const importHarness = await createEnvironment(adminPage).getHarness(
      ImportSurfaceComponentHarness,
    );
    await importHarness.pasteText(
      `name,email,type,notes\n${guestName},${guestName.replace(/\s+/g, '.').toLowerCase()}@test.com,guest,vip row`,
    );
    await importHarness.clickNext();

    // Preview reports exactly one valid row before we confirm.
    await expect
      .poll(() => importHarness.getRowCountByPartition('valid'), {
        timeout: 15000,
      })
      .toBe(1);
    await expect
      .poll(() => importHarness.isConfirmDisabled(), {timeout: 15000})
      .toBe(false);
    await importHarness.clickConfirm();

    // End-to-end proof: after confirm commits the batch, the guest appears in
    // the reactive roster (Convex mutation → subscription → signal → DOM). The
    // guests-tab collapses the importer on its data-changed refresh, so the
    // roster row — not the transient report step — is the durable assertion.
    const guestRow = adminPage
      .locator('[data-testid="guest-row"]')
      .filter({hasText: guestName})
      .first();
    await expect(guestRow).toBeVisible({timeout: 15000});
  });

  test('imports RA-style external tickets, shows the source badge, and checks one in at the door', async ({
    adminPage,
    convexHelper,
  }) => {
    const orgId = await seedOrgWithAdmin(
      convexHelper,
      uniqueName('External Import Org'),
    );
    const eventTitle = uniqueName('External Import Event');
    const eventId = await seedEvent(convexHelper, orgId, eventTitle);

    await gotoManage(adminPage, eventId);

    const mgmtHarness = await createEnvironment(adminPage).getHarness(
      EventManagementHarness,
    );
    await mgmtHarness.clickTab('buyers');

    // Open the deferred external-ticket import surface.
    await adminPage.getByTestId('import-tickets-button').click();
    await expect(adminPage.locator('app-import-surface')).toBeVisible({
      timeout: 15000,
    });

    // A small RA-style CSV: one row per ticket, with a barcode we later scan.
    const holderName = uniqueName('RA Holder');
    const barcode = `BC${Date.now()}`;
    const sourceLabel = 'RA';
    const importHarness = await createEnvironment(adminPage).getHarness(
      ImportSurfaceComponentHarness,
    );
    await importHarness.pasteText(
      [
        'Barcode,Billing name,Date purchased,Email,Order number,Ticket type',
        `${barcode},${holderName},2026-07-06 12:28,${holderName.replace(/\s+/g, '.').toLowerCase()}@ra.example,ORD-1,General Admission`,
      ].join('\n'),
    );
    await importHarness.clickNext();

    await expect
      .poll(() => importHarness.getRowCountByPartition('valid'), {
        timeout: 15000,
      })
      .toBe(1);
    // The source-label input (buyer target only) renders at the preview step.
    await importHarness.setSourceLabel(sourceLabel);
    await expect
      .poll(() => importHarness.isConfirmDisabled(), {timeout: 15000})
      .toBe(false);
    await importHarness.clickConfirm();

    // The imported entry appears with its external source badge in the buyers
    // view once the batch commits (reactive imported-entries query → DOM). The
    // buyers-tab collapses the importer on its data-changed refresh, so assert
    // on the durable roster rather than the transient report step. The source
    // badge is rendered at the batch container level, so scope to the batch
    // that holds this entry.
    const importedBatch = adminPage
      .locator('[data-testid="imported-batch"]')
      .filter({hasText: holderName})
      .first();
    await expect(importedBatch).toBeVisible({timeout: 15000});
    await expect(
      importedBatch.locator('[data-testid="imported-source-badge"]'),
    ).toContainText(sourceLabel);
    await expect(
      importedBatch
        .locator('[data-testid="imported-entry-row"]')
        .filter({hasText: holderName}),
    ).toBeVisible();

    // Door flow: navigate to the scanner, select the event, and use the manual
    // barcode-search fallback to find and check in the external entry.
    await adminPage.goto('/scanner');
    await expect(adminPage).toHaveURL(/\/scanner/);
    await expect(adminPage.locator('app-check-in')).toBeVisible({
      timeout: 15000,
    });

    const checkInHarness = await createEnvironment(adminPage).getHarness(
      CheckInComponentHarness,
    );
    await expect(
      adminPage.locator('select[aria-label="Select event"] option', {
        hasText: eventTitle,
      }),
    ).toBeAttached({timeout: 15000});
    await checkInHarness.selectEventByLabel(eventTitle);

    // The imported section renders the entry with its source badge at the door.
    await expect
      .poll(() => checkInHarness.getImportedEntryCount(), {timeout: 15000})
      .toBeGreaterThan(0);
    await expect(
      adminPage
        .locator('[data-testid="imported-entry"]')
        .filter({hasText: holderName})
        .first(),
    ).toBeVisible({timeout: 15000});

    // Manual fallback: search by the barcode digits printed under the QR.
    await checkInHarness.enterSearchTerm(barcode);
    const doorRow = adminPage
      .locator('[data-testid="imported-entry"]')
      .filter({hasText: holderName})
      .first();
    await expect(doorRow).toBeVisible({timeout: 15000});

    // Check the entry in and assert the reactive checked-in state through the DOM.
    await checkInHarness.clickImportedCheckInByName(holderName);
    await expect(doorRow.getByText(/checked in/i)).toBeVisible({
      timeout: 15000,
    });
  });
});
