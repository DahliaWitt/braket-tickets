/**
 * dev.ts — Local dev harness entry point.
 *
 * Replaces scripts/localHarness.js.
 * Starts Convex backend + Angular frontend in development mode.
 *
 * Usage:
 *   pnpm dev
 *   pnpm dev --fresh   # wipe backend state before starting
 */

import {ensureDopplerEnv} from './lib/shared';
import {HarnessInstance} from './lib/HarnessInstance';

ensureDopplerEnv();

const args = process.argv.slice(2);
const fresh = args.includes('--fresh');

void (async () => {
  let instance: HarnessInstance | null = null;

  const shutdown = () => {
    if (instance !== null) {
      void instance.stop().then(() => {
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    instance = await HarnessInstance.dev({fresh});
    // HarnessInstance.dev() calls frontend.start() which spawns ng serve.
    // The process stays alive because ng serve keeps running.
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[dev] Failed to start dev harness:', msg);
    if (instance !== null) {
      await instance.stop();
    }
    process.exit(1);
  }
})();
