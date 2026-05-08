const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONVEX_ID_RE = /^[a-z0-9]{17,}$/i;
const TOKEN_RE = /^[A-Za-z0-9_-]{24,}$/;

const TOKEN_PREVIOUS_SEGMENTS = new Set([
  'admin-invite',
  'apply',
  'invite',
  'invites',
  'join',
  'magic',
  'verification',
  'unsubscribe',
  'verify',
  'reset-password',
  'checkout',
]);

const ID_PREVIOUS_SEGMENTS = new Set([
  'events',
  'communities',
  'orders',
  'tickets',
  'guests',
  'applications',
  'trust-links',
  'resale',
]);

function normalizePath(pathOrUrl: string): string {
  try {
    return new URL(pathOrUrl, 'https://braket.local').pathname;
  } catch {
    const [path] = pathOrUrl.split('?');
    return path?.split('#')[0] ?? '/';
  }
}

function safeDecodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function toRouteTemplate(pathOrUrl: string): string {
  const segments = normalizePath(pathOrUrl)
    .split('/')
    .filter(Boolean)
    .map((segment) => safeDecodeSegment(segment));

  const templated = segments.map((segment, index) => {
    const previous = segments[index - 1];

    if (previous && TOKEN_PREVIOUS_SEGMENTS.has(previous)) {
      return ':token';
    }

    if (previous && ID_PREVIOUS_SEGMENTS.has(previous)) {
      return ':id';
    }

    if (UUID_RE.test(segment) || CONVEX_ID_RE.test(segment)) {
      return ':id';
    }

    if (TOKEN_RE.test(segment)) {
      return ':token';
    }

    return segment;
  });

  return `/${templated.join('/')}`;
}
