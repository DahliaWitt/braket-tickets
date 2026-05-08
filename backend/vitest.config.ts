import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vitest/config';
import {codecovVitePlugin} from '@codecov/vite-plugin';

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
  cacheDir: './node_modules/.vite/vitest-backend',
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  plugins: [
    codecovVitePlugin({
      enableBundleAnalysis: process.env.CODECOV_TOKEN !== undefined,
      bundleName: 'braket-tickets-convex',
      telemetry: false,
      uploadToken: process.env.CODECOV_TOKEN,
    }),
  ],
  test: {
    experimental: {
      fsModuleCache: true,
    },
    environment: 'edge-runtime',
    server: {deps: {inline: ['convex-test', '@convex-dev/workpool']}},
    include: ['convex/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['node_modules/**'],
    maxWorkers: 1, // Serialize tests for shared local backend
    testTimeout: 30000, // Increase timeout for backend latency
    setupFiles: ['./convex/testing/vitest.setup.ts'],
    reporters,
    retry: process.env.CI ? 2 : 0,
    outputFile: wantsJsonReporter
      ? {
          json: '../reports/convex-test-results.json',
        }
      : undefined,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      exclude: [
        'node_modules/',
        'convex/testing/**',
        'convex/_generated/**',
        '**/*.test.ts',
        '**/*.config.ts',
      ],
      thresholds: {
        lines: 70,
        functions: 60,
        branches: 50,
        statements: 70,
      },
    },
  },
});
