// @vitest-environment node

import {describe, expect, it} from 'vitest';

import {determineConvexGeneratedRequirement} from './convex-generated-impact';

describe('determineConvexGeneratedRequirement', () => {
  it('requires a freshness check for Convex source changes', () => {
    const result = determineConvexGeneratedRequirement([
      'backend/convex/events/management.ts',
      'backend/convex/schema.ts',
    ]);

    expect(result.needsCheck).toBe(true);
    expect(result.reasons).toEqual([
      'backend/convex/events/management.ts',
      'backend/convex/schema.ts',
    ]);
  });

  it('skips test-only and generated Convex files', () => {
    const result = determineConvexGeneratedRequirement([
      'backend/convex/orders/core.test.ts',
      'backend/convex/events/_impl/broadcasts.test.ts',
      'backend/convex/_generated/api.d.ts',
    ]);

    expect(result.needsCheck).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it('requires a freshness check for dependency lockfile changes', () => {
    const result = determineConvexGeneratedRequirement([
      'backend/package.json',
      'pnpm-lock.yaml',
    ]);

    expect(result.needsCheck).toBe(true);
    expect(result.reasons).toEqual(['backend/package.json', 'pnpm-lock.yaml']);
  });

  it('skips unrelated frontend and docs changes', () => {
    const result = determineConvexGeneratedRequirement([
      'frontend/src/app/app.ts',
      'docs/runbooks/local-dev.md',
    ]);

    expect(result.needsCheck).toBe(false);
    expect(result.reasons).toEqual([]);
  });
});
