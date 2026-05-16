import type {ActionCtx, MutationCtx} from '../_generated/server';

import {
  isUnitTestRuntime,
  looksLikeProduction,
  looksLikeStaging,
} from './environment';
import {logger} from './logger';

export const ANALYTICS_SCHEMA_VERSION = 1 as const;

export type BackendAnalyticsEnvironment =
  | 'production'
  | 'preview'
  | 'development'
  | 'test';

export type BackendAnalyticsEventName =
  | 'ticket_order_opened'
  | 'checkout_completed'
  | 'checkout_failed'
  | 'checkout_abandoned'
  | 'tickets_issued'
  | 'payment_webhook_processed'
  | 'checkout_completed_without_tickets_issued'
  | 'ticket_checked_in'
  | 'ticket_checkin_failed'
  | 'vetting_application_submitted'
  | 'vetting_application_approved'
  | 'vetting_application_rejected'
  | 'event_published'
  | 'stripe_connect_onboarding_completed';

export type BackendActorRole =
  | 'guest'
  | 'user'
  | 'community_admin'
  | 'root_admin'
  | 'scanner'
  | 'system';

export type BackendAuthState = 'guest' | 'signed_in' | 'system';

export type BackendAnalyticsProperties = Record<string, unknown> & {
  schema_version?: typeof ANALYTICS_SCHEMA_VERSION;
  environment?: string;
  actor_role?: BackendActorRole;
  auth_state?: BackendAuthState;
  $process_person_profile?: false;
};

type AnalyticsCtx =
  | Pick<MutationCtx, 'scheduler'>
  | Pick<ActionCtx, 'scheduler'>;

type CaptureBackendEventInput = {
  distinctId: string;
  event: BackendAnalyticsEventName;
  properties?: BackendAnalyticsProperties;
  uuid?: string;
  processPersonProfile?: boolean;
};

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

function currentBackendAnalyticsEnvironment(): BackendAnalyticsEnvironment {
  if (isUnitTestRuntime()) {
    return 'test';
  }

  if (looksLikeProduction()) {
    return 'production';
  }

  if (looksLikeStaging()) {
    return 'preview';
  }

  return 'development';
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

export async function hashForAnalytics(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );

  return Array.from(new Uint8Array(digest.slice(0, 16)))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function systemDistinctId(system: 'stripe' | 'convex'): string {
  return `system:${system}`;
}

export function userDistinctId(userId: string): string {
  return userId;
}

export async function guestDistinctId(sessionToken: string): Promise<string> {
  return `guest:${await hashForAnalytics(sessionToken)}`;
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
  properties: BackendAnalyticsProperties = {},
): BackendAnalyticsProperties {
  const sanitized: BackendAnalyticsProperties = {
    schema_version: ANALYTICS_SCHEMA_VERSION,
    environment: currentBackendAnalyticsEnvironment(),
  };

  for (const [key, value] of Object.entries(properties)) {
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

export async function captureBackendEvent(
  ctx: AnalyticsCtx,
  input: CaptureBackendEventInput,
): Promise<void> {
  void ctx;
  const properties = sanitizeAnalyticsProperties(input.properties);

  if (input.processPersonProfile !== true) {
    properties['$process_person_profile'] = false;
  }

  logger.info('analytics', 'Backend analytics event captured locally', {
    distinctId: input.distinctId,
    event: input.event,
    properties,
    uuid: input.uuid,
  });
}
