import {isRateLimitError} from '@convex-dev/rate-limiter';
import {internal} from '../../_generated/api';
import type {ActionCtx} from '../../_generated/server';
import {getClientIp} from './request_parsing';

export type PublicEndpointRateLimitName =
  | 'listPublicEvents'
  | 'listPublicCommunity'
  | 'getPublicCommunityBySlug'
  | 'unsubscribeEndpoint';

export async function isPublicEndpointRateLimited(
  ctx: ActionCtx,
  request: Request,
  name: PublicEndpointRateLimitName,
): Promise<boolean> {
  // Header-derived IP is only the fallback key: limitPublicEndpoint prefers
  // the platform-provided client IP from ctx.meta (not client-spoofable),
  // which propagates into the nested mutation.
  const ip = getClientIp(request);
  try {
    await ctx.runMutation(internal.lib.rate_limits.limitPublicEndpoint, {
      name,
      key: ip,
    });
    return false;
  } catch (error) {
    if (!isRateLimitError(error)) {
      throw error;
    }
    return true;
  }
}
