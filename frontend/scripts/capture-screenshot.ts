import fs from 'fs';
import path from 'path';
import {spawnSync} from 'child_process';

import {chromium, type Page} from '@playwright/test';

import {
  createAuthenticatedPage,
  patchGotoDefault,
  setupCorsInterceptor,
} from '../e2e/helpers/test-setup';
import {AngularFrontend} from '../../scripts/lib/AngularFrontend';
import {ConvexBackend} from '../../scripts/lib/ConvexBackend';
import {
  PROJECT_ROOT,
  ensureDopplerEnv,
  findEphemeralPort,
} from '../../scripts/lib/shared';
import {
  type FrontendScreenshotAuthMode,
  parseFrontendScreenshotArgs,
} from '../../scripts/lib/frontendScreenshotOptions';

const FRONTEND_DIR = path.join(PROJECT_ROOT, 'frontend');
const AUTH_STATE_PATHS: Record<
  Exclude<FrontendScreenshotAuthMode, 'none'>,
  string
> = {
  admin: path.join(FRONTEND_DIR, 'playwright', '.auth', 'admin.json'),
  user: path.join(FRONTEND_DIR, 'playwright', '.auth', 'user.json'),
};

ensureDopplerEnv();

async function waitForPageStable(page: Page): Promise<void> {
  await page.locator('body').waitFor({state: 'visible'});
  await page.waitForFunction(
    async () => {
      if ('fonts' in document) {
        await document.fonts.ready;
      }
      return (
        document.readyState === 'interactive' ||
        document.readyState === 'complete'
      );
    },
    undefined,
    {timeout: 10_000},
  );
}

function refreshAuthState(
  auth: FrontendScreenshotAuthMode,
  env: NodeJS.ProcessEnv,
): string | null {
  if (auth === 'none') {
    return null;
  }

  const storageStatePath = AUTH_STATE_PATHS[auth];
  const result = spawnSync(
    'pnpm',
    ['exec', 'playwright', 'test', 'e2e/global.setup.ts', '--project=setup'],
    {
      cwd: FRONTEND_DIR,
      env,
      stdio: 'inherit',
    },
  );

  if (result.status !== 0) {
    throw new Error(`Failed to generate Playwright auth state for "${auth}"`);
  }

  if (!fs.existsSync(storageStatePath)) {
    throw new Error(
      `Expected auth state file was not created: ${storageStatePath}`,
    );
  }

  return storageStatePath;
}

async function createAnonymousPage(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  patchGotoDefault(page);
  await setupCorsInterceptor(page);
  return page;
}

void (async () => {
  const options = parseFrontendScreenshotArgs(
    process.argv.slice(2),
    PROJECT_ROOT,
  );
  const backend = new ConvexBackend({mode: 'e2e'});
  let frontend: AngularFrontend | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

  try {
    const e2ePort = process.env['E2E_PORT']
      ? Number.parseInt(process.env['E2E_PORT'], 10)
      : await findEphemeralPort();

    await backend.start(e2ePort);

    frontend = new AngularFrontend({
      configuration: 'e2e',
      convexSiteUrl: backend.convexSiteUrl,
      convexUrl: backend.convexUrl,
      port: e2ePort,
    });
    await frontend.start();

    const harnessEnv: NodeJS.ProcessEnv = {
      ...process.env,
      CONVEX_SITE_URL: backend.convexSiteUrl,
      CONVEX_URL: backend.convexUrl,
      E2E_PORT: String(e2ePort),
    };

    const storageStatePath = refreshAuthState(options.auth, harnessEnv);

    browser = await chromium.launch({headless: true});
    const page =
      storageStatePath === null
        ? await createAnonymousPage(browser)
        : await createAuthenticatedPage(
            browser,
            storageStatePath,
            options.auth === 'admin' ? 'admin user' : 'standard user',
          );

    await page.goto(`http://127.0.0.1:${String(e2ePort)}${options.route}`, {
      timeout: options.timeoutMs,
      waitUntil: 'domcontentloaded',
    });
    await waitForPageStable(page);

    if (options.selector !== null) {
      await page.locator(options.selector).first().waitFor({
        state: 'visible',
        timeout: options.timeoutMs,
      });
    }

    if (options.waitForText !== null) {
      await page
        .getByText(options.waitForText, {exact: false})
        .first()
        .waitFor({
          state: 'visible',
          timeout: options.timeoutMs,
        });
    }

    fs.mkdirSync(path.dirname(options.outPath), {recursive: true});
    await page.screenshot({
      fullPage: options.fullPage,
      path: options.outPath,
    });
    await page.context().close();

    console.log(`[screenshot] Saved ${options.outPath}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[screenshot] Failed: ${msg}`);
    process.exitCode = 1;
  } finally {
    if (browser !== null) {
      await browser.close();
    }
    if (frontend !== null) {
      await frontend.stop();
    }
    await backend.stop();
  }
})();
