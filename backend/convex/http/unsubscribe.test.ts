import {describe, expect, it, vi} from 'vitest';
import type {ActionCtx} from '../_generated/server';
import {createUnsubscribeHandlers} from './_impl/unsubscribe';

function createTestContext(
  queryResult: unknown = {
    unsubscribedFrom: null,
    preferences: [],
    globalMarketingOptOut: false,
  },
) {
  return {
    runMutation: vi.fn().mockResolvedValue(undefined),
    runQuery: vi.fn().mockResolvedValue(queryResult),
  } as unknown as ActionCtx;
}

function createHandlers() {
  return createUnsubscribeHandlers({
    allowedOrigins: ['https://braket.gay'],
    effectiveSiteUrl: 'https://braket.gay',
    emailSiteUrl: 'https://braket.gay',
  });
}

// Mirrors the proxy header Convex Cloud injects on every request so we exercise
// the same rate-limit path production sees, instead of the fail-closed branch.
const PROXY_IP_HEADER = {'x-forwarded-for': '127.0.0.1'} as const;

describe('createUnsubscribeHandlers', () => {
  it('returns CORS headers on preference reads', async () => {
    const handlers = createHandlers();
    const ctx = createTestContext();

    const response = await handlers.handleUnsubscribePreferencesGet(
      ctx,
      new Request(
        'https://api.braket.gay/api/unsubscribe-preferences?token=t',
        {
          headers: {origin: 'https://braket.gay', ...PROXY_IP_HEADER},
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://braket.gay',
    );
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  it('returns CORS headers on preference toggles', async () => {
    const handlers = createHandlers();
    const ctx = createTestContext();

    const response = await handlers.handleUnsubscribeTogglePost(
      ctx,
      new Request('https://api.braket.gay/api/unsubscribe-toggle', {
        method: 'POST',
        headers: {
          origin: 'https://braket.gay',
          'Content-Type': 'application/json',
          ...PROXY_IP_HEADER,
        },
        body: JSON.stringify({token: 't', optedIn: false}),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://braket.gay',
    );
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  it('fails closed with 400 when proxy IP headers are missing on preference reads', async () => {
    const handlers = createHandlers();
    const ctx = createTestContext();

    const response = await handlers.handleUnsubscribePreferencesGet(
      ctx,
      new Request(
        'https://api.braket.gay/api/unsubscribe-preferences?token=t',
        {headers: {origin: 'https://braket.gay'}},
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({error: 'missing_client_ip'});
    expect(ctx.runQuery).not.toHaveBeenCalled();
  });

  it('fails closed with 400 when proxy IP headers are missing on preference toggles', async () => {
    const handlers = createHandlers();
    const ctx = createTestContext();

    const response = await handlers.handleUnsubscribeTogglePost(
      ctx,
      new Request('https://api.braket.gay/api/unsubscribe-toggle', {
        method: 'POST',
        headers: {
          origin: 'https://braket.gay',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({token: 't', optedIn: false}),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({error: 'missing_client_ip'});
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });
});
