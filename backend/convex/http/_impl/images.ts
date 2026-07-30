import {internal} from '../../_generated/api';
import type {ActionCtx} from '../../_generated/server';

const IMAGE_PATH_PREFIX = '/api/images/';

/** 404 with no caching — an unknown/unconfirmed id must not be cached. */
function notFound(): Response {
  return new Response('Not found', {
    status: 404,
    headers: {'Cache-Control': 'no-store'},
  });
}

/**
 * Public, durable image route: `GET /api/images/{storageId}`.
 *
 * Serves an inline email image by its Convex storage id. It only streams files
 * that were actually PUBLISHED in a sent rich email (`richEmailImages` record,
 * written atomically in the send transaction) AND passed magic-byte validation
 * on upload (`confirmedUploads` record). Any unknown, malformed, unpublished,
 * or unconfirmed id returns 404 — confirmed uploads that were never emailed
 * (posters, logos, abandoned drafts) are NOT exposed here. No auth — email
 * clients are unauthenticated — and a long immutable cache header since the id
 * is content-addressed.
 *
 * Served from CONVEX_SITE_URL (the `.convex.site` domain), the same api-site
 * base the unsubscribe routes use; emails build the URL from that base.
 */
export async function handlePublicImageGet(
  ctx: ActionCtx,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const prefixIndex = url.pathname.indexOf(IMAGE_PATH_PREFIX);
  if (prefixIndex < 0) {
    return notFound();
  }
  const rawId = url.pathname.slice(prefixIndex + IMAGE_PATH_PREFIX.length);
  if (rawId.length === 0) {
    return notFound();
  }

  let storageId: string;
  try {
    storageId = decodeURIComponent(rawId);
  } catch {
    return notFound();
  }

  const published = await ctx.runQuery(
    internal.storage.files.getPublishedEmailImage,
    {storageId},
  );
  if (published === null) {
    return notFound();
  }

  const blob = await ctx.storage.get(published.storageId);
  if (blob === null) {
    return notFound();
  }

  return new Response(blob, {
    status: 200,
    headers: {
      'Content-Type': published.contentType,
      // Never let the browser MIME-sniff user-uploaded bytes into an executable
      // type — defends against image/HTML polyglots served on the site domain.
      'X-Content-Type-Options': 'nosniff',
      // Content-addressed id → immutable, cache aggressively (1 year).
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
