/**
 * e2e-serve.ts — Start-once E2E server for iterating on test fixes.
 *
 * Replaces scripts/e2e-serve.sh.
 * Starts Convex backend + Angular frontend dev server and keeps them alive.
 * Run pnpm test:e2e:run in a separate terminal to execute tests.
 *
 * Usage:
 *   pnpm test:e2e:serve
 *
 * SIGINT/SIGTERM cleanly stops both servers.
 */

import {ensureDopplerEnv, findEphemeralPort} from './lib/shared';
import {ConvexBackend} from './lib/ConvexBackend';
import {AngularFrontend} from './lib/AngularFrontend';
import {HarnessInstance} from './lib/HarnessInstance';

ensureDopplerEnv();

void (async () => {
  let instance: HarnessInstance | null = null;

  const shutdown = () => {
    console.log('\nShutting down E2E servers...');
    if (instance !== null) {
      void instance.stop().then(() => {
        console.log('Cleanup complete.');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    const e2ePort = process.env['E2E_PORT']
      ? parseInt(process.env['E2E_PORT'], 10)
      : await findEphemeralPort();

    console.log('=== E2E Serve ===');
    console.log('Phase 1: Starting Convex backend...');

    const backend = new ConvexBackend({mode: 'e2e'});
    await backend.start(e2ePort);

    console.log('Backend ready.');
    console.log(`  Convex URL:      ${backend.convexUrl}`);
    console.log(`  Convex Site URL: ${backend.convexSiteUrl}`);
    console.log(`  Frontend port:   ${String(e2ePort)}`);
    console.log('');

    const frontend = new AngularFrontend({
      convexUrl: backend.convexUrl,
      convexSiteUrl: backend.convexSiteUrl,
      port: e2ePort,
      configuration: 'e2e',
    });

    instance = new HarnessInstance(backend, frontend);
    instance.linkAsActive();

    console.log('Phase 2: Starting Angular dev server...');
    console.log('E2E servers ready. Run tests with: pnpm test:e2e:run');
    console.log('(Press Ctrl+C to stop all servers)');
    console.log('');

    // frontend.start() blocks — the process stays alive until killed
    await frontend.start();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[e2e-serve] Fatal error:', msg);
    if (instance !== null) {
      await instance.stop();
    }
    process.exit(1);
  }
})();
