import {
  RICH_TEXT_IMAGE_URL_SCHEMES,
  RICH_TEXT_LINK_URL_SCHEMES,
} from '@shared/email/rich-text-schema';

/**
 * Client-side URL scheme guards mirroring the backend security spine.
 *
 * These are defense-in-depth for UX (blocking obviously bad URLs before they
 * ever reach the editor document). The backend validator remains the
 * authoritative gate — it re-validates every href/src on send and fails closed.
 */

/** Extracts the lowercased URL scheme (without trailing `:`), or null if the
 * value is not an absolute URL (relative / scheme-relative / malformed). */
function schemeOf(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  try {
    // `new URL` requires an absolute URL; relative/scheme-relative inputs throw,
    // which we treat as rejected (fail closed, matching the backend).
    return new URL(trimmed).protocol.replace(/:$/, '').toLowerCase();
  } catch {
    return null;
  }
}

/** True when `raw` is an absolute URL using an allowlisted link scheme
 * (http / https / mailto). */
export function isAllowedLinkUrl(raw: string): boolean {
  const scheme = schemeOf(raw);
  return (
    scheme !== null &&
    (RICH_TEXT_LINK_URL_SCHEMES as readonly string[]).includes(scheme)
  );
}

/** True when `raw` is an absolute URL using an allowlisted image scheme
 * (http / https). Applies only to the composer's signed PREVIEW url — the
 * emailed image src is a durable server-owned route the backend derives from
 * the confirmed storageId, not this value. Defensive UX guard only. */
export function isAllowedImageUrl(raw: string): boolean {
  const scheme = schemeOf(raw);
  return (
    scheme !== null &&
    (RICH_TEXT_IMAGE_URL_SCHEMES as readonly string[]).includes(scheme)
  );
}
