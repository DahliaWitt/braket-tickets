/**
 * Single source of truth for the public-facing site URL used when building
 * redirect links handed to third-party services (Stripe Connect, Better Auth
 * social callbacks, transactional email links).
 *
 * - Production / staging: requires process.env.SITE_URL. Throws otherwise.
 * - Unit-test / IS_TEST runtime: falls back to http://localhost:4200 so
 *   tests do not have to manage env vars.
 *
 * All backend callers should import `resolveSiteUrl` instead of reading
 * `process.env.SITE_URL` directly. See AGENTS.md for the rationale.
 */
import {isTestEnvironment, isUnitTestRuntime} from './environment';

const LOCAL_FALLBACK = 'http://localhost:4200';

export function resolveSiteUrl(): string {
  const siteUrl = process.env.SITE_URL;
  if (siteUrl) return stripTrailingSlash(siteUrl);
  if (isUnitTestRuntime() || isTestEnvironment()) return LOCAL_FALLBACK;
  throw new Error(
    'SITE_URL is not set. Set it in the Convex environment for this deployment.',
  );
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}
