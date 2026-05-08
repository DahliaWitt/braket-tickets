import {defineConfig} from 'vitest/config';
import angular from '@analogjs/vite-plugin-angular';
import {codecovVitePlugin} from '@codecov/vite-plugin';
import path from 'path';
import {createVitestDefine} from './scripts/runtime-config';

const isCi = process.env.CI !== undefined;
const wantsVerboseReporter = process.env.VITEST_VERBOSE === '1';
const wantsJsonReporter = isCi || process.env.VITEST_JSON === '1';

const reporters = isCi
  ? ['default', 'json', 'github-actions']
  : wantsVerboseReporter
    ? wantsJsonReporter
      ? ['verbose', 'json']
      : ['verbose']
    : wantsJsonReporter
      ? ['agent', 'json']
      : ['agent'];

export default defineConfig({
  cacheDir: './node_modules/.vite/vitest-frontend',
  define: createVitestDefine('development', process.env),
  plugins: [
    // pnpm hoists dual @types/node (22 vs 25); angular() returns Plugin[]
    // typed against Vite+@types/node@22 but defineConfig resolves against Vite+@types/node@25,
    // making the two Plugin types structurally incompatible due to _pluginContextMap.
    // @ts-expect-error
    angular(),
    // @ts-expect-error
    codecovVitePlugin({
      enableBundleAnalysis: process.env.CODECOV_TOKEN !== undefined,
      bundleName: 'braket-tickets-frontend',
      telemetry: false,
      uploadToken: process.env.CODECOV_TOKEN,
    }),
  ],
  resolve: {
    alias: {
      '@convex': path.resolve(__dirname, '../backend/convex'),
      '@shared': path.resolve(__dirname, '../shared'),
      '@ui': path.resolve(__dirname, './src/app/ui'),
      '@shared-schema': path.resolve(__dirname, '../shared'),
      '@': path.resolve(__dirname, './src/app'),
      convex: path.resolve(__dirname, './node_modules/convex'),
    },
  },
  test: {
    experimental: {
      fsModuleCache: true,
    },
    globals: true,
    environment: 'jsdom',
    setupFiles: [path.resolve(__dirname, 'src/test-setup.ts')],
    testTimeout: 10_000,
    // Use forks pool for process isolation - prevents Angular TestBed state leaking between files
    pool: 'forks',
    isolate: true, // forks.isolate moved to top-level in Vitest 4
    // Keep worker teardown reliable while repo validation runs frontend tests,
    // Angular typecheck, and backend tests in parallel.
    maxWorkers: 4,
    reporters,
    retry: process.env.CI ? 2 : 0,
    outputFile: wantsJsonReporter
      ? {
          json: './reports/test-results.json',
        }
      : undefined,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      exclude: [
        'node_modules/',
        'src/test-setup.ts',
        '**/*.spec.ts',
        '**/*.config.ts',
        '**/index.ts',
        '**/*.harness.ts',
        '**/*.stories.ts',
        '**/mock-types.ts',
      ],
      thresholds: {
        lines: 60,
        functions: 50,
        branches: 40,
        statements: 60,
      },
    },
  },
});
