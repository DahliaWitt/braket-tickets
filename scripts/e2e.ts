/**
 * e2e.ts — One-shot E2E harness entry point.
 *
 * Replaces scripts/backendHarness.js.
 * Starts a local Convex backend, optionally builds and serves the frontend,
 * runs Playwright, then tears down.
 *
 * Usage:
 *   pnpm test:e2e
 *   pnpm test:e2e -- --build              # pre-build frontend before running
 *   pnpm test:e2e -- --debug              # open Playwright inspector
 *   pnpm test:e2e -- e2e/auth.e2e-spec.ts # run a specific file
 */

import {spawnSync} from 'child_process';

import {
  ensureDopplerEnv,
  findEphemeralPort,
  isLocalUrl,
  PROJECT_ROOT,
  treeKill,
} from './lib/shared';
import {ConvexBackend} from './lib/ConvexBackend';
import {AngularFrontend} from './lib/AngularFrontend';

ensureDopplerEnv();

// ── Arg parsing ────────────────────────────────────────────────────────────────

const rawArgs = process.argv.slice(2);
const isBuild = rawArgs.includes('--build');
const isDebug = rawArgs.includes('--debug');

// Filter out our flags and bare '--' separator
const passthroughArgs = rawArgs.filter(
  (a) => a !== '--build' && a !== '--debug' && a !== '--',
);

// ── Safety check: refuse remote CONVEX_URL ────────────────────────────────────

const envConvexUrl = process.env['CONVEX_URL'];
if (
  envConvexUrl !== undefined &&
  envConvexUrl !== '' &&
  !isLocalUrl(envConvexUrl)
) {
  console.error(
    'ERROR: CONVEX_URL points to a remote deployment. E2E tests must run against a local backend.',
  );
  console.error(`  CONVEX_URL=${envConvexUrl}`);
  console.error(
    'Unset CONVEX_URL or point it at 127.0.0.1 before running E2E tests.',
  );
  process.exit(1);
}

// ── Main ───────────────────────────────────────────────────────────────────────

void (async () => {
  const backend = new ConvexBackend({mode: 'e2e'});
  let frontend: AngularFrontend | null = null;
  let staticFrontendPid: number | null = null;
  let exitCode: number;

  try {
    const e2ePort = process.env['E2E_PORT']
      ? parseInt(process.env['E2E_PORT'], 10)
      : await findEphemeralPort();

    console.log(`[e2e] Using E2E port: ${String(e2ePort)}`);

    await backend.start(e2ePort);

    if (isBuild) {
      // --build: pre-build Angular with e2e config and serve statically
      const staticFrontend = await AngularFrontend.buildAndServe(
        backend.convexUrl,
        backend.convexSiteUrl,
        e2ePort,
        backend.workspaceDir,
      );
      staticFrontendPid = staticFrontend.pid;
    } else {
      // Start Angular dev server explicitly with the harness-selected Convex URLs.
      // Playwright's reuseExistingServer: true
      // will detect this server and skip its own webServer startup.
      frontend = new AngularFrontend({
        convexUrl: backend.convexUrl,
        convexSiteUrl: backend.convexSiteUrl,
        port: e2ePort,
        configuration: 'e2e',
      });
      await frontend.start();
    }

    // Build Playwright command args
    const playwrightArgs = [
      '--filter',
      'frontend',
      'exec',
      'playwright',
      'test',
      ...passthroughArgs,
    ];
    if (isDebug) {
      playwrightArgs.push('--debug');
    }

    const spawnEnv: NodeJS.ProcessEnv = {
      ...process.env,
      CONVEX_URL: backend.convexUrl,
      CONVEX_SITE_URL: backend.convexSiteUrl,
      E2E_PORT: String(e2ePort),
    };

    if (isBuild) {
      spawnEnv['E2E_PROD'] = 'true';
    }

    // Propagate color support unless explicitly disabled
    if (!process.env['NO_COLOR']) {
      spawnEnv['FORCE_COLOR'] = '1';
    }

    const result = spawnSync('pnpm', playwrightArgs, {
      stdio: 'inherit',
      cwd: PROJECT_ROOT,
      env: spawnEnv,
    });

    exitCode = result.status ?? 1;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[e2e] Fatal error:', msg);
    exitCode = 1;
  } finally {
    if (frontend !== null) {
      await frontend.stop();
    }
    if (staticFrontendPid !== null) {
      console.log(
        `[e2e] Stopping static frontend (pid ${staticFrontendPid})...`,
      );
      try {
        await treeKill(staticFrontendPid);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[e2e] Failed to stop static frontend: ${msg}`);
      }
    }
    await backend.stop();
  }

  process.exit(exitCode);
})();
