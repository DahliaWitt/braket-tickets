import {describe, expect, it, vi} from 'vitest';
import type {ActionCtx} from '../_generated/server';
import {createMarketingTrackingHandlers} from './_impl/marketing_tracking';

function createTestContext() {
  return {
    runMutation: vi.fn().mockResolvedValue(undefined),
  } as unknown as ActionCtx;
}

describe('createMarketingTrackingHandlers', () => {
  it('supports one-click unsubscribe via GET fallback clients', async () => {
    const handlers = createMarketingTrackingHandlers({
      allowedOrigins: [],
      effectiveSiteUrl: 'https://braket.gay',
      emailSiteUrl: 'https://braket.gay',
    });
    const ctx = createTestContext();

    const response = await handlers.handleMarketingOneClickGet(
      ctx,
      new Request('https://braket.gay/api/unsubscribe/one-click?token=shared-token'),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('OK');
    expect((ctx.runMutation as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toEqual({
      token: 'shared-token',
    });
  });

  it('supports one-click unsubscribe via POST clients', async () => {
    const handlers = createMarketingTrackingHandlers({
      allowedOrigins: [],
      effectiveSiteUrl: 'https://braket.gay',
      emailSiteUrl: 'https://braket.gay',
    });
    const ctx = createTestContext();

    const response = await handlers.handleMarketingOneClickPost(
      ctx,
      new Request('https://braket.gay/api/unsubscribe/one-click?token=shared-token', {
        method: 'POST',
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('OK');
    expect((ctx.runMutation as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toEqual({
      token: 'shared-token',
    });
  });
});
