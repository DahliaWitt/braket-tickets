import { test, expect, uniqueName, createEnvironment } from '../helpers/test-setup';
import { signInUser, waitForAuthenticatedDashboard } from '../test-utils/auth-helpers';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { CheckInComponentHarness } from '../../src/app/features/admin/pages/check-in/check-in.component.harness';

/**
 * E2E Tests for Scanner Community Scoping (BRA-138)
 *
 * Verifies that:
 * - Scanner users with community_scanners assignments can access /scanner
 * - Scanner users see only events from their assigned communities
 * - Users without scanner assignments are redirected from /scanner
 * - Regular users (no scanner role) are redirected from /scanner
 */

type ConvexHelper = Parameters<Parameters<typeof test>[2]>[0]['convexHelper'];

async function getRootAdminId(convexHelper: ConvexHelper): Promise<Id<'users'>> {
  const admin = await convexHelper.query(api.testing.users.getByEmail, {
    email: 'global-admin@example.com',
  });
  if (!admin) throw new Error('Root admin not found — global.setup.ts may not have run');
  return admin._id;
}

async function seedScannerUser(
  convexHelper: ConvexHelper,
  opts: { suffix: string; orgId: Id<'organizers'>; grantedBy: Id<'users'> },
) {
  const email = `scanner-${opts.suffix}@example.com`;
  const password = 'Scanner123!';
  const tokens = await convexHelper.action(api.testing.users_node.seedUserAndGetTokens, {
    email,
    password,
    name: `Scanner ${opts.suffix}`,
  });
  await convexHelper.mutation(api.testing.communities.seedCommunityScanner, {
    userId: tokens.userId as Id<'users'>,
    organizerId: opts.orgId,
    grantedBy: opts.grantedBy,
  });
  return { email, password, userId: tokens.userId as Id<'users'> };
}

test.describe('Scanner Community Scoping', () => {
  test.slow();

  test('scanner user can access /scanner and sees assigned community events', async ({
    page,
    convexHelper,
  }) => {
    const suffix = `scope-${Date.now()}`;
    const adminId = await getRootAdminId(convexHelper);

    const orgId = await convexHelper.mutation(api.testing.communities.seedOrganizer, {
      name: uniqueName(`ScanOrg ${suffix}`),
    });

    const eventTitle = uniqueName(`ScanEvent ${suffix}`);
    await convexHelper.mutation(api.testing.events.seedEvent, {
      title: eventTitle,
      date: '2030-06-15',
      price: 2000,
      totalTickets: 100,
      status: 'published',
      organizerId: orgId,
    });

    const scanner = await seedScannerUser(convexHelper, {
      suffix,
      orgId,
      grantedBy: adminId,
    });

    await signInUser(page, scanner.email, scanner.password);
    await page.goto('/scanner');

    await expect(page).toHaveURL(/\/scanner/, { timeout: 15000 });
    // Use level: 1 to specifically target the h1 page heading (not event card h3s)
    await expect(page.getByRole('heading', { level: 1, name: /^Check-In$/i })).toBeVisible({
      timeout: 10000,
    });

    // Get harness to verify check-in component is ready
    await createEnvironment(page).getHarness(CheckInComponentHarness);
    await expect(
      page.locator('select[aria-label="Select event"] option', { hasText: eventTitle }),
    ).toHaveCount(1, { timeout: 15000 });
  });

  test('scanner user does not see events from unassigned communities', async ({
    page,
    convexHelper,
  }) => {
    const suffix = `iso-${Date.now()}`;
    const adminId = await getRootAdminId(convexHelper);

    const orgA = await convexHelper.mutation(api.testing.communities.seedOrganizer, {
      name: uniqueName(`OrgA ${suffix}`),
    });
    const orgB = await convexHelper.mutation(api.testing.communities.seedOrganizer, {
      name: uniqueName(`OrgB ${suffix}`),
    });

    const eventATitle = uniqueName(`EventA ${suffix}`);
    const eventBTitle = uniqueName(`EventB ${suffix}`);

    await convexHelper.mutation(api.testing.events.seedEvent, {
      title: eventATitle,
      date: '2030-06-15',
      price: 2000,
      totalTickets: 100,
      status: 'published',
      organizerId: orgA,
    });
    await convexHelper.mutation(api.testing.events.seedEvent, {
      title: eventBTitle,
      date: '2030-06-16',
      price: 2000,
      totalTickets: 100,
      status: 'published',
      organizerId: orgB,
    });

    // Scanner assigned to Org A only
    const scanner = await seedScannerUser(convexHelper, {
      suffix,
      orgId: orgA,
      grantedBy: adminId,
    });

    await signInUser(page, scanner.email, scanner.password);
    await page.goto('/scanner');

    await expect(page).toHaveURL(/\/scanner/, { timeout: 15000 });

    // Wait for check-in component to be ready (poll for harness)
    await expect
      .poll(
        async () => {
          try {
            await createEnvironment(page).getHarness(CheckInComponentHarness);
            return true;
          } catch {
            return false;
          }
        },
        { timeout: 15000 },
      )
      .toBe(true);

    // Wait for Org A event to appear (data loaded)
    await expect(
      page.locator('select[aria-label="Select event"] option', { hasText: eventATitle }),
    ).toHaveCount(1, {
      timeout: 10000,
    });

    // Org B event must NOT be in the dropdown
    await expect(
      page.locator('select[aria-label="Select event"] option', { hasText: eventBTitle }),
    ).toHaveCount(0);
  });

  test('regular user without scanner role is redirected from /scanner', async ({ authedPage }) => {
    await authedPage.goto('/scanner');
    await waitForAuthenticatedDashboard(authedPage);
  });
});
