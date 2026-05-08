import os from 'os';
import {defineConfig, devices} from '@playwright/test';

// Use production build if E2E_PROD is set (serves pre-built dist instead of ng serve)
const isProduction = process.env.E2E_PROD === 'true';

// Dynamic port for parallel E2E test runs (default 4201, can be overridden via E2E_PORT)
// When running multiple E2E suites in parallel, each should use a unique port
const e2ePort = parseInt(process.env.E2E_PORT || '4201', 10);
// IMPORTANT: Use 127.0.0.1 instead of localhost to match Convex local backend origin
// This prevents CORS issues since localhost ≠ 127.0.0.1 for CORS purposes
const baseURL = `http://127.0.0.1:${e2ePort}`;
const chromiumOnly = !process.env.CI && !process.env.ALL_BROWSERS;

/**
 * Playwright configuration for E2E tests.
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e-spec.ts',
  testIgnore: '**/audit/**',
  timeout: 30 * 1000, // Reduced from 60s to 30s for faster E2E test execution (use test.setTimeout() for slow tests)
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  maxFailures: 0, // Run all tests to see flakiness patterns
  retries: process.env.CI ? 2 : 0,
  // CI: PW_WORKERS is always set (currently 5). Local: use half logical CPUs.
  workers: process.env.PW_WORKERS
    ? parseInt(process.env.PW_WORKERS, 10)
    : Math.max(1, Math.floor(os.cpus().length / 2)),
  // CI: line for colored console output + html for artifact upload
  // Local: list for verbose readable output
  reporter: process.env.CI ? [['line'], ['html', {open: 'never'}]] : 'list',
  expect: {
    timeout: 10 * 1000,
  },
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /global\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: {...devices['Desktop Chrome']},
      dependencies: ['setup'],
    },
    ...(chromiumOnly
      ? []
      : [
          {
            name: 'Mobile Chrome',
            use: {...devices['Pixel 5']},
            dependencies: ['setup'],
            grep: /@smoke/,
          },
          {
            name: 'webkit',
            use: {...devices['Desktop Safari']},
            dependencies: ['setup'],
            grep: /@smoke/,
          },
          {
            name: 'Mobile Safari',
            use: {...devices['iPhone 13']},
            dependencies: ['setup'],
            grep: /@smoke/,
          },
        ]),
    ...(process.env.AUDIT_SUITE
      ? [
          {
            name: 'audit',
            testDir: './e2e/audit',
            testMatch: '**/*.e2e-spec.ts',
            testIgnore: [], // Override global testIgnore which excludes **/audit/**
            timeout: 120 * 1000,
            use: {...devices['Desktop Chrome']},
            dependencies: ['setup'],
            retries: 0,
          },
        ]
      : []),
  ],
  webServer: {
    // In production mode, serve the pre-built dist folder; otherwise use ng serve
    // Use 127.0.0.1 to match Convex local backend origin (avoid CORS issues)
    command: isProduction
      ? `npx serve dist/frontend/browser -l tcp://127.0.0.1:${e2ePort} -s`
      : `pnpm run start:e2e --port ${e2ePort} --host 127.0.0.1`,
    url: baseURL,
    // Always reuse existing server if one is running on this port
    reuseExistingServer: true,
    timeout: isProduction ? 30000 : 60000, // Prod server starts faster
  },
});
