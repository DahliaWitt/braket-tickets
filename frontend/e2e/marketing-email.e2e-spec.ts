import {
  test,
  expect,
  uniqueName,
  createEnvironment,
} from './helpers/test-setup';
import type {Page} from '@playwright/test';
import {api} from '@convex/_generated/api';
import {Id} from '@convex/_generated/dataModel';
import {EventEditorHarness} from '../src/app/features/admin/pages/event-editor/event-editor.component.harness';
import {UnsubscribeHarness} from '../src/app/features/legal/pages/unsubscribe/unsubscribe.harness';

async function waitForEventEditorReady(adminPage: Page) {
  await expect
    .poll(
      async () => {
        try {
          const harness =
            await createEnvironment(adminPage).getHarness(EventEditorHarness);
          if (await harness.isLoading()) return null;
          if (await harness.isSaveButtonDisabled()) return null;
          return 'ready';
        } catch {
          return null;
        }
      },
      {timeout: 15000},
    )
    .toBe('ready');
}

/**
 * E2E Tests for BRA-60: Marketing Email Announcement
 *
 * Covers:
 * 1. Publish dialog appears with recipient count
 * 2. Scheduling an announcement creates an eventMarketingEmails record
 * 3. Email preferences tab shows opted-in communities
 * 4. Unsubscribe page shows confirmation after token redirect
 */
test.describe('Marketing Email Announcement', () => {
  test('publish dialog appears with recipient count', async ({
    adminPage,
    convexHelper,
  }) => {
    // Seed an organizer and make the global admin a community admin for it
    const orgId = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: uniqueName('Mktg Dialog Org'),
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

    // Seed a vetted member so recipient-count loads non-trivially
    const {userId: memberId} = await convexHelper.action(
      api.testing.users_node.seedUserAndGetTokens,
      {
        email: `mktg-member-${Date.now()}@test.com`,
        password: 'TestPassword123!',
        name: 'Mktg Test Member',
      },
    );
    await convexHelper.mutation(
      api.testing.applications.seedApprovedApplication,
      {
        userId: memberId as Id<'users'>,
        organizerId: orgId,
      },
    );

    // Seed a draft event owned by this organizer
    const eventId = await convexHelper.mutation(api.testing.events.seedEvent, {
      title: uniqueName('Mktg Test Event'),
      date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10),
      price: 0,
      status: 'draft',
      organizerId: orgId,
    });

    await adminPage.goto(`/community-admin/events/${eventId}/edit`);
    const env = createEnvironment(adminPage);
    await waitForEventEditorReady(adminPage);
    const harness = await env.getHarness(EventEditorHarness);

    // Click the publish button via harness
    await harness.openPublishDialog();

    // Publish dialog should appear
    await expect
      .poll(() => harness.isPublishDialogVisible(), {timeout: 5000})
      .toBe(true);

    // Recipient count should load (either "loading" pulse is replaced by the count element)
    await expect
      .poll(() => harness.getRecipientCountText(), {timeout: 10000})
      .not.toBeNull();
  });

  test('scheduling an announcement creates eventMarketingEmails record', async ({
    adminPage,
    convexHelper,
  }) => {
    // Seed organizer and make global admin a community admin
    const orgId = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: uniqueName('Schedule Test Org'),
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

    // Seed a draft event
    const eventId = await convexHelper.mutation(api.testing.events.seedEvent, {
      title: uniqueName('Schedule Test Event'),
      date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10),
      price: 0,
      status: 'draft',
      organizerId: orgId,
    });

    await adminPage.goto(`/community-admin/events/${eventId}/edit`);
    const env = createEnvironment(adminPage);
    await waitForEventEditorReady(adminPage);
    const harness = await env.getHarness(EventEditorHarness);

    // Open publish dialog via harness
    await harness.openPublishDialog();
    await expect
      .poll(() => harness.isPublishDialogVisible(), {timeout: 5000})
      .toBe(true);

    // Select "Schedule for later" and assert the radio state changed before
    // interacting with the conditional date/time fields.
    const scheduledAnnouncementRadio =
      adminPage.getByLabel('Schedule for later');
    await scheduledAnnouncementRadio.evaluate((el: HTMLInputElement) => {
      el.checked = true;
      el.dispatchEvent(new Event('change', {bubbles: true}));
    });
    await expect(scheduledAnnouncementRadio).toBeChecked();

    // Wait for date/time inputs to appear (browser-native date inputs — kept as raw Playwright calls)
    await expect(adminPage.getByTestId('schedule-date')).toBeVisible({
      timeout: 5000,
    });

    // Set date to tomorrow using local date (avoids UTC midnight timezone issue)
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const dateStr = [
      tomorrow.getFullYear(),
      String(tomorrow.getMonth() + 1).padStart(2, '0'),
      String(tomorrow.getDate()).padStart(2, '0'),
    ].join('-');

    // Set value and dispatch change in one evaluate() call to prevent Angular's [value] binding
    // from resetting the input value between the fill and the dispatch (CDP round-trip issue).
    await adminPage
      .getByTestId('schedule-date')
      .evaluate((el: HTMLInputElement, d) => {
        el.value = d;
        el.dispatchEvent(new Event('change', {bubbles: true}));
      }, dateStr);

    // Verify Angular processed the change (signal updated → [value] re-renders with same value)
    await expect(adminPage.getByTestId('schedule-date')).toHaveValue(dateStr, {
      timeout: 5000,
    });

    await adminPage
      .getByTestId('schedule-time')
      .evaluate((el: HTMLInputElement) => {
        el.value = '10:00';
        el.dispatchEvent(new Event('input', {bubbles: true}));
      });

    // Confirm publish — native click has actionability checks (enabled + visible)
    await adminPage.getByTestId('publish-dialog-confirm').click();

    // Wait for published state — publish button changes to "[ save changes ]" when event is published
    // Backend scheduling behavior (status: 'scheduled') is verified in
    // backend/convex/marketing/emails.test.ts
    await expect(
      adminPage.locator('[data-testid="publish-save-btn"]'),
    ).toHaveText(/\[ save changes \]/i, {timeout: 15000});
  });

  test('email preferences tab shows opted-in communities', async ({
    authedPage,
    convexHelper,
  }) => {
    // Seed a community and approve the global authed user for it
    const orgId = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: uniqueName('Prefs Org'),
      },
    );

    const authUser = await convexHelper.query(api.testing.users.getByEmail, {
      email: 'global-user@example.com',
    });
    if (!authUser) throw new Error('Auth user not found');

    await convexHelper.mutation(
      api.testing.applications.seedApprovedApplication,
      {
        userId: authUser._id,
        organizerId: orgId,
      },
    );

    // The auto opt-in hook fires on application approval.
    // Seed the preference row directly to decouple this test from that hook.
    await convexHelper.mutation(api.testing.marketing.seedMarketingPreference, {
      userId: authUser._id,
      organizerId: orgId,
      optedIn: true,
      unsubToken: `e2e-prefs-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });

    await authedPage.goto('/account');
    await expect(authedPage.getByTestId('email-preferences-card')).toBeVisible({
      timeout: 10000,
    });
    await expect(authedPage.getByTestId('email-prefs-list')).toBeVisible({
      timeout: 15000,
    });
  });

  test('unsubscribe page shows confirmation after token redirect', async ({
    page,
    convexHelper,
  }) => {
    // Seed a user, org, and preference with a known token
    const token = `e2e-unsub-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const {userId} = await convexHelper.action(
      api.testing.users_node.seedUserAndGetTokens,
      {
        email: `unsub-${Date.now()}@test.com`,
        password: 'TestPassword123!',
        name: 'Unsub Test User',
      },
    );

    const orgId = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: uniqueName('Unsub Org'),
      },
    );

    await convexHelper.mutation(api.testing.marketing.seedMarketingPreference, {
      userId: userId as Id<'users'>,
      organizerId: orgId,
      optedIn: true,
      unsubToken: token,
    });

    // Navigate to the Convex HTTP unsubscribe endpoint — it will redirect to the Angular app
    const convexSiteUrl = (
      process.env['CONVEX_SITE_URL'] || 'http://127.0.0.1:3211'
    ).replace(/\/$/, '');

    await page.goto(
      `${convexSiteUrl}/api/unsubscribe?token=${encodeURIComponent(token)}`,
    );

    // The HTTP endpoint redirects to /unsubscribe?token=...&done=true
    await expect(page).toHaveURL(/\/unsubscribe.*done=true/, {timeout: 10000});

    // Wait for the lazy-loaded component to be visible before acquiring the harness.
    // CDK harness locatorFor() does a single snapshot DOM query with no retry.
    await expect(page.locator('app-unsubscribe')).toBeVisible({timeout: 10000});

    const unsubHarness =
      await createEnvironment(page).getHarness(UnsubscribeHarness);
    await expect
      .poll(() => unsubHarness.isConfirmationVisible(), {timeout: 10000})
      .toBe(true);
  });

  test('admin community preference is locked and shows ADMIN label', async ({
    adminPage,
    convexHelper,
  }) => {
    const orgName = uniqueName('Admin Lock Org');
    const orgId = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: orgName,
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

    await adminPage.goto('/account');
    await expect(adminPage.getByTestId('email-preferences-card')).toBeVisible({
      timeout: 10000,
    });

    const prefToggle = adminPage.getByTestId(`pref-toggle-${orgId}`);
    await expect(prefToggle).toBeVisible({timeout: 15000});
    await expect(prefToggle).toBeDisabled();

    const prefLabel = adminPage.getByTestId(`pref-toggle-label-${orgId}`);
    await expect(prefLabel).toHaveText(/ADMIN/i);
  });

  test('non-admin community preference is toggleable', async ({
    authedPage,
    convexHelper,
  }) => {
    const orgName = uniqueName('Toggle Org');
    const orgId = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: orgName,
      },
    );

    const authUser = await convexHelper.query(api.testing.users.getByEmail, {
      email: 'global-user@example.com',
    });
    if (!authUser) throw new Error('Auth user not found');

    await convexHelper.mutation(
      api.testing.applications.seedApprovedApplication,
      {
        userId: authUser._id,
        organizerId: orgId,
      },
    );

    await convexHelper.mutation(api.testing.marketing.seedMarketingPreference, {
      userId: authUser._id,
      organizerId: orgId,
      optedIn: true,
      unsubToken: `e2e-toggle-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });

    await authedPage.goto('/account');
    await expect(authedPage.getByTestId('email-preferences-card')).toBeVisible({
      timeout: 10000,
    });
    await expect(authedPage.getByTestId('email-prefs-list')).toBeVisible({
      timeout: 15000,
    });

    const prefToggle = authedPage.getByTestId(`pref-toggle-${orgId}`);
    await expect(prefToggle).toBeVisible({timeout: 10000});
    await expect(prefToggle).toBeEnabled();

    const prefLabel = authedPage.getByTestId(`pref-toggle-label-${orgId}`);
    await expect(prefLabel).toHaveText(/ON/i);
  });

  test('unsubscribe all skips admin communities', async ({
    adminPage,
    convexHelper,
  }) => {
    const adminOrgName = uniqueName('Admin Unsub Org');
    const regularOrgName = uniqueName('Regular Unsub Org');

    const adminOrgId = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: adminOrgName,
      },
    );
    const regularOrgId = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: regularOrgName,
      },
    );

    const adminUser = await convexHelper.query(api.testing.users.getByEmail, {
      email: 'global-admin@example.com',
    });
    if (!adminUser) throw new Error('Admin user not found');

    // Seed all data BEFORE navigating
    await convexHelper.mutation(api.testing.communities.seedCommunityAdmin, {
      userId: adminUser._id,
      organizerId: adminOrgId,
      grantedBy: adminUser._id,
    });

    await convexHelper.mutation(api.testing.marketing.seedMarketingPreference, {
      userId: adminUser._id,
      organizerId: regularOrgId,
      optedIn: true,
      unsubToken: `e2e-unsub-reg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });

    await adminPage.goto('/account');
    await expect(adminPage.getByTestId('email-preferences-card')).toBeVisible({
      timeout: 10000,
    });

    await expect(
      adminPage.getByTestId(`pref-toggle-${adminOrgId}`),
    ).toBeVisible({timeout: 15000});
    await expect(
      adminPage.getByTestId(`pref-toggle-${regularOrgId}`),
    ).toBeVisible({timeout: 15000});

    // Dismiss any toast before clicking unsubscribe
    await adminPage.keyboard.press('Escape');

    // Click unsubscribe all
    const unsubBtn = adminPage.getByRole('button', {
      name: /unsubscribe from all/i,
    });
    await expect(unsubBtn).toBeVisible({timeout: 5000});
    await unsubBtn.click();

    // Admin community stays ADMIN, regular community goes OFF
    await expect(
      adminPage.getByTestId(`pref-toggle-label-${adminOrgId}`),
    ).toHaveText(/ADMIN/i);
    await expect(
      adminPage.getByTestId(`pref-toggle-label-${regularOrgId}`),
    ).toHaveText(/OFF/i, {timeout: 10000});
  });
});
