import {beforeEach, describe, expect, it, vi} from 'vitest';

const {warnMock, captureMock} = vi.hoisted(() => ({
  warnMock: vi.fn(),
  captureMock: vi.fn(),
}));

vi.mock('./logger', () => ({
  logger: {
    warn: warnMock,
  },
}));

vi.mock('../posthog', () => ({
  posthog: {
    capture: captureMock,
  },
}));

import {
  ANALYTICS_SCHEMA_VERSION,
  captureBackendEvent,
  guestDistinctId,
  hashForAnalytics,
  sanitizeAnalyticsProperties,
  systemDistinctId,
  userDistinctId,
} from './analytics';

describe('analytics helpers', () => {
  const originalEnv = {...process.env};

  beforeEach(() => {
    process.env = {...originalEnv};
    warnMock.mockReset();
    captureMock.mockReset();
  });

  it('redacts denylisted keys and non-primitive objects', () => {
    const result = sanitizeAnalyticsProperties({
      email: 'person@example.com',
      token: 'abc123',
      profile: {name: 'Person Example'},
      createdAt: new Date('2026-01-01'),
    });

    expect(result).toEqual({
      schema_version: ANALYTICS_SCHEMA_VERSION,
      environment: 'test',
      email: '[redacted]',
      token: '[redacted]',
      profile: '[redacted]',
      createdAt: '[redacted]',
    });
  });

  it('preserves hashed application ids while still redacting raw application fields', () => {
    const result = sanitizeAnalyticsProperties({
      application_id_hash: 'deadbeef',
      ticket_id_hash: 'feedface',
      application_notes: 'raw text',
      hostname: 'convex.braket.local',
      className: 'safe-class',
      strawberry: 'safe fruit',
    });

    expect(result).toEqual({
      schema_version: ANALYTICS_SCHEMA_VERSION,
      environment: 'test',
      application_id_hash: 'deadbeef',
      ticket_id_hash: 'feedface',
      application_notes: '[redacted]',
      hostname: 'convex.braket.local',
      className: 'safe-class',
      strawberry: 'safe fruit',
    });
  });

  it('truncates long strings and preserves safe primitive arrays', () => {
    const result = sanitizeAnalyticsProperties({
      short: 'ok',
      count: 3,
      enabled: true,
      nullable: null,
      tags: ['a', 'b', 'x'.repeat(220)],
      long_text: 'x'.repeat(220),
    });

    expect(result).toEqual({
      schema_version: ANALYTICS_SCHEMA_VERSION,
      environment: 'test',
      short: 'ok',
      count: 3,
      enabled: true,
      nullable: null,
      tags: ['a', 'b', `${'x'.repeat(200)}[truncated]`],
      long_text: `${'x'.repeat(200)}[truncated]`,
    });
  });

  it('redacts arrays containing objects or other non-primitive values', () => {
    const result = sanitizeAnalyticsProperties({
      tags: ['safe', 'metadata'],
      answers: ['redacted by key before array handling'],
      element_chain: [{attr__href: '/admin-invite/raw-token'}],
    });

    expect(result).toEqual({
      schema_version: ANALYTICS_SCHEMA_VERSION,
      environment: 'test',
      tags: ['safe', 'metadata'],
      answers: '[redacted]',
      element_chain: '[redacted]',
    });
  });

  it('sets schema and environment defaults even with empty properties', () => {
    expect(sanitizeAnalyticsProperties()).toEqual({
      schema_version: ANALYTICS_SCHEMA_VERSION,
      environment: 'test',
    });
  });

  it('creates system and user distinct IDs without rewriting user IDs', () => {
    expect(systemDistinctId('stripe')).toBe('system:stripe');
    expect(systemDistinctId('convex')).toBe('system:convex');
    expect(userDistinctId('user_123')).toBe('user_123');
  });

  it('hashes guest distinct IDs without exposing the raw session token', async () => {
    const sessionToken = 'session-secret-token-123';
    const distinctId = await guestDistinctId(sessionToken);

    expect(distinctId).toMatch(/^guest:[0-9a-f]{32}$/);
    expect(distinctId).not.toContain(sessionToken);
    await expect(hashForAnalytics(sessionToken)).resolves.toBe(
      distinctId.slice('guest:'.length),
    );
  });

  it('swallows PostHog failures and logs a warning', async () => {
    captureMock.mockRejectedValueOnce(new Error('boom'));

    await captureBackendEvent(
      {scheduler: {} as never},
      {
        distinctId: 'user_123',
        event: 'checkout_completed',
        properties: {message: 'should redact', safe: 'ok'},
        uuid: 'checkout_completed:user_123',
      },
    );

    expect(captureMock).toHaveBeenCalledWith(
      {scheduler: {} as never},
      expect.objectContaining({
        distinctId: 'user_123',
        event: 'checkout_completed',
        uuid: 'checkout_completed:user_123',
        disableGeoip: true,
        properties: expect.objectContaining({
          schema_version: ANALYTICS_SCHEMA_VERSION,
          environment: 'test',
          message: '[redacted]',
          safe: 'ok',
          $process_person_profile: false,
        }),
      }),
    );
    expect(warnMock).toHaveBeenCalledWith(
      'analytics',
      'PostHog capture failed',
      expect.objectContaining({
        event: 'checkout_completed',
        uuid: 'checkout_completed:user_123',
        error: 'boom',
      }),
    );
  });
});
