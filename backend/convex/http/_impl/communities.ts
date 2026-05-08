import {internal} from '../../_generated/api';
import type {ActionCtx} from '../../_generated/server';
import {getPublicCorsHeaders} from './config';
import {parseCommunitySlugFromPath} from './request_parsing';
import {getAppErrorMessage} from '../../lib/errors';
import {isPublicEndpointRateLimited} from './rate_limits';

const publicJsonHeaders = {
  ...getPublicCorsHeaders(),
  'Content-Type': 'application/json',
};

const publicCacheHeaders = {
  ...publicJsonHeaders,
  'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
};

const uncachedPublicErrorHeaders = {
  ...getPublicCorsHeaders(),
  'Cache-Control': 'no-store',
};

const publicCommunitiesCapacityErrorMarkers = [
  'Public directory opted-in community scan exceeded',
  'Public directory published event scan exceeded',
  'Public community slug event scan exceeded',
] as const;

function isPublicCommunitiesCapacityError(error: unknown): boolean {
  const message = getAppErrorMessage(error);
  return (
    message !== null &&
    publicCommunitiesCapacityErrorMarkers.some((marker) =>
      message.includes(marker),
    )
  );
}

function serviceUnavailableResponse(): Response {
  return new Response('Service Unavailable', {
    status: 503,
    headers: uncachedPublicErrorHeaders,
  });
}

export async function handleListPublicCommunities(
  ctx: ActionCtx,
  request: Request,
): Promise<Response> {
  if (await isPublicEndpointRateLimited(ctx, request, 'listPublicCommunity')) {
    return new Response('Too Many Requests', {
      status: 429,
      headers: {
        ...getPublicCorsHeaders(),
        'Retry-After': '60',
      },
    });
  }

  let communities;
  try {
    communities = await ctx.runQuery(
      internal.communities.directory.listPublicDirectoryInternal,
      {},
    );
  } catch (error) {
    if (isPublicCommunitiesCapacityError(error)) {
      return serviceUnavailableResponse();
    }
    throw error;
  }

  return new Response(JSON.stringify(communities), {
    status: 200,
    headers: publicCacheHeaders,
  });
}

export async function handleGetPublicCommunityBySlug(
  ctx: ActionCtx,
  request: Request,
): Promise<Response> {
  const slug = parseCommunitySlugFromPath(request);
  if (!slug) {
    return new Response('Not Found', {
      status: 404,
      headers: getPublicCorsHeaders(),
    });
  }

  if (
    await isPublicEndpointRateLimited(ctx, request, 'getPublicCommunityBySlug')
  ) {
    return new Response('Too Many Requests', {
      status: 429,
      headers: {
        ...getPublicCorsHeaders(),
        'Retry-After': '60',
      },
    });
  }

  let community;
  try {
    community = await ctx.runQuery(
      internal.communities.directory.getBySlugInternal,
      {
        slug,
      },
    );
  } catch (error) {
    if (isPublicCommunitiesCapacityError(error)) {
      return serviceUnavailableResponse();
    }
    throw error;
  }

  if (!community) {
    return new Response('Not Found', {
      status: 404,
      headers: getPublicCorsHeaders(),
    });
  }

  return new Response(JSON.stringify(community), {
    status: 200,
    headers: publicCacheHeaders,
  });
}

export async function handlePublicCommunitiesOptions(): Promise<Response> {
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
