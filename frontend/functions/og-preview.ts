import type {PublicEventPreview} from '@shared/contracts/public-event';
import {isSpaShellFallback, type PagesAssetEnvironment} from './asset-miss';

/**
 * Injects per-event OG meta tags into the SPA shell for `/events/:id` so
 * links shared in messaging apps unfurl with the event's flier, title, and
 * details instead of the static Braket logo. Fails open to the untouched
 * shell response on any error — this must never throw and must never break
 * a normal page load.
 */

const EVENT_PREVIEW_PATH_PATTERN = /^\/events\/([A-Za-z0-9_-]+)\/?$/;
const ID_CHARSET_PATTERN = /^[A-Za-z0-9_-]+$/;

const PREVIEW_FETCH_TIMEOUT_MS = 1500;
const PREVIEW_CACHE_TTL_SECONDS = 300;
const OG_DESCRIPTION_MAX_LENGTH = 200;

const TITLE_TAG_PATTERN = /<title>[^<]*<\/title>/;
const OG_TITLE_META_PATTERN = /<meta\b[^>]*\bproperty="og:title"[^>]*>/;
const OG_DESCRIPTION_META_PATTERN =
  /<meta\b[^>]*\bproperty="og:description"[^>]*>/;
const OG_IMAGE_META_PATTERN = /<meta\b[^>]*\bproperty="og:image"[^>]*>/;
const OG_URL_META_PATTERN = /<meta\b[^>]*\bproperty="og:url"[^>]*>/;
const TWITTER_CARD_META_PATTERN = /<meta\b[^>]*\bname="twitter:card"[^>]*>/;

/**
 * Minimal ambient type for the Cloudflare Workers `cf` fetch option. This
 * directory hand-rolls its Pages types rather than depending on
 * `@cloudflare/workers-types`, so only the properties actually used here
 * are declared.
 */
type CfFetchInit = RequestInit & {
  cf?: {
    cacheTtlByStatus?: Record<string, number>;
    cacheEverything?: boolean;
  };
};

/**
 * Extracts the raw event id segment from a pathname matching
 * `/events/:id` (optional trailing slash), or `null` if the pathname isn't
 * an event preview route.
 */
export function matchEventPreviewPath(pathname: string): string | null {
  const match = EVENT_PREVIEW_PATH_PATTERN.exec(pathname);
  return match ? (match[1] ?? null) : null;
}

/**
 * Defense-in-depth charset guard applied to the extracted id before it
 * reaches an outbound fetch URL. The path regex above already constrains
 * this charset, but the id is re-validated explicitly so a future change to
 * the routing match can never smuggle `/ ? # %` (or other SSRF/path
 * traversal payloads) into the upstream request.
 */
export function isValidEventId(id: string): boolean {
  return ID_CHARSET_PATTERN.test(id);
}

/** Escapes a string for safe use inside an HTML attribute value or text node. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncate(text: string, maxLength: number): string {
  // Measure and slice by Unicode code points, not UTF-16 code units, so an
  // emoji (surrogate pair) at the cut boundary is never split into a lone
  // surrogate that renders as U+FFFD.
  const codePoints = Array.from(text);
  if (codePoints.length <= maxLength) {
    return text;
  }
  return `${codePoints
    .slice(0, maxLength - 1)
    .join('')
    .trimEnd()}…`;
}

/**
 * Runtime type guard narrowing an untrusted parsed-JSON value to
 * `PublicEventPreview`. Only checks the fields this module actually reads
 * (`title`, `dateLabel`, `description`, `location`, `posterUrl`) — the wire
 * payload is never trusted regardless of what the shared contract declares.
 */
function isPublicEventPreview(value: unknown): value is PublicEventPreview {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.title === 'string' &&
    record.title.length > 0 &&
    typeof record.dateLabel === 'string' &&
    (record.description === undefined ||
      typeof record.description === 'string') &&
    (record.location === undefined || typeof record.location === 'string') &&
    (record.posterUrl === null || typeof record.posterUrl === 'string')
  );
}

/**
 * Extra defense-in-depth on top of the backend's https-only guarantee
 * (spec Section 3): only ever interpolate an `https://` poster URL into the
 * shell. Any other scheme (or a backend regression) degrades gracefully to
 * "no poster" rather than failing the whole preview.
 */
function getSafePosterUrl(preview: PublicEventPreview): string | null {
  return preview.posterUrl && preview.posterUrl.startsWith('https://')
    ? preview.posterUrl
    : null;
}

function buildDescriptionText(preview: PublicEventPreview): string {
  const head = preview.location
    ? `${preview.dateLabel} · ${preview.location}`
    : preview.dateLabel;
  return preview.description ? `${head} — ${preview.description}` : head;
}

function rewriteMetaContent(
  html: string,
  pattern: RegExp,
  newContent: string,
): string {
  return html.replace(pattern, (tag) =>
    tag.replace(/content="[^"]*"/, `content="${newContent}"`),
  );
}

/**
 * Rewrites the SPA shell's static meta tags to reflect a specific event.
 * Every interpolated value is HTML-escaped. Replacement targets key on the
 * tag's `property`/`name` attribute, not on the shell's current content
 * values, so this stays correct regardless of the static defaults in
 * `frontend/src/index.html`.
 */
export function rewriteShellHtml(
  html: string,
  preview: PublicEventPreview,
  pageUrl: URL,
): string {
  const pageTitle = escapeHtml(`${preview.title} · Braket`);
  let rewritten = html.replace(
    TITLE_TAG_PATTERN,
    `<title>${pageTitle}</title>`,
  );
  rewritten = rewriteMetaContent(rewritten, OG_TITLE_META_PATTERN, pageTitle);

  const ogDescription = escapeHtml(
    truncate(buildDescriptionText(preview), OG_DESCRIPTION_MAX_LENGTH),
  );
  rewritten = rewriteMetaContent(
    rewritten,
    OG_DESCRIPTION_META_PATTERN,
    ogDescription,
  );

  const ogUrl = escapeHtml(`${pageUrl.origin}${pageUrl.pathname}`);
  rewritten = rewriteMetaContent(rewritten, OG_URL_META_PATTERN, ogUrl);

  const posterUrl = getSafePosterUrl(preview);
  if (posterUrl) {
    const escapedPosterUrl = escapeHtml(posterUrl);
    const escapedAlt = escapeHtml(`${preview.title} flier`);
    rewritten = rewritten.replace(OG_IMAGE_META_PATTERN, (tag) => {
      const updatedTag = tag.replace(
        /content="[^"]*"/,
        `content="${escapedPosterUrl}"`,
      );
      return `${updatedTag}\n    <meta property="og:image:alt" content="${escapedAlt}" />`;
    });
    rewritten = rewriteMetaContent(
      rewritten,
      TWITTER_CARD_META_PATTERN,
      'summary_large_image',
    );
  }

  return rewritten;
}

function buildPreviewFetchUrl(convexSiteUrl: string, eventId: string): string {
  const base = convexSiteUrl.replace(/\/+$/, '');
  return `${base}/api/events/${eventId}`;
}

async function fetchEventPreview(
  convexSiteUrl: string,
  eventId: string,
): Promise<PublicEventPreview | null> {
  const fetchInit: CfFetchInit = {
    signal: AbortSignal.timeout(PREVIEW_FETCH_TIMEOUT_MS),
    cf: {
      // Cache successes only. A flat cacheTtl would colo-cache 404s for the
      // full TTL despite the origin's no-store — a draft event shared just
      // before publishing would keep unfurling generic for 5 minutes. A TTL
      // of 0 means "do not cache" for that status range.
      cacheTtlByStatus: {
        '200-299': PREVIEW_CACHE_TTL_SECONDS,
        '400-599': 0,
      },
      cacheEverything: true,
    },
  };

  const response = await fetch(
    buildPreviewFetchUrl(convexSiteUrl, eventId),
    fetchInit,
  );

  if (!response.ok) {
    return null;
  }

  const payload: unknown = await response.json();
  return isPublicEventPreview(payload) ? payload : null;
}

/**
 * Orchestrates the OG-preview rewrite for a single asset response. Applies
 * only to GET requests whose pathname matches `/events/:id` and whose asset
 * response is the HTML SPA shell — any other request (guarded-asset 404s,
 * non-HTML responses, non-event paths) is returned untouched.
 *
 * Fails open on any error: missing/empty `CONVEX_SITE_URL`, an invalid id,
 * a rejected/timed-out/non-200 fetch, or unparsable JSON all fall through
 * to returning the original, untouched `assetResponse`.
 */
export async function applyEventPreview(
  request: Request,
  env: PagesAssetEnvironment,
  assetResponse: Response,
): Promise<Response> {
  try {
    if (request.method !== 'GET') {
      return assetResponse;
    }

    const url = new URL(request.url);
    const eventId = matchEventPreviewPath(url.pathname);
    if (!eventId) {
      return assetResponse;
    }

    if (!isSpaShellFallback(assetResponse)) {
      return assetResponse;
    }

    const convexSiteUrl = env.CONVEX_SITE_URL;
    if (!convexSiteUrl) {
      return assetResponse;
    }

    if (!isValidEventId(eventId)) {
      return assetResponse;
    }

    const preview = await fetchEventPreview(convexSiteUrl, eventId);
    if (!preview) {
      return assetResponse;
    }

    // Clone before reading so the original, unconsumed response remains
    // available as the fail-open fallback for any error below this point.
    const shellHtml = await assetResponse.clone().text();
    const rewrittenHtml = rewriteShellHtml(shellHtml, preview, url);

    const rewritten = new Response(rewrittenHtml, assetResponse);
    rewritten.headers.delete('Content-Length');
    rewritten.headers.delete('Content-Encoding');
    rewritten.headers.delete('ETag');
    return rewritten;
  } catch {
    return assetResponse;
  }
}
