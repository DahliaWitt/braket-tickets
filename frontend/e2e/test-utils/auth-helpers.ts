/**
 * E2E Test Authentication Helpers for Better Auth
 *
 * These utilities replace the old seedUserAndGetTokens functions,
 * providing authentication via Better Auth's HTTP API instead of
 * deprecated Convex auth actions.
 */

import {Page, expect} from '@playwright/test';
import {createEnvironment} from '@ngx-playwright/test';
import {retryWithDelays} from '../helpers/async-control';
import {DashboardComponentHarness} from '../../src/app/features/dashboard/pages/dashboard/dashboard.component.harness';

// Local backend URLs
// Port 3210: Convex functions API (.convex.cloud)
// Port 3211: HTTP routes including Better Auth (.convex.site)
const AUTH_URL = process.env.CONVEX_SITE_URL || 'http://127.0.0.1:3211';
const AUTH_RETRY_DELAYS_MS = [0, 250, 750, 1500, 3000] as const;

/**
 * Signs in an existing user via Better Auth HTTP API.
 *
 * @param page - Playwright page instance
 * @param email - User's email
 * @param password - User's password
 * @returns Promise that resolves when user is signed in
 */
export async function signInUser(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  let lastError = 'Unknown sign-in failure';

  await retryWithDelays({
    delaysMs: AUTH_RETRY_DELAYS_MS,
    run: async () => {
      await page.context().clearCookies();
      await page.evaluate(() => localStorage.clear()).catch(() => undefined);

      const response = await page.request.post(
        `${AUTH_URL}/api/auth/sign-in/email`,
        {
          data: {
            email,
            password,
          },
        },
      );

      if (!response.ok()) {
        lastError = await response.text();
        throw new Error(`Sign in failed: ${response.status()} ${lastError}`);
      }

      // Navigate to trigger session cookie usage
      await page.goto('/', {waitUntil: 'domcontentloaded'});
      await ensureAuthenticatedSession(page);
    },
    shouldRetry: (_error, attemptIndex) =>
      attemptIndex < AUTH_RETRY_DELAYS_MS.length - 1,
  }).catch((error: unknown) => {
    throw new Error(
      `signInUser failed for ${email} after ${AUTH_RETRY_DELAYS_MS.length} attempts: ${
        error instanceof Error ? error.message : lastError
      }`,
    );
  });
}

/**
 * Signs out the current user by clearing session cookies.
 *
 * @param page - Playwright page instance
 * @returns Promise that resolves when user is signed out
 */
export async function signOutUser(page: Page): Promise<void> {
  await page.request.post(`${AUTH_URL}/api/auth/sign-out`, {
    data: {},
  });

  // Clear all cookies
  await page.context().clearCookies();
}

async function ensureAuthenticatedSession(page: Page): Promise<void> {
  await page.goto('/', {waitUntil: 'domcontentloaded'});
  if (page.url().includes('/login')) {
    throw new Error('Session was not persisted; redirected back to /login');
  }

  await waitForAuthenticatedDashboard(page);
}

export async function waitForAuthenticatedDashboard(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          // Primary: dashboard component mounted (authenticated route matched)
          const dashboardEnv = createEnvironment(page);
          await dashboardEnv.getHarness(DashboardComponentHarness);
          return 'ready';
        } catch {
          // Fallback: authenticated nav rendered but dashboard route hasn't matched yet
          // (race between session init and Angular route matching on unified home route)
          const logoutBtn = page.getByRole('button', {name: 'LOGOUT'});
          if (await logoutBtn.isVisible().catch(() => false)) {
            return 'ready';
          }
          return null;
        }
      },
      {timeout: 30_000},
    )
    .toBe('ready');
}
