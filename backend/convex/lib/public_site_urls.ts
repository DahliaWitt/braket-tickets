import {env} from '../_generated/server';

export function resolveEmailApiBaseUrl(siteUrl: string): string {
  return env.CONVEX_SITE_URL ?? env.AUTH_BASE_URL ?? siteUrl;
}
