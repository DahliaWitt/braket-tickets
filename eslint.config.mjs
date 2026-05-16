import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import convexPlugin from '@convex-dev/eslint-plugin';
import angular from 'angular-eslint';
import noRawDbMutations from './eslint-rules/no-raw-db-mutations.js';
import noVAny from './eslint-rules/no-v-any.js';

const FRONTEND_DIR = `${import.meta.dirname}/frontend`;

const IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/_generated/**',
  '**/coverage/**',
  'docs/**',
  'coverage/**',
  'reports/**',
  '.angular/**',
  'frontend/.angular/**',
  'frontend/coverage/**',
  'storybook-static/**',
  'frontend/storybook-static/**',
  'playwright-report/**',
  'frontend/playwright-report/**',
  'test-results/**',
  'frontend/test-results/**',
  'src/**/*.stories.ts',
  'frontend/src/**/*.stories.ts',
  '.agent/**',
  '.claude/**',
  '.opencode/**',
  '.worktrees/**',
  '.gts_build/**',
  'frontend/e2e/page-objects/**',
];

const TEST_FILE_PATTERNS = [
  '**/*.test.ts',
  '**/*.spec.ts',
  '**/*.e2e-spec.ts',
  '**/test-setup.ts',
  '**/vitest.setup.ts',
];

const FRONTEND_TS_PATTERNS = ['frontend/src/**/*.ts', 'src/**/*.ts'];
const FRONTEND_HTML_PATTERNS = ['frontend/src/**/*.html', 'src/**/*.html'];
const FRONTEND_SPEC_PATTERNS = [
  'frontend/src/**/*.spec.ts',
  'src/**/*.spec.ts',
];
const FRONTEND_LUCIDE_PATTERNS = [
  'frontend/src/app/ui/components/primitives/icon/lucide-icon-data.ts',
  'src/app/ui/components/primitives/icon/lucide-icon-data.ts',
];
const FRONTEND_AUTH_SERVICE_PATTERNS = [
  'frontend/src/app/core/services/auth.service.ts',
  'src/app/core/services/auth.service.ts',
];
const FRONTEND_DECLARATION_PATTERNS = [
  'frontend/src/declarations.d.ts',
  'src/declarations.d.ts',
];

export default tseslint.config(
  {
    ignores: IGNORE_PATTERNS,
  },
  eslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.commonjs,
        ...globals.es2024,
        ...globals.node,
      },
    },
    rules: {
      'no-console': 'off',
      'no-debugger': 'error',
      eqeqeq: ['error', 'always', {null: 'ignore'}],
      'max-lines': [
        'error',
        {
          max: 850,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-restricted-properties': [
        'error',
        {object: 'describe', property: 'only'},
        {object: 'it', property: 'only'},
        {object: 'test', property: 'only'},
      ],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-extraneous-class': [
        'warn',
        {
          allowWithDecorator: true,
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: TEST_FILE_PATTERNS,
    rules: {
      // Tests routinely keep setup values around for clarity and can grow large.
      'max-lines': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
  {
    files: ['backend/convex/testing/**/*.ts'],
    ignores: [
      'backend/convex/testing/**/*.test.ts',
      'backend/convex/testing/**/*.spec.ts',
    ],
    plugins: {
      'no-raw-db-mutations': noRawDbMutations,
    },
    rules: {
      'no-raw-db-mutations/no-raw-db-mutation': 'error',
    },
  },
  {
    files: FRONTEND_TS_PATTERNS,
    extends: [
      ...tseslint.configs.recommendedTypeChecked,
      ...tseslint.configs.stylistic,
      ...angular.configs.tsRecommended,
    ],
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: FRONTEND_DIR,
      },
    },
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: ['app', 'z', 'bra'],
          style: 'kebab-case',
        },
      ],
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: ['app', 'z', 'bra'],
          style: 'camelCase',
        },
      ],
      '@angular-eslint/prefer-on-push-component-change-detection': 'error',
      '@angular-eslint/prefer-signals': 'error',
      '@angular-eslint/no-uncalled-signals': 'error',
      '@angular-eslint/no-async-lifecycle-method': 'error',
      '@angular-eslint/no-pipe-impure': 'error',
      '@angular-eslint/use-injectable-provided-in': 'off',
      '@angular-eslint/no-lifecycle-call': 'error',
      '@angular-eslint/no-duplicates-in-metadata-arrays': 'error',
      '@angular-eslint/prefer-host-metadata-property': 'error',
      '@angular-eslint/prefer-output-emitter-ref': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/return-await': 'error',
      '@typescript-eslint/no-deprecated': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {fixStyle: 'inline-type-imports'},
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: FRONTEND_HTML_PATTERNS,
    extends: [
      ...angular.configs.templateRecommended,
      ...angular.configs.templateAccessibility,
    ],
    rules: {
      '@angular-eslint/template/button-has-type': 'error',
      '@angular-eslint/template/no-any': 'error',
      '@angular-eslint/template/no-duplicate-attributes': 'error',
      '@angular-eslint/template/no-empty-control-flow': 'error',
      '@angular-eslint/template/no-positive-tabindex': 'error',
      '@angular-eslint/template/prefer-self-closing-tags': 'error',
      '@angular-eslint/template/prefer-at-else': 'error',
      '@angular-eslint/template/prefer-at-empty': 'error',
    },
  },
  {
    files: FRONTEND_SPEC_PATTERNS,
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/await-thenable': 'off',
    },
  },
  {
    files: ['backend/convex/**/*.ts'],
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
    plugins: {
      '@convex-dev': convexPlugin,
      'braket-convex': noVAny,
      'no-raw-db-mutations': noRawDbMutations,
    },
    rules: {
      'max-lines': 'off',
      '@convex-dev/explicit-table-ids': 'error',
      '@convex-dev/no-collect-in-query': 'warn',
      'braket-convex/no-v-any': 'error',
      'braket-convex/no-raw-convex-error': 'error',
    },
  },
  {
    files: [
      'backend/convex/migrations/**/*.ts',
      'backend/convex/**/*backfill*.ts',
      '**/*.harness.ts',
    ],
    rules: {
      'no-await-in-loop': 'off',
    },
  },
  {
    files: FRONTEND_LUCIDE_PATTERNS,
    rules: {
      'max-lines': 'off',
    },
  },
  {
    files: FRONTEND_AUTH_SERVICE_PATTERNS,
    rules: {
      'max-lines': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    files: FRONTEND_DECLARATION_PATTERNS,
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
