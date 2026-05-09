import {internal} from '../../_generated/api';
import type {ActionCtx} from '../../_generated/server';
import {getPublicCorsHeaders} from './config';
import {isPublicEndpointRateLimited} from './rate_limits';

const publicCacheHeaders = {
  ...getPublicCorsHeaders(),
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
};

export async function handleListPublicEvents(
  ctx: ActionCtx,
  request: Request,
): Promise<Response> {
  if (await isPublicEndpointRateLimited(ctx, request, 'listPublicEvents')) {
    return new Response('Too Many Requests', {
      status: 429,
      headers: {
        ...getPublicCorsHeaders(),
        'Cache-Control': 'no-store',
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
