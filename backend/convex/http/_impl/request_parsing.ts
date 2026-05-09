import {isRecord} from '@shared/type-guards';
import type {Id} from '../../_generated/dataModel';

export type UnsubscribeToggleBody = {
  token: string;
  optedIn: boolean;
  organizerId?: Id<'organizers'>;
};

export type UnsubscribeAllBody = {
  token: string;
};

export function parseUnsubscribeToggleBody(
  body: unknown,
): UnsubscribeToggleBody | null {
  if (!isRecord(body)) return null;
  const token = body['token'];
  const optedIn = body['optedIn'];
  const organizerId = body['organizerId'];
  if (typeof token !== 'string' || typeof optedIn !== 'boolean') return null;
  if (organizerId !== undefined && typeof organizerId !== 'string') return null;
  return {
    token,
    optedIn,
    ...(organizerId !== undefined
      ? {organizerId: organizerId as Id<'organizers'>}
      : {}),
  };
}

export function parseUnsubscribeAllBody(
  body: unknown,
): UnsubscribeAllBody | null {
  if (!isRecord(body)) return null;
  const token = body['token'];
  if (typeof token !== 'string') return null;
  return {token};
}

const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set([
  '127.0.0.1',
  'localhost',
  '::1',
]);

/**
 * Resolve the client IP from proxy headers.
 *
 * Returns `null` when neither `x-real-ip` nor `x-forwarded-for` is present
 * AND the request hostname is not loopback. On Convex Cloud the platform proxy
 * always injects `x-forwarded-for`, so production traffic always returns a real
 * IP. Self-hosted dev/E2E backends accept requests on `127.0.0.1`/`localhost`
 * with no proxy in front; for those we return a stable `'loopback'` sentinel so
 * rate limiting still works without coalescing real header-less production
 * traffic into a shared bucket. Callers MUST treat a `null` result as a hard
 * failure (e.g. 400 Bad Request).
 */
export function getClientIp(request: Request): string | null {
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    const trimmed = realIp.trim();
    if (trimmed) return trimmed;
  }
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0];
    if (first) {
      const trimmed = first.trim();
      if (trimmed) return trimmed;
    }
  }
  try {
    const hostname = new URL(request.url).hostname;
    if (LOOPBACK_HOSTNAMES.has(hostname)) {
      return 'loopback';
    }
  } catch {
    // Unparseable URL falls through to null.
  }
  return null;
}

export function parseCommunitySlugFromPath(request: Request): string | null {
  const pathPrefix = '/api/communities/';
  const url = new URL(request.url);
  let slug: string;
  try {
    slug = decodeURIComponent(url.pathname.slice(pathPrefix.length));
  } catch {
    return null;
  }
  if (!slug || slug.includes('/')) return null;
  return slug;
}
