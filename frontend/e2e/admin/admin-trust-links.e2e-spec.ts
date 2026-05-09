import {test, expect, createEnvironment} from '../helpers/test-setup';
import {type Page} from '@playwright/test';
import {SharedVettingTableHarness} from '../../src/app/features/admin/components/shared-vetting-table/shared-vetting-table.harness';
import {BraDialogHarness} from '../../src/app/ui/components/composites/dialog/dialog.component.harness';
import {BraToastHarness} from '../../src/app/ui/components/composites/toast/toast.component.harness';
import {api} from '@convex/_generated/api';

async function selectCommunityInSharedVetting(
  adminPage: Page,
  orgId: string,
  orgNamePattern: RegExp,
): Promise<void> {
  await adminPage.goto('/community-admin/shared-vetting');

  // Wait for the dashboard shell to render - the h1 contains the community name, not "Community Admin"
  await expect(adminPage.getByRole('heading', {level: 1})).toBeVisible({
    timeout: 15000,
  });

  // Wait for loading state to complete (skeleton screens)
  const loadingState = adminPage.getByTestId('loading-state');
  await expect(loadingState).not.toBeVisible({timeout: 15000});

  // Now check if we have the empty state (no communities) or a selector
  const emptyState = adminPage.getByTestId('empty-state');
  const dashboardSelect = adminPage.locator('#community-select');
  const dashboardLabel = adminPage.getByTestId('community-name');
  const vettingSelect = adminPage.locator('#organizer-select');

  // Wait for at least one community selector variant OR empty state to become visible
  await expect
    .poll(
      async () => {
        const emptyStateVisible = await emptyState
          .isVisible()
          .catch(() => false);
        const dashboardSelectVisible = await dashboardSelect
          .isVisible()
          .catch(() => false);
        const dashboardLabelVisible = await dashboardLabel
          .isVisible()
          .catch(() => false);
        const vettingSelectVisible = await vettingSelect
          .isVisible()
          .catch(() => false);
        return (
          emptyStateVisible ||
          dashboardSelectVisible ||
          dashboardLabelVisible ||
          vettingSelectVisible
        );
      },
      {timeout: 15000},
    )
    .toBeTruthy();

  // If empty state is visible, we need to refresh and try again (data may not have synced yet)
  if (await emptyState.isVisible().catch(() => false)) {
    // Reload to allow Convex subscription to update
    await adminPage.reload();
    await expect(adminPage.getByRole('heading', {level: 1})).toBeVisible({
      timeout: 15000,
    });
    await expect(loadingState).not.toBeVisible({timeout: 15000});

    // Check again after reload
    const stillEmpty = await emptyState.isVisible().catch(() => false);
    if (stillEmpty) {
      throw new Error(
        'No communities found after reload. Communities may not have been seeded properly.',
      );
    }
  }

  // Handle the shared vetting table's organizer selector (for root admin with multiple orgs)
  if (await vettingSelect.isVisible().catch(() => false)) {
    await expect(vettingSelect.locator('option')).not.toHaveCount(0, {
      timeout: 15000,
    });
    await expect
      .poll(
        async () => {
          const option = adminPage.locator(
            `#organizer-select option[value="${orgId}"]`,
          );
          return (await option.count()) > 0;
        },
        {timeout: 15000},
      )
      .toBeTruthy();
    await vettingSelect.selectOption({value: orgId});
    return;
  }

  // Handle dashboard shell community selector (dropdown for multiple communities)
  if (await dashboardSelect.isVisible().catch(() => false)) {
    await expect(dashboardSelect.locator('option')).not.toHaveCount(0, {
      timeout: 15000,
    });
    await expect
      .poll(
        async () => {
          const option = adminPage.locator(
            `#community-select option[value="${orgId}"]`,
          );
          return (await option.count()) > 0;
        },
        {timeout: 15000},
      )
      .toBeTruthy();
    await dashboardSelect.selectOption({value: orgId});
    return;
  }

  // Handle single community label
  if (await dashboardLabel.isVisible().catch(() => false)) {
    await expect(dashboardLabel).toContainText(orgNamePattern, {
      timeout: 15000,
    });
    return;
  }

  // If we get here, something unexpected happened
  throw new Error('Community selector state is unexpected after loading.');
}

/**
 * E2E Tests for Admin Trust Link Management
 *
 * Covers CRUD operations on the admin shared-vetting tab:
 * - Create trust link via dialog
 * - Remove with confirmation dialog
 * - Incoming links are read-only
 *
 * Uses convexHelper for data SETUP only (seeding communities, trust links).
 * The system under test is always the UI.
 */
test.describe('Admin Trust Link Management', () => {
  test('can create a trust link via the dialog', async ({
    adminPage,
    convexHelper,
  }) => {
    const suffix = Date.now();

    // Get the admin user
    const adminUser = await convexHelper.query(api.testing.users.getByEmail, {
      email: 'global-admin@example.com',
    });
    if (!adminUser) throw new Error('Admin user not found');

    // Seed two communities
    const orgA = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: `CREATE_SRC_${suffix}`,
      },
    );
    const orgB = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: `CREATE_TGT_${suffix}`,
      },
    );

    // Assign admin to both communities so they appear in the selector
    await convexHelper.mutation(api.testing.communities.seedCommunityAdmin, {
      userId: adminUser._id,
      organizerId: orgA,
      grantedBy: adminUser._id,
    });
    await convexHelper.mutation(api.testing.communities.seedCommunityAdmin, {
      userId: adminUser._id,
      organizerId: orgB,
      grantedBy: adminUser._id,
    });

    // Select source community (wait for dropdown to populate first)
    await selectCommunityInSharedVetting(
      adminPage,
      orgA,
      new RegExp(`CREATE_SRC_${suffix}`),
    );

    // Wait for the community's trust data to load after selection
    await expect(
      adminPage.getByRole('button', {name: /Create Trust Link/i}),
    ).toBeVisible({
      timeout: 10000,
    });

    // Open create dialog
    await adminPage.getByRole('button', {name: /Create Trust Link/i}).click();

    const dialog = adminPage.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({timeout: 5000});

    // Explicitly select orgB (CREATE_TGT) in the dialog dropdown — avoids relying on
    // pre-selection order which is non-deterministic when other tests seed orgs concurrently.
    const orgSelectInDialog = dialog.locator(
      '[data-testid="trust-link-org-select"]',
    );
    await expect(orgSelectInDialog).toBeVisible({timeout: 5000});
    await orgSelectInDialog.selectOption({value: orgB});

    // Confirm
    const env = createEnvironment(adminPage);
    const createDialogHarness = await env.getHarness(BraDialogHarness);
    const toastHarness = await env.getHarness(BraToastHarness);
    await createDialogHarness.clickOk();

    // Toast confirms creation
    await expect
      .poll(() => toastHarness.hasToastWithText(/trust link created/i), {
        timeout: 10000,
      })
      .toBe(true);

    // Dismiss toast to prevent overlay blocking
    await adminPage.keyboard.press('Escape');
    await toastHarness.waitForToastHidden();

    // Verify link appears in table via harness
    const harness = await env.getHarness(SharedVettingTableHarness);
    await expect
      .poll(
        async () => {
          const links = await harness.getOutgoingLinks();
          return links.some((l) => l.name === `CREATE_TGT_${suffix}`);
        },
        {timeout: 15000},
      )
      .toBe(true);
  });

  test('remove requires confirmation dialog', async ({
    adminPage,
    convexHelper,
  }) => {
    const suffix = Date.now();

    // Get the admin user
    const adminUser = await convexHelper.query(api.testing.users.getByEmail, {
      email: 'global-admin@example.com',
    });
    if (!adminUser) throw new Error('Admin user not found');

    // Seed communities and an active trust link
    const orgA = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: `REMOVE_SRC_${suffix}`,
      },
    );
    const orgB = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: `REMOVE_TGT_${suffix}`,
      },
    );

    // Assign admin to the source community so it appears in the selector
    await convexHelper.mutation(api.testing.communities.seedCommunityAdmin, {
      userId: adminUser._id,
      organizerId: orgA,
      grantedBy: adminUser._id,
    });

    await convexHelper.mutation(api.testing.trust_links.seedTrustLink, {
      trustingOrganizerId: orgA,
      trustedOrganizerId: orgB,
      createdBy: adminUser._id,
    });

    // Select source community (wait for dropdown to populate)
    await selectCommunityInSharedVetting(
      adminPage,
      orgA,
      new RegExp(`REMOVE_SRC_${suffix}`),
    );

    // Wait for outgoing trust links section to load
    await expect(adminPage.getByText(/Organizers You Trust/i)).toBeVisible({
      timeout: 10000,
    });

    // Wait for link to appear after community selection, then get harness
    await expect(
      adminPage
        .locator('[data-testid="outgoing-row"], [data-testid="outgoing-card"]')
        .first(),
    ).toBeVisible({timeout: 15000});
    const env = createEnvironment(adminPage);
    const harness = await env.getHarness(SharedVettingTableHarness);
    const toastHarness = await env.getHarness(BraToastHarness);

    // Click Remove via harness — should open confirmation dialog
    await harness.clickRemove(`REMOVE_TGT_${suffix}`);

    // Confirmation dialog should appear
    const dialog = adminPage.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({timeout: 5000});
    await expect(dialog.locator('[data-testid="z-title"]')).toContainText(
      'Remove Trust Link',
    );

    // Cancel first — link should remain present
    const cancelDialogHarness = await env.getHarness(BraDialogHarness);
    await cancelDialogHarness.clickCancel();
    await expect(dialog).not.toBeVisible({timeout: 3000});
    await expect
      .poll(
        async () => {
          const links = await harness.getOutgoingLinks();
          return links.some((l) => l.name === `REMOVE_TGT_${suffix}`);
        },
        {timeout: 10000},
      )
      .toBe(true);

    // Remove again, this time confirm
    await harness.clickRemove(`REMOVE_TGT_${suffix}`);
    const confirmDialog = adminPage.locator('[role="dialog"]:visible');
    await expect(confirmDialog.getByTestId('z-ok-button')).toBeVisible({
      timeout: 5000,
    });
    await confirmDialog.getByTestId('z-ok-button').click();

    // Toast confirms removal
    await expect
      .poll(() => toastHarness.hasToastWithText(/removed/i), {timeout: 10000})
      .toBe(true);

    // Row should be removed from the table.
    await adminPage.keyboard.press('Escape');
    await toastHarness.waitForToastHidden();
    await expect
      .poll(
        async () => {
          const links = await harness.getOutgoingLinks();
          return links.some((l) => l.name === `REMOVE_TGT_${suffix}`);
        },
        {timeout: 20000},
      )
      .toBe(false);

    const revokeAuditLog = await convexHelper.query(
      api.testing.admin.getLatestAuditLog,
      {
        adminId: adminUser._id,
        action: 'trust_link_revoked',
      },
    );
    expect(revokeAuditLog).toMatchObject({
      action: 'trust_link_revoked',
      organizerId: orgA,
      trustingOrganizerId: orgA,
      trustedOrganizerId: orgB,
    });
  });

  test('incoming trust links section is read-only', async ({
    adminPage,
    convexHelper,
  }) => {
    const suffix = Date.now();

    // Get the admin user
    const adminUser = await convexHelper.query(api.testing.users.getByEmail, {
      email: 'global-admin@example.com',
    });
    if (!adminUser) throw new Error('Admin user not found');

    const orgA = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: `INCOMING_SRC_${suffix}`,
      },
    );
    const orgB = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: `INCOMING_TGT_${suffix}`,
      },
    );

    // Assign admin to orgB so it appears in the selector
    await convexHelper.mutation(api.testing.communities.seedCommunityAdmin, {
      userId: adminUser._id,
      organizerId: orgB,
      grantedBy: adminUser._id,
    });

    // Create trust link: orgA trusts orgB
    await convexHelper.mutation(api.testing.trust_links.seedTrustLink, {
      trustingOrganizerId: orgA,
      trustedOrganizerId: orgB,
      createdBy: adminUser._id,
    });

    // Select orgB to see incoming links (wait for dropdown to populate)
    await selectCommunityInSharedVetting(
      adminPage,
      orgB,
      new RegExp(`INCOMING_TGT_${suffix}`),
    );

    // Wait for the incoming trust section heading
    await expect(adminPage.getByText(/Organizers That Trust You/i)).toBeVisible(
      {timeout: 10000},
    );

    // Verify incoming link shows the trusting org name via harness
    const env = createEnvironment(adminPage);
    const harness = await env.getHarness(SharedVettingTableHarness);
    await expect
      .poll(
        async () => {
          const links = await harness.getIncomingLinks();
          return links.some((l) => l.name === `INCOMING_SRC_${suffix}`);
        },
        {timeout: 10000},
      )
      .toBe(true);

    // The incoming section should have no Pause/Resume/Revoke buttons —
    // scope to the incoming link cards (they are read-only, no actions)
    const incomingLinks = adminPage.locator('[data-testid="incoming-link"]');
    const actionButtons = incomingLinks.getByRole('button', {
      name: /Pause|Resume|Revoke/i,
    });
    await expect(actionButtons).toHaveCount(0);
  });

  test('shows empty state when no trust links exist', async ({
    adminPage,
    convexHelper,
  }) => {
    const suffix = Date.now();

    // Get the admin user
    const adminUser = await convexHelper.query(api.testing.users.getByEmail, {
      email: 'global-admin@example.com',
    });
    if (!adminUser) throw new Error('Admin user not found');

    // Seed two communities — the community selector dropdown only renders when
    // the user administers more than one community (hasMultipleCommunities check).
    const orgA = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: `EMPTY_ORG_${suffix}`,
      },
    );
    const orgB = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: `EMPTY_ORG_PAIR_${suffix}`,
      },
    );

    // Assign admin to both communities so they appear in the selector
    await convexHelper.mutation(api.testing.communities.seedCommunityAdmin, {
      userId: adminUser._id,
      organizerId: orgA,
      grantedBy: adminUser._id,
    });
    await convexHelper.mutation(api.testing.communities.seedCommunityAdmin, {
      userId: adminUser._id,
      organizerId: orgB,
      grantedBy: adminUser._id,
    });

    await selectCommunityInSharedVetting(
      adminPage,
      orgA,
      new RegExp(`EMPTY_ORG_${suffix}`),
    );

    // Wait for the Create Trust Link button to confirm the community context is loaded,
    // then verify empty state via harness. Timeout bumped to 15 000 ms — the outgoing
    // query must finish loading before the empty state element is rendered.
    await expect(
      adminPage.getByRole('button', {name: /Create Trust Link/i}),
    ).toBeVisible({
      timeout: 10000,
    });
    const env = createEnvironment(adminPage);
    const harness = await env.getHarness(SharedVettingTableHarness);
    await expect
      .poll(async () => harness.getEmptyStateText(), {timeout: 15000})
      .not.toBeNull();
  });
});
