import {describe, expect, it} from 'vitest';
import type {MutationCtx} from '../_generated/server';
import {getRequestMetadataSafe} from './request_metadata';

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
