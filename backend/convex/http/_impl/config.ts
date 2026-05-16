import {resolveSiteUrl} from '../../lib/site_url';
import {env} from '../../_generated/server';

export type HttpEnvironmentConfig = {
  allowedOrigins: string[];
  effectiveSiteUrl: string;
  emailSiteUrl: string;
};

export function resolveHttpEnvironmentConfig(): HttpEnvironmentConfig {
  // resolveSiteUrl() is the single source of truth for SITE_URL resolution.
  // It throws in production when unset and falls back to localhost under test.
  const effectiveSiteUrl = resolveSiteUrl();

  const allowLocalhost =
    env.ALLOW_LOCALHOST_CORS === 'true' ||
    effectiveSiteUrl.includes('localhost') ||
    effectiveSiteUrl.includes('127.0.0.1');

  const allowedOrigins = [
    effectiveSiteUrl,
    ...(allowLocalhost
      ? [
          'http://localhost:4200',
          'http://127.0.0.1:4200',
          'http://localhost:4201',
          'http://127.0.0.1:4201',
        ]
      : []),
  ];

  return {
    allowedOrigins,
    effectiveSiteUrl,
    emailSiteUrl: effectiveSiteUrl,
  };
}

export function getPublicCorsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
  };
}

export function getWriteCorsHeaders(
  origin: string | null,
  config: HttpEnvironmentConfig,
): Record<string, string> {
  if (origin && config.allowedOrigins.includes(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      Vary: 'Origin',
    };
  }
  return {
    'Access-Control-Allow-Origin': config.effectiveSiteUrl,
    Vary: 'Origin',
  };
}
