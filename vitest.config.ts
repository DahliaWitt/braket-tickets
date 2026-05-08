import {defineConfig} from 'vitest/config';

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
  cacheDir: './node_modules/.vite/vitest-root',
  test: {
    environment: 'node',
    experimental: {
      fsModuleCache: true,
    },
    include: ['scripts/**/*.test.ts', 'ops/**/*.test.ts'],
    exclude: ['backend/**', 'frontend/**', 'node_modules/**'],
    reporters,
    retry: process.env.CI ? 2 : 0,
    outputFile: wantsJsonReporter
      ? {
          json: './reports/test-results.json',
        }
      : undefined,
  },
});
