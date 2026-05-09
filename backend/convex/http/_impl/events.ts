import {internal} from '../../_generated/api';
import type {ActionCtx} from '../../_generated/server';
import {getPublicCorsHeaders} from './config';
import {checkPublicEndpointRateLimit} from './rate_limits';

const publicCacheHeaders = {
  ...getPublicCorsHeaders(),
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
};

const uncachedPublicErrorHeaders = {
  ...getPublicCorsHeaders(),
  'Cache-Control': 'no-store',
};

export async function handleListPublicEvents(
  ctx: ActionCtx,
  request: Request,
): Promise<Response> {
  const rateLimit = await checkPublicEndpointRateLimit(
    ctx,
    request,
    'listPublicEvents',
  );
  if (rateLimit === 'missing-ip') {
    return new Response('Bad Request', {
      status: 400,
      headers: uncachedPublicErrorHeaders,
    });
  }
  if (rateLimit === 'limited') {
    return new Response('Too Many Requests', {
      status: 429,
      headers: {
        ...uncachedPublicErrorHeaders,
        'Retry-After': '60',
      },
    });
  }

  const events = await ctx.runQuery(
    internal.events.public.listPublicUpcomingInternal,
    {},
  );

  return new Response(JSON.stringify(events), {
    status: 200,
    headers: publicCacheHeaders,
  });
}

export async function handlePublicEventsOptions(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      ...getPublicCorsHeaders(),
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}
