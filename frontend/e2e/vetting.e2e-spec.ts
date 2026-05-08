import {
  test,
  expect,
  uniqueName,
  createEnvironment,
} from './helpers/test-setup';
import {
  signInUser,
  waitForAuthenticatedDashboard,
} from './test-utils/auth-helpers';
import {api} from '@convex/_generated/api';
import {Id} from '@convex/_generated/dataModel';
import {VettingComponentHarness} from '../src/app/features/vetting/pages/vetting/vetting.component.harness';
import {DashboardComponentHarness} from '../src/app/features/dashboard/pages/dashboard/dashboard.component.harness';
import type {Page} from '@playwright/test';

/**
 * Helper to seed a community with vetting questions for vetting tests.
 */
type ConvexHelper = Parameters<Parameters<typeof test>[2]>[0]['convexHelper'];

async function seedCommunityWithVettingQuestions(convexHelper: ConvexHelper) {
  const orgId = await convexHelper.mutation(
    api.testing.communities.seedOrganizer,
    {
      name: uniqueName('Vetting Org'),
      codeOfConduct:
        'Be excellent to each other. Consent is mandatory and harassment is not tolerated.',
      vettingQuestions: [
        {
          id: 'referral',
          question: 'Who referred you or how did you find us?',
          type: 'text' as const,
          required: true,
        },
        {
          id: 'whyJoin',
          question: 'Why do you want to join?',
          type: 'long_text' as const,
          required: true,
        },
        {
          id: 'socials',
          question: 'Socials / Links (Optional)',
          type: 'text' as const,
          required: false,
        },
      ],
    },
  );
  return orgId;
}

/**
 * Gets the VettingComponentHarness after waiting for the component to be visible.
 * In zoneless Angular, getHarness() doesn't wait for elements to render, so we need
 * to explicitly wait for the host element to be visible first.
 */
async function getVettingHarness(page: Page): Promise<VettingComponentHarness> {
  await page.locator('app-vetting').waitFor({state: 'visible', timeout: 10000});
  const env = createEnvironment(page);
  return env.getHarness(VettingComponentHarness);
}

/**
 * E2E Tests for CUJ 4: Vetting Application Flow
 * Uses VettingComponentHarness for stable, maintainable selectors.
 */
test.describe('Vetting Application Flow', () => {
  // Read-only: does not submit or mutate authedPage user state
  test('should display vetting form for authenticated unvetted user', async ({
    page,
    convexHelper,
  }) => {
    // Create a fresh user to avoid conflicts with other tests
    const testEmail = `vetting-display-${Date.now()}@example.com`;
    const testPassword = 'VettingDisplayPass123!';

    await convexHelper.action(api.testing.users_node.seedUserAndGetTokens, {
      email: testEmail,
      password: testPassword,
      name: 'Vetting Display Test User',
    });

    await signInUser(page, testEmail, testPassword);

    const orgId = await seedCommunityWithVettingQuestions(convexHelper);
    await page.goto('/vetting/' + orgId);

    // Wait for navigation to complete and verify we're on the vetting page
    await expect(page).toHaveURL(`/vetting/${orgId}`, {timeout: 10000});

    // Get harness - helper waits for component to be visible
    await getVettingHarness(page);

    // Verify field labels are correct (using legend elements as per component template)
    await expect(
      page.locator('legend', {
        hasText: 'Who referred you or how did you find us?',
      }),
    ).toBeVisible();
    await expect(
      page.locator('legend', {hasText: 'Why do you want to join?'}),
    ).toBeVisible();
    await expect(
      page.locator('legend', {hasText: 'Socials / Links (Optional)'}),
    ).toBeVisible();
  });

  // Read-only: creates fresh user to avoid mutating shared fixture state
  test('should require agreement to Code of Conduct', async ({
    page,
    convexHelper,
  }) => {
    const testEmail = `vetting-coc-${Date.now()}@example.com`;
    const testPassword = 'VettingCoCPass123!';

    await convexHelper.action(api.testing.users_node.seedUserAndGetTokens, {
      email: testEmail,
      password: testPassword,
      name: 'Vetting CoC Test User',
    });

    await signInUser(page, testEmail, testPassword);

    const orgId = await seedCommunityWithVettingQuestions(convexHelper);
    await page.goto('/vetting/' + orgId);

    // Wait for navigation to complete
    await expect(page).toHaveURL(`/vetting/${orgId}`, {timeout: 10000});

    // Get harness - helper waits for component to be visible
    const harness = await getVettingHarness(page);

    // Verify the Code of Conduct agreement checkbox and button are visible
    await expect
      .poll(() => harness.isConductAgreementVisible(), {timeout: 10000})
      .toBe(true);
    await expect
      .poll(() => harness.isCodeOfConductButtonVisible(), {timeout: 10000})
      .toBe(true);
  });

  test('should prevent duplicate application submission', async ({
    page,
    convexHelper,
  }) => {
    const orgId = await seedCommunityWithVettingQuestions(convexHelper);
    const testEmail = `vetting-duplicate-${Date.now()}@example.com`;
    const testPassword = 'VettingDuplicatePassword123!';

    await convexHelper.action(api.testing.users_node.seedUserAndGetTokens, {
      email: testEmail,
      password: testPassword,
      name: 'Vetting Duplicate Test User',
    });

    await signInUser(page, testEmail, testPassword);
    await page.goto('/vetting/' + orgId);

    // Get harness - helper waits for component to be visible
    const harness = await getVettingHarness(page);
    // Vetting questions are loaded from Convex — wait for the first input to be rendered
    await expect(page.locator('input[id="referral"]')).toBeVisible({
      timeout: 15000,
    });

    // Fill and submit FIRST application using harness methods
    await harness.setReferral('First Referral');
    await harness.setWhyJoin('First Why Join (20+ chars) Reason here.');
    await harness.toggleConduct();
    await harness.submit();

    // After submission, user is redirected to home
    await waitForAuthenticatedDashboard(page);

    // Try to access vetting page again — should show pending state, not the form
    await page.goto('/vetting/' + orgId);
    const harness2 = await getVettingHarness(page);

    // The vetting page shows pending state with data-testid="vetting-pending-state"
    await expect
      .poll(() => harness2.isPendingStateVisible(), {timeout: 15000})
      .toBe(true);
    await expect(page).toHaveURL(/\/vetting/, {timeout: 5000});
  });

  test('should show pending status immediately after submitting vetting form', async ({
    page,
    convexHelper,
  }) => {
    const orgId = await seedCommunityWithVettingQuestions(convexHelper);
    const testEmail = `vetting-flow-${Date.now()}@example.com`;
    const testPassword = 'VettingTestPassword123!';

    await convexHelper.action(api.testing.users_node.seedUserAndGetTokens, {
      email: testEmail,
      password: testPassword,
      name: 'Vetting Flow Test User',
    });

    await signInUser(page, testEmail, testPassword);
    await page.goto('/vetting/' + orgId);
    await expect(page).toHaveURL(new RegExp(`/vetting/${orgId}`), {
      timeout: 10000,
    });

    // Get harness - helper waits for component to be visible
    const harness = await getVettingHarness(page);
    // Vetting questions are loaded from Convex — wait for the first input to be rendered
    await expect(page.locator('input[id="referral"]')).toBeVisible({
      timeout: 15000,
    });

    // Fill form using harness methods
    await harness.setReferral('My friend Alice referred me');
    await harness.setWhyJoin(
      'I am passionate about this community and want to contribute to its growth and success!',
    );
    await harness.toggleConduct();

    // Assert submit is enabled before clicking
    await expect
      .poll(() => harness.isSubmitDisabled(), {timeout: 5000})
      .toBe(false);
    await harness.submit();

    // After submission, user is redirected to home
    await waitForAuthenticatedDashboard(page);

    // On home page, pending status appears in the community cell
    await page
      .locator('app-dashboard')
      .waitFor({state: 'visible', timeout: 10000});
    const dashboardEnv = createEnvironment(page);
    const dashboardHarness = await dashboardEnv.getHarness(
      DashboardComponentHarness,
    );
    await expect
      .poll(() => dashboardHarness.isApplicationStatusVisible(), {
        timeout: 10000,
      })
      .toBe(true);
  });

  test('should not flash "Not Applied" for user with pending application', async ({
    page,
    convexHelper,
  }) => {
    const testEmail = `no-flash-${Date.now()}@example.com`;
    const testPassword = 'NoFlashTestPassword123!';

    const tokens = await convexHelper.action(
      api.testing.users_node.seedUserAndGetTokens,
      {
        email: testEmail,
        password: testPassword,
        name: 'No Flash Test User',
      },
    );

    // Get a community to create the application for
    const orgId = await seedCommunityWithVettingQuestions(convexHelper);

    await convexHelper.mutation(api.testing.applications.seedApplication, {
      userId: tokens.userId as Id<'users'>,
      organizerId: orgId,
      status: 'pending',
      answers: {
        referral: 'Test referral',
        whyJoin: 'Test reason for joining the community',
      },
    });

    // signInUser navigates to / and calls waitForAuthenticatedDashboard.
    await signInUser(page, testEmail, testPassword);

    // Home page shows pending status in community cell - look for the Pending badge
    const pendingBadge = page
      .locator('[data-testid="dashboard-community-cell"]')
      .getByText('Pending');
    await expect(pendingBadge).toBeVisible({timeout: 15000});

    let sawNotApplied = false;
    await expect
      .poll(
        async () => {
          // Check for "Pending" text in the community cells
          const cells = await page
            .locator('[data-testid="dashboard-community-cell"]')
            .all();
          for (const cell of cells) {
            const text = ((await cell.textContent()) || '').toLowerCase();
            if (text.includes('not applied')) sawNotApplied = true;
            if (text.includes('pending')) return 'pending';
          }
          return 'unknown';
        },
        {timeout: 15000, intervals: [500, 1000]},
      )
      .toBe('pending');
    expect(sawNotApplied).toBe(false);
  });
});
