export function resolveEmailApiBaseUrl(siteUrl: string): string {
  return process.env['CONVEX_SITE_URL'] ?? process.env['AUTH_BASE_URL'] ?? siteUrl;
}
