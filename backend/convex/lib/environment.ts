/**
 * Environment detection helpers with production safety guards.
 *
 * These prevent test-only code paths (mock payments, dev admin auto-promotion)
 * from activating on production deployments even if IS_TEST is misconfigured.
 */
import {logger} from './logger';

/** Known staging deployment URL — not production, but internet-facing. */
const STAGING_URL_FRAGMENT = 'bright-swordfish-194';
const STAGING_CONVEX_HOSTNAME = `${STAGING_URL_FRAGMENT}.convex.cloud`;
const MIN_SEED_TOKEN_LENGTH = 32;

function hostnameForUrl(value: string | undefined): string {
  try {
    return new URL(value ?? '').hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isConvexCloudUrl(value: string | undefined): boolean {
  return hostnameForUrl(value).endsWith('.convex.cloud');
}

/**
 * Returns true if the CONVEX_CLOUD_URL matches the known staging deployment.
 */
export function looksLikeStaging(): boolean {
  return (
    hostnameForUrl(process.env['CONVEX_CLOUD_URL']) === STAGING_CONVEX_HOSTNAME
  );
}

function isLocalUrl(value: string | undefined): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(value ?? '');
}

function looksLikeLocalDeployment(): boolean {
  return [
    process.env['CONVEX_CLOUD_URL'],
    process.env['CONVEX_SITE_URL'],
    process.env['E2E_CONVEX_SITE_URL'],
    process.env['AUTH_BASE_URL'],
    process.env['SITE_URL'],
  ].some((value) => isLocalUrl(value));
}

/**
 * Returns true if the CONVEX_CLOUD_URL looks like a production deployment
 * (i.e., a .convex.cloud URL that is NOT dev and NOT the known staging deployment).
 */
export function looksLikeProduction(): boolean {
  const url = process.env['CONVEX_CLOUD_URL'] ?? '';
  if (!isConvexCloudUrl(url)) return false;
  if (hostnameForUrl(url).includes('dev')) return false;
  if (looksLikeStaging()) return false;
  return true;
}

function seedDeploymentIsAllowed(): boolean {
  const cloudUrl = process.env['CONVEX_CLOUD_URL'];
  if (cloudUrl) {
    if (isLocalUrl(cloudUrl)) return true;
    if (looksLikeStaging()) return true;
    return false;
  }

  return looksLikeLocalDeployment();
}

/**
 * Returns true only when ALL conditions are met:
 * 1. IS_TEST env var is explicitly set to 'true'
 * 2. The deployment does NOT look like production
 * 3. The deployment is NOT staging (IS_TEST enables mock payments, which
 *    must never be active on any internet-facing deployment)
 *
 * This defense-in-depth approach prevents mock payments from leaking to
 * production or staging even if IS_TEST is accidentally set.
 */
export function isTestEnvironment(): boolean {
  if (process.env['IS_TEST'] !== 'true') {
    return false;
  }

  if (looksLikeProduction() || looksLikeStaging()) {
    logger.error(
      'environment',
      '[SECURITY] IS_TEST=true on a production-like deployment. ' +
        'Test mode BLOCKED. Remove IS_TEST from production environment variables.',
    );
    return false;
  }

  return true;
}

/**
 * Returns true only when BOTH conditions are met:
 * 1. DEV_SEED env var is explicitly set to 'true'
 * 2. The deployment does NOT look like production
 *
 * DEV_SEED records deployment-side seed intent. It must be paired with a
 * short-lived DEV_SEED_TOKEN before public seed facade functions run, and it
 * does NOT authorize api.testing.* helpers or bypass payment processing.
 * Set it temporarily when seeding, then unset it.
 */
export function isDevSeedEnvironment(): boolean {
  if (process.env['DEV_SEED'] !== 'true') {
    return false;
  }

  if (!seedDeploymentIsAllowed()) {
    logger.error(
      'environment',
      '[SECURITY] DEV_SEED=true on a deployment that is not explicitly seed-enabled. ' +
        'Dev seeding BLOCKED. Remove DEV_SEED from this environment.',
    );
    return false;
  }

  return true;
}

function constantTimeEquals(a: string, b: string): boolean {
  const maxLength = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < maxLength; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export function isSeedAuthorized(seedToken: string, now = Date.now()): boolean {
  if (!isDevSeedEnvironment()) {
    return false;
  }

  const expectedToken = process.env['DEV_SEED_TOKEN'] ?? '';
  if (
    seedToken.length < MIN_SEED_TOKEN_LENGTH ||
    expectedToken.length < MIN_SEED_TOKEN_LENGTH ||
    !constantTimeEquals(seedToken, expectedToken)
  ) {
    logger.error(
      'environment',
      '[SECURITY] Seed authorization failed: invalid DEV_SEED_TOKEN.',
    );
    return false;
  }

  const expiresAt = Number(process.env['DEV_SEED_EXPIRES_AT'] ?? '');
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    logger.error(
      'environment',
      '[SECURITY] Seed authorization failed: DEV_SEED_EXPIRES_AT is missing or expired.',
    );
    return false;
  }

  return true;
}

export function requireSeedAuthorization(
  seedToken: string,
  now = Date.now(),
): void {
  if (!isSeedAuthorized(seedToken, now)) {
    throw new Error('Seed authorization failed');
  }
}

/**
 * Returns true when executing inside backend unit tests (Vitest).
 *
 * Unlike IS_TEST, this is process-local and cannot be set via deployment
 * environment variables, so it's safe for test harness branching.
 */
export function isUnitTestRuntime(): boolean {
  return process.env['VITEST'] === 'true';
}

/**
 * Incident kill switch for the Better Auth haveIBeenPwned breach check.
 *
 * The plugin fails closed: if the HIBP range API is unreachable, sign-up and
 * password reset are blocked with an INTERNAL_SERVER_ERROR. During an HIBP
 * outage, set AUTH_HIBP_DISABLED=true on the affected Convex deployment to
 * skip the check entirely — an env-only change, no code deploy required.
 * See docs/runbooks/auth-incidents.md.
 */
export function isHibpPasswordCheckDisabled(): boolean {
  return process.env['AUTH_HIBP_DISABLED'] === 'true';
}
