import {test, expect, uniqueName} from './helpers/test-setup';
import type {Page, Locator} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {api} from '@convex/_generated/api';

type ContrastViolation = {route: string; violationIds: string[]};

/**
 * Navigate to `route`, wait for `readyLocator`, then run an axe color-contrast
 * scan and return a violation summary (or null if clean). When `theme` is set,
 * assert `<html data-theme>` matches after every navigation — this catches
 * any route that resets the theme and guarantees the scan ran in the intended
 * mode. The inline boot script in index.html applies `.dark` before first
 * paint from `localStorage.theme`, so `addInitScript` before the first `goto`
 * is sufficient; the per-route assertion guards against later regressions.
 */
async function scanColorContrast(
  page: Page,
  route: string,
  readyLocator: Locator,
  options: {theme?: 'dark'; timeout?: number} = {},
): Promise<ContrastViolation | null> {
  await page.goto(route);
  await page.waitForLoadState('domcontentloaded');
  if (options.theme) {
    await expect(page.locator('html')).toHaveAttribute(
      'data-theme',
      options.theme,
    );
  }
  await expect(readyLocator).toBeVisible({timeout: options.timeout ?? 15000});
  const scan = await new AxeBuilder({page})
    .withRules(['color-contrast'])
    .analyze();
  const critical = scan.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
  if (critical.length > 0) {
    console.log(
      `Color-contrast violations (${route}):`,
      JSON.stringify(critical, null, 2),
    );
    return {route, violationIds: critical.map((v) => v.id)};
  }
  return null;
}

test.describe('Accessibility Audit', () => {
  test('should pass axe audit on Landing Page', async ({page}) => {
    await page.goto('/');

    // Wait for content to load
    await expect(page.getByRole('heading', {level: 1})).toBeVisible({
      timeout: 60000,
    });

    const accessibilityScanResults = await new AxeBuilder({page})
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .include('main')
      .analyze();

    // Filter for critical/serious violations
    const criticalViolations = accessibilityScanResults.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );

    // Log critical violations if any
    if (criticalViolations.length > 0) {
      console.log(
        'Critical Axe Violations:',
        JSON.stringify(criticalViolations, null, 2),
      );
    }

    expect(criticalViolations).toEqual([]);
  });

  test('should pass axe audit on Event Details', async ({
    authedPage,
    convexHelper,
  }) => {
    const page = authedPage;
    // Seed an event to visit
    const eventTitle = uniqueName('A11y Test Event');
    const a11yOrgId = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: uniqueName('A11y Test Org'),
        isPlatformOrganizer: true,
      },
    );
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
    await expect(page.getByRole('heading', {name: eventTitle})).toBeVisible({
      timeout: 60000,
    });

    const accessibilityScanResults = await new AxeBuilder({page})
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

  test('should pass color-contrast audit on core public pages', async ({
    page,
  }) => {
    const publicRoutes = ['/', '/login', '/support', '/terms', '/privacy'];
    const violations: ContrastViolation[] = [];

    for (const route of publicRoutes) {
      const v = await scanColorContrast(page, route, page.locator('body'), {
        timeout: 60000,
      });
      if (v) violations.push(v);
    }

    expect(violations).toEqual([]);
  });

  test('should pass color-contrast audit on authenticated user routes', async ({
    authedPage,
    convexHelper,
  }) => {
    const page = authedPage;
    const violations: ContrastViolation[] = [];

    // --- /dashboard ---
    const dashboardV = await scanColorContrast(
      page,
      '/dashboard',
      page.getByRole('heading', {level: 1}),
    );
    if (dashboardV) violations.push(dashboardV);

    // Seed an org with vetting questions and a published event for /events/:id and /vetting/:id
    const orgId = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
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
      },
    );
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
    const eventV = await scanColorContrast(
      page,
      `/events/${eventId}`,
      page.getByRole('heading', {name: eventTitle}),
    );
    if (eventV) violations.push(eventV);

    // --- /vetting/:id ---
    const vettingV = await scanColorContrast(
      page,
      `/vetting/${orgId}`,
      page.getByRole('heading', {level: 1}),
    );
    if (vettingV) violations.push(vettingV);

    expect(violations).toEqual([]);
  });

  test('should pass color-contrast audit on community admin routes', async ({
    adminPage,
    convexHelper,
  }) => {
    const page = adminPage;
    const violations: ContrastViolation[] = [];

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
    const eventsV = await scanColorContrast(
      page,
      '/community-admin/events',
      page.getByRole('heading', {level: 1}),
    );
    if (eventsV) violations.push(eventsV);

    // --- /community-admin/settings (Stripe onboarding indicators) ---
    const settingsV = await scanColorContrast(
      page,
      '/community-admin/settings',
      page.getByRole('heading', {level: 1}),
    );
    if (settingsV) violations.push(settingsV);

    expect(violations).toEqual([]);
  });

  // Dark-mode color-contrast coverage. Previously Playwright defaulted to
  // colorScheme 'light' and these routes had zero dark-mode contrast coverage,
  // which let the dark-mode --destructive / --info text-on-tint failures
  // (BRA-263) go undetected. The addInitScript sets localStorage 'theme'='dark'
  // before first paint so the inline boot script in index.html applies `.dark`
  // before Angular renders. scanColorContrast re-asserts `data-theme="dark"`
  // after every navigation so a route that resets the theme is caught.
  test('should pass color-contrast audit on authenticated user routes (dark mode)', async ({
    authedPage,
    convexHelper,
  }) => {
    const page = authedPage;
    await page.addInitScript(() => {
      window.localStorage.setItem('theme', 'dark');
    });

    const violations: ContrastViolation[] = [];

    // --- /dashboard ---
    const dashboardV = await scanColorContrast(
      page,
      '/dashboard',
      page.getByRole('heading', {level: 1}),
      {theme: 'dark'},
    );
    if (dashboardV) violations.push(dashboardV);

    // Seed an org with vetting questions and a published event for /events/:id and /vetting/:id
    const orgId = await convexHelper.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: uniqueName('A11y Dark Contrast Org'),
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
      },
    );
    const eventTitle = uniqueName('A11y Dark Contrast Event');
    const eventId = await convexHelper.mutation(api.testing.events.seedEvent, {
      title: eventTitle,
      date: '2030-06-01',
      price: 1500,
      totalTickets: 50,
      status: 'published',
      visibility: 'public',
      organizerId: orgId,
    });

    // --- /events/:id ---
    const eventV = await scanColorContrast(
      page,
      `/events/${eventId}`,
      page.getByRole('heading', {name: eventTitle}),
      {theme: 'dark'},
    );
    if (eventV) violations.push(eventV);

    // --- /vetting/:id ---
    const vettingV = await scanColorContrast(
      page,
      `/vetting/${orgId}`,
      page.getByRole('heading', {level: 1}),
      {theme: 'dark'},
    );
    if (vettingV) violations.push(vettingV);

    expect(violations).toEqual([]);
  });

  test('should pass color-contrast audit on community admin routes (dark mode)', async ({
    adminPage,
    convexHelper,
  }) => {
    const page = adminPage;
    await page.addInitScript(() => {
      window.localStorage.setItem('theme', 'dark');
    });

    // Seed an organizer so admin event list has content.
    await convexHelper.mutation(api.testing.communities.seedOrganizer, {
      name: uniqueName('A11y Dark Admin Org'),
    });

    const violations: ContrastViolation[] = [];

    // --- /community-admin/events ---
    const eventsV = await scanColorContrast(
      page,
      '/community-admin/events',
      page.getByRole('heading', {level: 1}),
      {theme: 'dark'},
    );
    if (eventsV) violations.push(eventsV);

    // --- /community-admin/settings ---
    const settingsV = await scanColorContrast(
      page,
      '/community-admin/settings',
      page.getByRole('heading', {level: 1}),
      {theme: 'dark'},
    );
    if (settingsV) violations.push(settingsV);

    expect(violations).toEqual([]);
  });

  test('should show visible keyboard focus indicators on interactive controls', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');

    const emailInput = page.locator('#login-email');
    await expect(emailInput).toBeVisible({timeout: 10000});

    // Tab through the page until focus reaches the email input, verifying
    // keyboard reachability (WCAG 2.4.3). Using expect.poll avoids the flake
    // risk of a fixed-iteration loop on slow CI.
    await expect
      .poll(
        async () => {
          await page.keyboard.press('Tab');
          return emailInput.evaluate((el) => document.activeElement === el);
        },
        {timeout: 10000, intervals: [100]},
      )
      .toBe(true);

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
