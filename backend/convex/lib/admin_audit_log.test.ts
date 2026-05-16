import {describe, expect, it, vi} from 'vitest';
import type {Id} from '../_generated/dataModel';
import type {MutationCtx} from '../_generated/server';
import {ADMIN_AUDIT_ACTIONS} from './admin_audit_actions';
import {insertAdminAuditLog} from './admin_audit_log';

describe('insertAdminAuditLog', () => {
  it('stores request id metadata when Convex provides it', async () => {
    const insert = vi.fn().mockResolvedValue('audit-id');
    const ctx = {
      db: {insert},
      meta: {
        getRequestMetadata: vi.fn().mockResolvedValue({
          requestId: 'req-convex-123',
          ip: '203.0.113.1',
          userAgent: 'Unit Test',
        }),
      },
    } as unknown as Pick<MutationCtx, 'db' | 'meta'>;

    await insertAdminAuditLog(ctx, {
      adminId: 'admin-user' as Id<'users'>,
      action: ADMIN_AUDIT_ACTIONS.APPLICATION_REVIEW,
    });

    expect(insert).toHaveBeenCalledWith(
      'adminAuditLogs',
      expect.objectContaining({
        requestId: 'req-convex-123',
      }),
    );
    expect(insert.mock.calls[0]?.[1]).not.toHaveProperty('ip');
    expect(insert.mock.calls[0]?.[1]).not.toHaveProperty('userAgent');
  });
});
