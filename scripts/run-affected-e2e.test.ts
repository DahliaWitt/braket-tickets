import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {assertSafeGitRef, determineTests} from './run-affected-e2e';

describe('determineTests', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs only the modified e2e spec for direct spec changes', () => {
    expect(
      determineTests(['frontend/e2e/auth/registration-flow.e2e-spec.ts']),
    ).toEqual({
      runAll: false,
      specs: ['e2e/auth/registration-flow.e2e-spec.ts'],
    });
  });

  it('keeps schema changes as an all-suite trigger', () => {
    expect(determineTests(['backend/convex/schema.ts'])).toEqual({
      runAll: true,
      specs: [],
    });
  });

  it('maps frontend admin changes to admin e2e specs instead of the full suite', () => {
    const result = determineTests([
      'frontend/src/app/features/admin/pages/check-in/check-in.component.ts',
    ]);

    expect(result.runAll).toBe(false);
    expect(result.specs).toEqual(
      expect.arrayContaining([
        'e2e/admin/check-in.e2e-spec.ts',
        'e2e/admin/comprehensive-event-management.e2e-spec.ts',
      ]),
    );
    expect(result.specs).not.toContain('e2e/payments/refund-flow.e2e-spec.ts');
  });

  it('maps backend payment changes to payment and ticket specs', () => {
    const result = determineTests(['backend/convex/payments/refunds.ts']);

    expect(result.runAll).toBe(false);
    expect(result.specs).toEqual(
      expect.arrayContaining([
        'e2e/payments/purchase-flow.e2e-spec.ts',
        'e2e/payments/refund-flow.e2e-spec.ts',
        'e2e/tickets.e2e-spec.ts',
      ]),
    );
  });

  it('keeps shared frontend core changes conservative', () => {
    expect(
      determineTests(['frontend/src/app/core/services/feedback.service.ts']),
    ).toEqual({
      runAll: true,
      specs: [],
    });
  });

  it('keeps shared layout changes conservative', () => {
    expect(
      determineTests(['frontend/src/app/layout/footer/footer.ts']),
    ).toEqual({
      runAll: true,
      specs: [],
    });
  });

  it('maps known Convex lib domains to their affected e2e specs', () => {
    const result = determineTests(['backend/convex/lib/events/read_models.ts']);

    expect(result.runAll).toBe(false);
    expect(result.specs).toEqual(
      expect.arrayContaining([
        'e2e/admin/event-lifecycle.e2e-spec.ts',
        'e2e/events/community-filter.e2e-spec.ts',
        'e2e/payments/purchase-flow.e2e-spec.ts',
      ]),
    );
    expect(result.specs).not.toContain(
      'e2e/security/rls-enforcement.e2e-spec.ts',
    );
  });

  it('falls back to all tests for unmapped Convex lib changes', () => {
    expect(determineTests(['backend/convex/lib/validators/events.ts'])).toEqual(
      {
        runAll: true,
        specs: [],
      },
    );
  });

  it('only maps access directory files through the access prefix', () => {
    expect(
      determineTests(['backend/convex/lib/access/permissions.ts']).runAll,
    ).toBe(false);
    expect(determineTests(['backend/convex/lib/access_control.ts'])).toEqual({
      runAll: true,
      specs: [],
    });
  });

  it('rejects unsafe git refs before shelling out', () => {
    expect(assertSafeGitRef('after', 'origin/develop^')).toBe(
      'origin/develop^',
    );
    expect(() => assertSafeGitRef('after', 'origin/develop;echo nope')).toThrow(
      /Unsafe git ref/,
    );
  });

  it('skips non-e2e unit test changes', () => {
    expect(
      determineTests(['backend/convex/payments/refund_processing.test.ts']),
    ).toEqual({
      runAll: false,
      specs: [],
    });
  });

  it('falls back to all tests for unknown production files', () => {
    expect(determineTests(['shared/domain/new-contract.ts'])).toEqual({
      runAll: true,
      specs: [],
    });
  });
});
