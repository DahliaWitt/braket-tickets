import convexPlugin from '@convex-dev/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import noSequentialDbQueries from '../eslint-rules/no-sequential-db-queries.js';
import noVAny from '../eslint-rules/no-v-any.js';
import noRawDbMutations from '../eslint-rules/no-raw-db-mutations.js';
import convexBoundaries from './eslint-rules/convex-boundaries.mjs';

export default [
  {
    ignores: [
      'convex/_generated/**',
      'convex/**/*.test.ts',
      'convex/**/*.spec.ts',
    ],
  },
  {
    files: ['convex/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: ['./convex/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      '@convex-dev': convexPlugin,
      'braket-convex': noVAny,
      'no-sequential-db-queries': noSequentialDbQueries,
      'convex-boundaries': convexBoundaries,
    },
    rules: {
      '@convex-dev/no-old-registered-function-syntax': 'error',
      '@convex-dev/require-args-validator': 'error',
      '@convex-dev/explicit-table-ids': 'error',
      '@convex-dev/import-wrong-runtime': 'error',
      '@convex-dev/no-collect-in-query': 'warn',
      'braket-convex/no-v-any': 'error',
      'braket-convex/no-raw-convex-error': 'error',
      'no-sequential-db-queries/sequential-db-get': 'error',
      'convex-boundaries/no-cross-impl-import': 'error',
      'convex-boundaries/no-registered-in-impl': 'error',
      'convex-boundaries/no-convex-module-import': 'error',
      'no-restricted-properties': [
        'error',
        {object: 'describe', property: 'only'},
        {object: 'it', property: 'only'},
        {object: 'test', property: 'only'},
      ],
    },
  },
  // Enforce no-raw-db-mutations on the testing/ seed helpers only.
  // Production files legitimately use ctx.db.* — only the seed helpers are restricted.
  {
    files: ['convex/testing/**/*.ts'],
    plugins: {
      'no-raw-db-mutations': noRawDbMutations,
    },
    rules: {
      'no-raw-db-mutations/no-raw-db-mutation': 'error',
    },
  },
];
