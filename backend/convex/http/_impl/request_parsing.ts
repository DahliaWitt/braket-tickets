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

export function getClientIp(request: Request): string {
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
  return 'unknown';
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
