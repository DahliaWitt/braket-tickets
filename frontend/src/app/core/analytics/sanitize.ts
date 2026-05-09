import type {CapturedNetworkRequest} from 'posthog-js';

import {toRouteTemplate} from './route-template';

export type AnalyticsProperties = Record<string, unknown>;

const DENYLIST_KEY_PARTS = [
  'email',
  'name',
  'phone',
  'address',
  'message',
  'description',
  'answer',
  'answers',
  'application',
  'token',
  'secret',
  'client_secret',
  'password',
  'qr',
  'magic',
  'link_url',
  'url',
  'raw',
  'buyer',
  'guest_email',
  'customer',
] as const;

const MAX_STRING_LENGTH = 200;
const ALLOWED_DENYLIST_OVERLAP_KEYS = new Set([
  'message_length',
  'has_replay_url',
]);
const POSTHOG_REPLAY_HOSTS = new Set(['us.posthog.com', 'eu.posthog.com']);

interface SanitizeAnalyticsOptions {
  allowFeedbackMessage?: boolean;
}

function keySegments(key: string): string[] {
  return key
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function includesSegmentSequence(segments: string[], phrase: string): boolean {
  const phraseSegments = phrase.split('_');
  if (phraseSegments.length > segments.length) {
    return false;
  }

  return segments.some((_, index) =>
    phraseSegments.every(
      (segment, offset) => segments[index + offset] === segment,
    ),
  );
}

function isDeniedKey(key: string): boolean {
  const lowered = key.toLowerCase();
  if (lowered.endsWith('_id_hash')) {
    return false;
  }

  const segments = keySegments(lowered);
  return DENYLIST_KEY_PARTS.some((part) =>
    includesSegmentSequence(segments, part),
  );
}

function isRouteLikeKey(key: string): boolean {
  const lowered = key.toLowerCase();
  return (
    lowered === 'route_template' ||
    lowered === '$current_url' ||
    lowered === 'current_url' ||
    lowered.endsWith('_url') ||
    lowered === '$pathname' ||
    lowered === 'pathname' ||
    lowered.endsWith('_pathname') ||
    lowered === '$referrer' ||
    lowered === 'referrer' ||
    lowered.endsWith('_referrer') ||
    lowered.includes('href')
  );
}

function isPostHogReplayUrl(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  try {
    const url = new URL(value);
    const pathSegments = url.pathname.split('/').filter(Boolean);
    const searchKeys = [...url.searchParams.keys()];
    return (
      url.protocol === 'https:' &&
      POSTHOG_REPLAY_HOSTS.has(url.hostname) &&
      url.username === '' &&
      url.password === '' &&
      url.hash === '' &&
      pathSegments.length === 4 &&
      pathSegments[0] === 'project' &&
      pathSegments[1].length > 0 &&
      pathSegments[2] === 'replay' &&
      pathSegments[3].length > 0 &&
      (url.search === '' ||
        (searchKeys.length === 1 &&
          searchKeys[0] === 't' &&
          /^\d+$/.test(url.searchParams.get('t') ?? '')))
    );
  } catch {
    return false;
  }
}

function sanitizeArrayValue(value: unknown[]): unknown[] | '[redacted]' {
  const safePrimitives = value.every(
    (item) =>
      typeof item === 'string' ||
      typeof item === 'number' ||
      typeof item === 'boolean' ||
      item === null,
  );

  if (!safePrimitives) {
    return '[redacted]';
  }

  return value.map((item) =>
    typeof item === 'string' && item.length > MAX_STRING_LENGTH
      ? `${item.slice(0, MAX_STRING_LENGTH)}[truncated]`
      : item,
  );
}

export function sanitizeAnalyticsProperties(
  properties: AnalyticsProperties = {},
  options: SanitizeAnalyticsOptions = {},
): AnalyticsProperties {
  const sanitized: AnalyticsProperties = {};

  for (const [key, value] of Object.entries(properties)) {
    if (key === 'feedback_message') {
      sanitized[key] =
        options.allowFeedbackMessage && typeof value === 'string'
          ? value
          : '[redacted]';
      continue;
    }

    if (key === 'feedback_replay_url') {
      sanitized[key] = isPostHogReplayUrl(value) ? value : '[redacted]';
      continue;
    }

    if (ALLOWED_DENYLIST_OVERLAP_KEYS.has(key)) {
      sanitized[key] = value;
      continue;
    }

    if (isRouteLikeKey(key)) {
      sanitized[key] =
        typeof value === 'string' ? toRouteTemplate(value) : '[redacted]';
      continue;
    }

    if (isDeniedKey(key)) {
      sanitized[key] = '[redacted]';
      continue;
    }

    if (typeof value === 'string') {
      sanitized[key] =
        value.length > MAX_STRING_LENGTH
          ? `${value.slice(0, MAX_STRING_LENGTH)}[truncated]`
          : value;
      continue;
    }

    if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null
    ) {
      sanitized[key] = value;
      continue;
    }

    if (Array.isArray(value)) {
      sanitized[key] = sanitizeArrayValue(value);
      continue;
    }

    if (value !== undefined) {
      sanitized[key] = '[redacted]';
    }
  }

  return sanitized;
}

export function sanitizeReplayNetworkRequest(
  request: CapturedNetworkRequest & {url?: string},
): CapturedNetworkRequest & {
  url?: string;
  requestHeaders?: undefined;
  responseHeaders?: undefined;
  requestBody?: undefined;
  responseBody?: undefined;
} {
  const sourceUrl = request.url ?? request.name;
  const routeTemplate = sourceUrl ? toRouteTemplate(sourceUrl) : request.name;

  return {
    ...request,
    name: routeTemplate,
    url: request.url ? routeTemplate : undefined,
    requestHeaders: undefined,
    responseHeaders: undefined,
    requestBody: undefined,
    responseBody: undefined,
  };
}
