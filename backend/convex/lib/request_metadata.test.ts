import {describe, expect, it} from 'vitest';
import type {MutationCtx} from '../_generated/server';
import {
  getAuditRequestFields,
  getRequestMetadataSafe,
} from './request_metadata';

function ctxWithMeta(meta: unknown): Pick<MutationCtx, 'meta'> {
  return {meta} as Pick<MutationCtx, 'meta'>;
}

describe('getRequestMetadataSafe', () => {
  it('passes through metadata when the runtime supports it', async () => {
    const metadata = {
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0',
      requestId: 'req_123',
      scheduledFunctionId: null,
    };
    const ctx = ctxWithMeta({
      getRequestMetadata: () => Promise.resolve(metadata),
    });

    await expect(getRequestMetadataSafe(ctx)).resolves.toEqual(metadata);
  });

  it('returns nulls when getRequestMetadata throws (convex-test runtime)', async () => {
    const ctx = ctxWithMeta({
      getRequestMetadata: () => {
        throw new Error('getRequestMetadata() is not implemented');
      },
    });

    await expect(getRequestMetadataSafe(ctx)).resolves.toEqual({
      ip: null,
      userAgent: null,
      requestId: null,
      scheduledFunctionId: null,
    });
  });

  it('returns nulls when ctx.meta is absent at runtime', async () => {
    const ctx = ctxWithMeta(undefined);

    await expect(getRequestMetadataSafe(ctx)).resolves.toEqual({
      ip: null,
      userAgent: null,
      requestId: null,
      scheduledFunctionId: null,
    });
  });
});

describe('getAuditRequestFields', () => {
  it('maps both fields when present', async () => {
    const ctx = ctxWithMeta({
      getRequestMetadata: () =>
        Promise.resolve({
          ip: '203.0.113.7',
          userAgent: 'Mozilla/5.0',
          requestId: 'req_1',
          scheduledFunctionId: null,
        }),
    });

    await expect(getAuditRequestFields(ctx)).resolves.toEqual({
      ipAddress: '203.0.113.7',
      userAgent: 'Mozilla/5.0',
    });
  });

  it('omits null fields so spreading sets nothing', async () => {
    const ctx = ctxWithMeta({
      getRequestMetadata: () =>
        Promise.resolve({
          ip: '203.0.113.7',
          userAgent: null,
          requestId: 'req_1',
          scheduledFunctionId: null,
        }),
    });

    await expect(getAuditRequestFields(ctx)).resolves.toEqual({
      ipAddress: '203.0.113.7',
    });
  });

  it('returns an empty object when the runtime has no request metadata', async () => {
    const ctx = ctxWithMeta({
      getRequestMetadata: () => {
        throw new Error('unsupported');
      },
    });

    await expect(getAuditRequestFields(ctx)).resolves.toEqual({});
  });
});
