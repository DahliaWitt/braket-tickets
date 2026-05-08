export function sanitizeInternalReturnUrl(
  returnUrl: string | null | undefined,
  fallback = '/',
): string {
  if (!returnUrl) {
    return fallback;
  }

  if (!returnUrl.startsWith('/') || returnUrl.startsWith('//')) {
    return fallback;
  }

  return returnUrl;
}

export function buildAuthCallbackUrl(
  path:
    | '/confirm/social-signin'
    | '/confirm/social-link'
    | '/confirm/verification',
  queryParams: Record<string, string | undefined> = {},
  origin: string,
): string {
  const callbackUrl = new URL(path, origin);
  for (const [key, value] of Object.entries(queryParams)) {
    if (value) {
      callbackUrl.searchParams.set(key, value);
    }
  }
  return callbackUrl.toString();
}
