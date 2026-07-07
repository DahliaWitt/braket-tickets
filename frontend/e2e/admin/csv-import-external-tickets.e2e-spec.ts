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
import {EventManagementGuestsTabHarness} from '../../src/app/features/admin/pages/event-management/components/event-management-guests-tab/event-management-guests-tab.component.harness';
import {EventManagementBuyersTabHarness} from '../../src/app/features/admin/pages/event-management/components/event-management-buyers-tab/event-management-buyers-tab.component.harness';
import {EventManagementPurchasesPanelHarness} from '../../src/app/features/admin/pages/event-management/components/event-management-purchases-panel/event-management-purchases-panel.component.harness';
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

    // Open the deferred import surface via the guests-tab harness.
    const guestsTab = await createEnvironment(adminPage).getHarness(
      EventManagementGuestsTabHarness,
    );
    await guestsTab.clickImportButton();
    await expect
      .poll(() => guestsTab.isImportPanelOpen(), {timeout: 15000})
      .toBe(true);

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
    // guest list renders alongside the importer, so the roster row — not the
    // transient report step — is the durable assertion; the harness reads both
    // responsive row variants, staying stable across the desktop/mobile split.
    // The confirm handler reloads the tab data, which re-renders the guests-tab
    // host — a harness captured earlier would hold a detached root, and during
    // the reload getHarness transiently throws. Re-resolve on every poll and
    // tolerate absence so the assertion tracks the live host.
    await expect
      .poll(
        async () => {
          try {
            const tab = await createEnvironment(adminPage).getHarness(
              EventManagementGuestsTabHarness,
            );
            return await tab.hasGuestRowWithText(guestName);
          } catch {
            return false;
          }
        },
        {timeout: 15000},
      )
      .toBe(true);
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

    // Open the deferred external-ticket import surface via the buyers-tab harness.
    const buyersTab = await createEnvironment(adminPage).getHarness(
      EventManagementBuyersTabHarness,
    );
    await buyersTab.clickImportButton();
    await expect
      .poll(() => buyersTab.isImportPanelOpen(), {timeout: 15000})
      .toBe(true);

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
    // confirm handler reloads the tab data and re-renders the purchases-panel
    // host, so re-resolve the harness on every poll rather than caching a
    // detached root. Until the panel host mounts (the import surface is still
    // up), getHarness throws — swallow that so the poll keeps retrying.
    const tryPurchasesPanel =
      async (): Promise<EventManagementPurchasesPanelHarness | null> => {
        try {
          return await createEnvironment(adminPage).getHarness(
            EventManagementPurchasesPanelHarness,
          );
        } catch {
          return null;
        }
      };
    await expect
      .poll(
        async () => {
          const panel = await tryPurchasesPanel();
          return panel ? panel.hasImportedRowWithText(holderName) : false;
        },
        {timeout: 15000},
      )
      .toBe(true);
    // The source badge and this entry share the same batch container.
    await expect
      .poll(
        async () => {
          const panel = await tryPurchasesPanel();
          if (!panel) return false;
          const texts = await panel.getImportedBatchTexts();
          return texts.some(
            (t) => t.includes(holderName) && t.includes(sourceLabel),
          );
        },
        {timeout: 15000},
      )
      .toBe(true);

    // Door flow: navigate to the scanner, select the event, and use the manual
    // barcode-search fallback to find and check in the external entry.
    await adminPage.goto('/scanner');
    await expect(adminPage).toHaveURL(/\/scanner/);

    // The scanner view mounts asynchronously and reactive imported-list updates
    // can detach a cached harness root, so resolve the check-in harness fresh on
    // every access and tolerate transient absence.
    const tryCheckIn = async (): Promise<CheckInComponentHarness | null> => {
      try {
        return await createEnvironment(adminPage).getHarness(
          CheckInComponentHarness,
        );
      } catch {
        return null;
      }
    };
    await expect
      .poll(async () => (await tryCheckIn()) !== null, {timeout: 15000})
      .toBe(true);

    // selectEventByLabel polls for the option internally before selecting.
    await (await tryCheckIn())!.selectEventByLabel(eventTitle);

    // The imported section renders the entry with its source badge at the door.
    await expect
      .poll(async () => (await tryCheckIn())?.getImportedEntryCount() ?? 0, {
        timeout: 15000,
      })
      .toBeGreaterThan(0);
    await expect
      .poll(
        async () =>
          (await tryCheckIn())?.getImportedEntryTextByName(holderName) ?? null,
        {timeout: 15000},
      )
      .not.toBeNull();

    // Manual fallback: search by the barcode digits printed under the QR.
    await (await tryCheckIn())!.enterSearchTerm(barcode);
    await expect
      .poll(
        async () =>
          (await tryCheckIn())?.getImportedEntryTextByName(holderName) ?? null,
        {timeout: 15000},
      )
      .not.toBeNull();

    // Check the entry in and assert the reactive checked-in state through the DOM.
    await (await tryCheckIn())!.clickImportedCheckInByName(holderName);
    await expect
      .poll(
        async () => {
          const text = await ((
            await tryCheckIn()
          )?.getImportedEntryTextByName(holderName) ?? null);
          return text?.toLowerCase().includes('checked in') ?? false;
        },
        {timeout: 15000},
      )
      .toBe(true);
  });
});
