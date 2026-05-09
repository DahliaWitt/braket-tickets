import {describe, expect, it, vi} from 'vitest';
import type {ActionCtx} from '../_generated/server';
import {
  handleGetPublicCommunityBySlug,
  handleListPublicCommunities,
} from './_impl/communities';

function createTestContext() {
  return {
    runMutation: vi.fn().mockResolvedValue(undefined),
    runQuery: vi.fn(),
  } as unknown as ActionCtx;
}

describe('public communities HTTP handlers', () => {
  it('returns 503 for directory capacity errors without caching the response', async () => {
    const ctx = createTestContext();
    (ctx.runQuery as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error(
        'Public directory published event scan exceeded the explicit limit of 500',
      ),
    );

    const response = await handleListPublicCommunities(
      ctx,
      new Request('https://braket.gay/api/communities'),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.text()).toBe('Service Unavailable');
  });

  it('returns 503 for slug capacity errors without caching the response', async () => {
    const ctx = createTestContext();
    (ctx.runQuery as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error(
        'Public community slug event scan exceeded the explicit limit of 500',
      ),
    );

    const response = await handleGetPublicCommunityBySlug(
      ctx,
      new Request('https://braket.gay/api/communities/overflow-slug-community'),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.text()).toBe('Service Unavailable');
  });

  it('returns 404 for malformed percent-encoded community slugs', async () => {
    const ctx = createTestContext();

    const response = await handleGetPublicCommunityBySlug(
      ctx,
      new Request('https://braket.gay/api/communities/%E0%A4%A'),
    );

    expect(response.status).toBe(404);
    expect(ctx.runQuery).not.toHaveBeenCalled();
  });
});
