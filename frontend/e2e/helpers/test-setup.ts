import fs from 'fs';
import path from 'path';

import {
  test as base,
  type APIResponse,
  type Browser,
  type Page,
  type Route,
} from '@playwright/test';
import {createEnvironment} from '@ngx-playwright/test';
import {ConvexTestingHelper} from 'convex-helpers/testing';
import {LandingPage} from '../page-objects/landing.page';
import {LoginPage} from '../page-objects/login.page';

export type ConvexHelper = ConvexTestingHelper;

/** Strip browser CSS `%c` formatting from console.log text.
 *  Browser logs use `console.log('%cText', 'css...')` for DevTools coloring.
 *  Playwright's `msg.text()` concatenates all args, producing garbage like:
 *  `%c[INFO]%c message color: #4a9eff; font-weight: bold color: inherit`
 *  This strips `%c` markers and trailing CSS property strings. */
function stripBrowserCss(text: string): string {
  if (!text.includes('%c')) return text;
  return text
    .replace(/%c/g, '')
    .replace(
      /\s*(color|font-weight|font-size|background|padding|border-radius|margin):\s*[^;]+;?\s*/g,
      '',
    )
    .trim();
}

const AUTH_STATE_DIR = path.join(__dirname, '../../playwright/.auth');
const USER_AUTH_STATE = path.join(AUTH_STATE_DIR, 'user.json');
const ADMIN_AUTH_STATE = path.join(AUTH_STATE_DIR, 'admin.json');
const TRANSIENT_E2E_RETRY_DELAYS_MS = [0, 250, 750, 1500, 3000] as const;

/**
 * Generates a unique name for test data to avoid conflicts in parallel runs.
 */
export function uniqueName(base: string): string {
  const random = Math.floor(Math.random() * 1_000_000);
  return `${base} ${Date.now()}-${random}`;
}

/**
 * Patches page.goto() to default to waitUntil: 'domcontentloaded'.
 *
 * Convex keeps a WebSocket connection alive, which prevents the browser 'load'
 * event from ever firing. Playwright's default waitUntil for goto() is 'load',
 * so any bare page.goto('/path') will hang until timeout on Convex-connected pages.
 *
 * Also absorbs "interrupted by another navigation" errors from WebKit. Angular's
 * router can fire a client-side redirect (e.g. stripping a consumed query param)
 * before domcontentloaded resolves. Chromium completes the initial navigation
 * first; WebKit does not. The subsequent test assertions verify page state, so
 * swallowing the interruption is safe.
 */
export function patchGotoDefault(page: Page): void {
  const originalGoto = page.goto.bind(page);
  page.goto = async (url: string, options?: Parameters<Page['goto']>[1]) => {
    try {
      return await originalGoto(url, {
        waitUntil: 'domcontentloaded',
        ...options,
      });
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.message.includes('interrupted by another navigation')
      ) {
        return null;
      }
      throw error;
    }
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isTransientE2eError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const normalizedMessage = message.toLowerCase();
  return (
    normalizedMessage.includes('timed out') ||
    normalizedMessage.includes('timeout') ||
    normalizedMessage.includes('503') ||
    normalizedMessage.includes('service unavailable') ||
    normalizedMessage.includes('failed to fetch') ||
    normalizedMessage.includes('network')
  );
}

async function fetchRouteWithRetry(route: Route): Promise<APIResponse> {
  for (
    let attemptIndex = 0;
    attemptIndex < TRANSIENT_E2E_RETRY_DELAYS_MS.length;
    attemptIndex += 1
  ) {
    const delayMs = TRANSIENT_E2E_RETRY_DELAYS_MS[attemptIndex];
    if (delayMs > 0) {
      await sleep(delayMs);
    }

    try {
      const response = await route.fetch();
      const isFinalAttempt =
        attemptIndex === TRANSIENT_E2E_RETRY_DELAYS_MS.length - 1;
      if (!isFinalAttempt && isTransientStatus(response.status())) {
        console.warn(
          `[setupCorsInterceptor] Retrying auth route after ${response.status()} (${attemptIndex + 1}/${TRANSIENT_E2E_RETRY_DELAYS_MS.length})`,
        );
        await response.dispose();
        continue;
      }
      return response;
    } catch (err: unknown) {
      const isFinalAttempt =
        attemptIndex === TRANSIENT_E2E_RETRY_DELAYS_MS.length - 1;
      if (isFinalAttempt || !isTransientE2eError(err)) {
        throw err;
      }
      console.warn(
        `[setupCorsInterceptor] Retrying auth route after network failure (${attemptIndex + 1}/${TRANSIENT_E2E_RETRY_DELAYS_MS.length})`,
      );
    }
  }

  throw new Error('[setupCorsInterceptor] Unreachable: retry loop exhausted');
}

async function retryConvexTestingCall<T>(run: () => Promise<T>): Promise<T> {
  for (
    let attemptIndex = 0;
    attemptIndex < TRANSIENT_E2E_RETRY_DELAYS_MS.length;
    attemptIndex += 1
  ) {
    const delayMs = TRANSIENT_E2E_RETRY_DELAYS_MS[attemptIndex];
    if (delayMs > 0) {
      await sleep(delayMs);
    }

    try {
      return await run();
    } catch (err: unknown) {
      const isFinalAttempt =
        attemptIndex === TRANSIENT_E2E_RETRY_DELAYS_MS.length - 1;
      if (isFinalAttempt || !isTransientE2eError(err)) {
        throw err;
      }
      console.warn(
        `[convexHelper] Retry ${attemptIndex + 1}/${TRANSIENT_E2E_RETRY_DELAYS_MS.length} after transient backend failure`,
      );
    }
  }

  throw new Error('[convexHelper] Unreachable: retry loop exhausted');
}

function assertAuthStateExists(storageStatePath: string, label: string): void {
  if (fs.existsSync(storageStatePath)) {
    return;
  }

  throw new Error(
    `Missing E2E auth storage state for ${label}: ${storageStatePath}. ` +
      'Run `pnpm test:e2e:serve` or `pnpm test:e2e` to regenerate it via frontend/e2e/global.setup.ts.',
  );
}

export async function createAuthenticatedPage(
  browser: Browser,
  storageStatePath: string,
  label: string,
): Promise<Page> {
  assertAuthStateExists(storageStatePath, label);

  const context = await browser.newContext({
    storageState: storageStatePath,
  });
  const page = await context.newPage();
  patchGotoDefault(page);
  await setupCorsInterceptor(page);
  return page;
}

/**
 * Custom Playwright test fixtures for authenticated pages.
 *
 * The `authedPage` fixture:
 * - Reuses the saved storage state generated by global.setup.ts for the global test user
 * - Provides a fully authenticated page ready for testing
 *
 * The `adminPage` fixture:
 * - Reuses the saved storage state generated by global.setup.ts for the global admin user
 * - Provides a page with admin privileges
 *
 * Usage:
 * ```typescript
 * import { test } from './helpers/test-setup';
 *
 * test('authenticated user can see home page', async ({ authedPage }) => {
 *   await authedPage.goto('/');
 *   await expect(authedPage.locator('h1')).toContainText('Home');
 * });
 * ```
 */
export const setupCorsInterceptor = async (page: Page) => {
  page.on('console', (msg) => {
    const type = msg.type();
    const text = stripBrowserCss(msg.text());
    if (
      type === 'error' ||
      type === 'warning' ||
      text.includes('[loginWithPassword]') ||
      text.includes('[syncUserToApp]') ||
      text.includes('[initSession]') ||
      text.includes('[authGuard]')
    ) {
      console.log(`[Browser ${type}] ${text}`);
    }
  });

  // Intercept auth requests to fix CORS issues in E2E environment
  // We use a regex to match the origin globally to support dynamic ports (4201, 4202, etc.)
  await page.route('**/api/auth/**', async (route) => {
    const request = route.request();

    if (request.isNavigationRequest()) {
      await route.continue();
      return;
    }

    const origin = request.headers()['origin'] || 'http://127.0.0.1:4201';

    if (request.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': origin,
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers':
            'Content-Type, Authorization, Better-Auth-Cookie',
          'access-control-allow-credentials': 'true',
        },
      });
      return;
    }

    try {
      const response = await fetchRouteWithRetry(route);
      const body = await response.body();
      const headers = {...response.headers()};
      headers['access-control-allow-origin'] = origin;
      headers['access-control-allow-credentials'] = 'true';

      await route.fulfill({
        status: response.status(),
        body,
        headers,
      });
    } catch {
      // If the page is closed during the fetch, just abort the route
      if (!page.isClosed()) {
        await route.abort();
      }
    }
  });
};

export const test = base.extend<{
  authedPage: Page;
  adminPage: Page;
  convexHelper: ConvexTestingHelper;
  /**
   * Landing page object for testing the landing page.
   * Provides harness-style API for E2E tests.
   */
  landingPage: LandingPage;
  /**
   * Login page object for testing auth flows.
   * Provides harness-style API for E2E tests.
   */
  loginPage: LoginPage;
}>({
  page: async ({page}, use) => {
    patchGotoDefault(page);
    await setupCorsInterceptor(page);
    await use(page);
  },

  /* eslint-disable no-empty-pattern -- Playwright fixtures require destructuring even when no fixtures are consumed. */
  convexHelper: async (
    {},
    use: (helper: ConvexTestingHelper) => Promise<void>,
  ) => {
    const t = new ConvexTestingHelper({
      backendUrl: process.env.CONVEX_URL || 'http://127.0.0.1:3210',
    });

    // Wrap Convex testing calls to auto-retry transient local backend errors.
    // The local backend's 1s function execution limit can be exceeded under load.
    const originalAction = t.action.bind(t);
    const originalMutation = t.mutation.bind(t);
    const originalQuery = t.query.bind(t);

    t.action = async (action: any, args?: any) => {
      return retryConvexTestingCall(() => originalAction(action, args));
    };
    t.mutation = async (mutation: any, args?: any) => {
      return retryConvexTestingCall(() => originalMutation(mutation, args));
    };
    t.query = async (query: any, args?: any) => {
      return retryConvexTestingCall(() => originalQuery(query, args));
    };

    await use(t);
    // Cleanup after test, BUT keep users because we reuse them
    // We NO LONGER clearAll here to allow parallel tests to run without wiping each other's data.
    // await t.mutation(api.testing.utilities.clearAll, { keepUsers: true });
    await t.close();
  },
  /* eslint-enable no-empty-pattern */

  authedPage: async ({browser}, use: (p: Page) => Promise<void>) => {
    const page = await createAuthenticatedPage(
      browser,
      USER_AUTH_STATE,
      'standard user',
    );
    try {
      await use(page);
    } finally {
      await page.context().close();
    }
  },

  adminPage: async ({browser}, use: (p: Page) => Promise<void>) => {
    const page = await createAuthenticatedPage(
      browser,
      ADMIN_AUTH_STATE,
      'admin user',
    );
    try {
      await use(page);
    } finally {
      await page.context().close();
    }
  },

  /**
   * Landing page object fixture.
   * Automatically navigates to the landing page on use.
   */
  landingPage: async ({page}, use: (p: LandingPage) => Promise<void>) => {
    const landingPage = new LandingPage(page);
    await use(landingPage);
  },

  /**
   * Login page object fixture.
   * Provides harness-style API for auth flows.
   */
  loginPage: async ({page}, use: (p: LoginPage) => Promise<void>) => {
    const loginPage = new LoginPage(page);
    await use(loginPage);
  },
});

export {expect} from '@playwright/test';
export {createEnvironment};
