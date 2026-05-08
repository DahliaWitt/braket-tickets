// @vitest-environment node

import {describe, expect, it} from 'vitest';

import {
  determineFrontendBuildRequirement,
  filterGeneratedOrIgnoredFiles,
} from './frontend-build-impact';

describe('determineFrontendBuildRequirement', () => {
  it('requires a frontend build for application source changes', () => {
    const result = determineFrontendBuildRequirement([
      'frontend/src/app/app.ts',
    ]);

    expect(result.needsBuild).toBe(true);
    expect(result.reasons).toContain('frontend/src/app/app.ts');
  });

  it('skips the frontend build for backend-only changes', () => {
    const result = determineFrontendBuildRequirement([
      'backend/convex/events/management.ts',
      'backend/convex/schema.ts',
    ]);

    expect(result.needsBuild).toBe(false);
  });

  it('skips the frontend build for frontend unit-test-only changes', () => {
    const result = determineFrontendBuildRequirement([
      'frontend/src/app/app.spec.ts',
      'frontend/src/app/app.harness.ts',
      'frontend/src/app/app.stories.ts',
      'frontend/src/test-setup.ts',
      'frontend/vitest.config.ts',
      'frontend/playwright.config.ts',
    ]);

    expect(result.needsBuild).toBe(false);
  });

  it('requires the frontend build for shared code used by the frontend', () => {
    const result = determineFrontendBuildRequirement([
      'shared/contracts/payments.ts',
    ]);

    expect(result.needsBuild).toBe(true);
  });

  it('requires the frontend build for public assets and frontend build config', () => {
    const result = determineFrontendBuildRequirement([
      'frontend/public/ball.png',
      'frontend/angular.json',
    ]);

    expect(result.needsBuild).toBe(true);
  });

  it('returns conservative build-required when impact is unknown', () => {
    const result = determineFrontendBuildRequirement([
      'scripts/with-env.ts',
    ]);

    expect(result.needsBuild).toBe(true);
  });

  it('skips the frontend build for frontend test config changes', () => {
    const result = determineFrontendBuildRequirement([
      'frontend/tsconfig.spec.json',
      'frontend/tsconfig.storybook.json',
    ]);

    expect(result.needsBuild).toBe(false);
  });
  it('ignores generated outputs when collecting local changes', () => {
    const result = filterGeneratedOrIgnoredFiles([
      'coverage/coverage-final.json',
      'reports/test-results.json',
      'frontend/public/docs/manifest.json',
      'frontend/src/app/app.ts',
    ]);

    expect(result).toEqual(['frontend/src/app/app.ts']);
  });
});
