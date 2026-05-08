import { test, expect, uniqueName } from './helpers/test-setup';
import AxeBuilder from '@axe-core/playwright';
import { api } from '@convex/_generated/api';

test.describe('Accessibility Audit', () => {
  test('should pass axe audit on Landing Page', async ({ page }) => {
    await page.goto('/');

    // Wait for content to load
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 60000 });

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .include('main')
      .analyze();

    // Filter for critical/serious violations
    const criticalViolations = accessibilityScanResults.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );

    // Log critical violations if any
    if (criticalViolations.length > 0) {
      console.log('Critical Axe Violations:', JSON.stringify(criticalViolations, null, 2));
    }

    expect(criticalViolations).toEqual([]);
  });

  test('should pass axe audit on Event Details', async ({ authedPage, convexHelper }) => {
    const page = authedPage;
    // Seed an event to visit
    const eventTitle = uniqueName('A11y Test Event');
    const a11yOrgId = await convexHelper.mutation(api.testing.communities.seedOrganizer, {
      name: uniqueName('A11y Test Org'),
      isPlatformOrganizer: true,
    });
    const eventId = await convexHelper.mutation(api.testing.events.seedEvent, {
      title: eventTitle,
      date: '2030-01-01',
      price: 1000,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId: a11yOrgId,
    });

    await page.goto(`/events/${eventId}`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('heading', { name: eventTitle })).toBeVisible({
      timeout: 60000,
    });

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    const criticalViolations = accessibilityScanResults.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );

    if (criticalViolations.length > 0) {
      console.log(
        'Critical Axe Violations (Event Details):',
        JSON.stringify(criticalViolations, null, 2),
      );
    }

    expect(criticalViolations).toEqual([]);
  });

  test('should pass color-contrast audit on core public pages', async ({ page }) => {
    const publicRoutes = ['/', '/login', '/support', '/terms', '/privacy'];
    const violationsByRoute: { route: string; violationIds: string[] }[] = [];

    for (const route of publicRoutes) {
      await page.goto(route);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('body')).toBeVisible({ timeout: 60000 });

      const scan = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
      const criticalViolations = scan.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
      );

      if (criticalViolations.length > 0) {
        violationsByRoute.push({
          route,
          violationIds: criticalViolations.map((v) => v.id),
        });
      }
    }

    expect(violationsByRoute).toEqual([]);
  });

  test('should pass color-contrast audit on authenticated user routes', async ({
    authedPage,
    convexHelper,
  }) => {
    const page = authedPage;
    const violationsByRoute: { route: string; violationIds: string[] }[] = [];

    // --- /dashboard ---
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });

    const dashboardScan = await new AxeBuilder({ page })
      .withRules(['color-contrast'])
      .analyze();
    const dashboardViolations = dashboardScan.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    if (dashboardViolations.length > 0) {
      console.log('Dashboard contrast violations:', JSON.stringify(dashboardViolations, null, 2));
      violationsByRoute.push({ route: '/dashboard', violationIds: dashboardViolations.map((v) => v.id) });
    }

    // Seed an org with vetting questions and a published event for /events/:id and /vetting/:id
    const orgId = await convexHelper.mutation(api.testing.communities.seedOrganizer, {
      name: uniqueName('A11y Contrast Org'),
      isPlatformOrganizer: true,
      isPublicDirectory: true,
      vettingQuestions: [
        {
          id: 'q1',
          question: 'How did you hear about us?',
          type: 'text' as const,
          required: true,
        },
      ],
    });
    const eventTitle = uniqueName('A11y Contrast Event');
    const eventId = await convexHelper.mutation(api.testing.events.seedEvent, {
      title: eventTitle,
      date: '2030-06-01',
      price: 1500,
      totalTickets: 50,
      status: 'published',
      visibility: 'public',
      organizerId: orgId,
    });

    // --- /events/:id (event with vetting-required warning banner) ---
    await page.goto(`/events/${eventId}`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('heading', { name: eventTitle })).toBeVisible({ timeout: 15000 });

    const eventScan = await new AxeBuilder({ page })
      .withRules(['color-contrast'])
      .analyze();
    const eventViolations = eventScan.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    if (eventViolations.length > 0) {
      console.log('Event details contrast violations:', JSON.stringify(eventViolations, null, 2));
      violationsByRoute.push({ route: `/events/${eventId}`, violationIds: eventViolations.map((v) => v.id) });
    }

    // --- /vetting/:id ---
    await page.goto(`/vetting/${orgId}`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });

    const vettingScan = await new AxeBuilder({ page })
      .withRules(['color-contrast'])
      .analyze();
    const vettingViolations = vettingScan.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    if (vettingViolations.length > 0) {
      console.log('Vetting page contrast violations:', JSON.stringify(vettingViolations, null, 2));
      violationsByRoute.push({ route: `/vetting/${orgId}`, violationIds: vettingViolations.map((v) => v.id) });
    }

    expect(violationsByRoute).toEqual([]);
  });

  test('should pass color-contrast audit on community admin routes', async ({
    adminPage,
    convexHelper,
  }) => {
    const page = adminPage;
    const violationsByRoute: { route: string; violationIds: string[] }[] = [];

    // Seed an organizer so admin event list has content.
    // Note: seedCommunityAdmin is NOT needed here. The root admin user
    // (global-admin@example.com, roles: ['root_admin']) bypasses the community_admins
    // junction table — listMyCommunities returns ALL organizers for root admins
    // (see backend/convex/communities/admins.ts: isRootAdmin bypass). This matches the
    // pattern used in event-lifecycle.e2e-spec.ts and other admin E2E tests.
    await convexHelper.mutation(api.testing.communities.seedOrganizer, {
      name: uniqueName('A11y Admin Org'),
    });

    // --- /community-admin/events ---
    await page.goto('/community-admin/events');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });

    const eventsScan = await new AxeBuilder({ page })
      .withRules(['color-contrast'])
      .analyze();
    const eventsViolations = eventsScan.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    if (eventsViolations.length > 0) {
      console.log('Admin events contrast violations:', JSON.stringify(eventsViolations, null, 2));
      violationsByRoute.push({
        route: '/community-admin/events',
        violationIds: eventsViolations.map((v) => v.id),
      });
    }

    // --- /community-admin/settings (Stripe onboarding indicators) ---
    await page.goto('/community-admin/settings');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });

    const settingsScan = await new AxeBuilder({ page })
      .withRules(['color-contrast'])
      .analyze();
    const settingsViolations = settingsScan.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    if (settingsViolations.length > 0) {
      console.log('Admin settings contrast violations:', JSON.stringify(settingsViolations, null, 2));
      violationsByRoute.push({
        route: '/community-admin/settings',
        violationIds: settingsViolations.map((v) => v.id),
      });
    }

    expect(violationsByRoute).toEqual([]);
  });

  test('should show visible keyboard focus indicators on interactive controls', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');

    const emailInput = page.locator('#login-email');
    await expect(emailInput).toBeVisible({ timeout: 10000 });

    // Tab through the page until focus reaches the email input, verifying
    // keyboard reachability (WCAG 2.4.3). Using expect.poll avoids the flake
    // risk of a fixed-iteration loop on slow CI.
    await expect.poll(async () => {
      await page.keyboard.press('Tab');
      return emailInput.evaluate((el) => document.activeElement === el);
    }, { timeout: 10000, intervals: [100] }).toBe(true);

    const focusStyle = await emailInput.evaluate((element) => {
      const style = globalThis.getComputedStyle(element);
      return {
        outlineWidth: style.outlineWidth,
        boxShadow: style.boxShadow,
      };
    });

    const outlinePx = Number.parseFloat(focusStyle.outlineWidth || '0');
    expect(outlinePx > 0 || focusStyle.boxShadow !== 'none').toBe(true);
  });
});
