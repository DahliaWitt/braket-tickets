import {isRateLimitError} from '@convex-dev/rate-limiter';
import {internal} from '../../_generated/api';
import type {ActionCtx} from '../../_generated/server';
import {getClientIp} from './request_parsing';

export type PublicEndpointRateLimitName =
  | 'listPublicEvents'
  | 'listPublicCommunity'
  | 'getPublicCommunityBySlug'
  | 'unsubscribeEndpoint';

/**
 * Result of a public-endpoint rate-limit check.
 *
 * - `'allowed'`: request is within limits and may proceed.
 * - `'limited'`: request exceeded the rate limit; caller should return 429.
 * - `'missing-ip'`: request is missing both `x-real-ip` and `x-forwarded-for`,
 *   so we cannot bucket it safely. Caller should fail closed (400) instead of
 *   coalescing header-less traffic into a shared bucket. On Convex Cloud the
 *   platform proxy injects `x-forwarded-for`, so this branch is unreachable in
 *   production today and exists as defense-in-depth against topology changes.
 */
export type PublicEndpointRateLimitResult =
  | 'allowed'
  | 'limited'
  | 'missing-ip';

export async function checkPublicEndpointRateLimit(
  ctx: ActionCtx,
  request: Request,
  name: PublicEndpointRateLimitName,
): Promise<PublicEndpointRateLimitResult> {
  const ip = getClientIp(request);
  if (ip === null) {
    return 'missing-ip';
  }
  try {
    await ctx.runMutation(internal.lib.rate_limits.limitPublicEndpoint, {
      name,
      key: ip,
    });
    return 'allowed';
  } catch (error) {
    if (!isRateLimitError(error)) {
      throw error;
    }
    return 'limited';
  }
}
