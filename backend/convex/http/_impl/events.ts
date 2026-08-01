import {internal} from '../../_generated/api';
import type {ActionCtx} from '../../_generated/server';
import {getPublicCorsHeaders} from './config';
import {isPublicEndpointRateLimited} from './rate_limits';

const publicCacheHeaders = {
  ...getPublicCorsHeaders(),
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
};

const uncachedNotFoundHeaders = {
  ...getPublicCorsHeaders(),
  'Cache-Control': 'no-store',
};

const EVENT_PREVIEW_PATH_PREFIX = '/api/events/';

function notFoundResponse(): Response {
  // Never cache negatives: drafts may publish, so a cached 404 could shadow
  // a soon-to-be-visible event. Also keeps the response identical for a
  // missing id and a denied (unpublished/private) one — no existence oracle.
  return new Response('Not Found', {
    status: 404,
    headers: uncachedNotFoundHeaders,
  });
}

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

/**
 * Public, unauthenticated single-event preview: `GET /api/events/{id}`.
 *
 * Backs OG meta injection for `/events/:id` link unfurling. Rate-limited
 * BEFORE parsing the id — deliberately, unlike `handleGetPublicCommunityBySlug`
 * — so a flood of cheap 404s isn't free. `/api/events/upcoming` keeps
 * precedence over this prefix route (Convex checks `exactRoutes` before
 * `prefixRoutes`), the same pattern as `/api/communities` + `/api/communities/`.
 */
export async function handleGetPublicEventPreview(
  ctx: ActionCtx,
  request: Request,
): Promise<Response> {
  if (
    await isPublicEndpointRateLimited(ctx, request, 'getPublicEventPreview')
  ) {
    return new Response('Too Many Requests', {
      status: 429,
      headers: {
        ...uncachedNotFoundHeaders,
        'Retry-After': '60',
      },
    });
  }

  const url = new URL(request.url);
  const prefixIndex = url.pathname.indexOf(EVENT_PREVIEW_PATH_PREFIX);
  const id =
    prefixIndex < 0
      ? ''
      : url.pathname.slice(prefixIndex + EVENT_PREVIEW_PATH_PREFIX.length);

  if (id.length === 0 || id.includes('/')) {
    return notFoundResponse();
  }

  const preview = await ctx.runQuery(
    internal.events.public.getPublicEventPreviewInternal,
    {id},
  );

  if (preview === null) {
    return notFoundResponse();
  }

  return new Response(JSON.stringify(preview), {
    status: 200,
    headers: {
      ...getPublicCorsHeaders(),
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
    },
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
