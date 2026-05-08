import {describe, expect, it} from 'vitest';

import {sanitizeAnalyticsProperties} from './sanitize';

describe('sanitizeAnalyticsProperties', () => {
  it('redacts denylisted keys', () => {
    const result = sanitizeAnalyticsProperties({
      email: 'person@example.com',
      name: 'Person Example',
      message: 'secret message',
      token: 'abc123',
      client_secret: 'cs_test_123',
      raw_feedback: 'free text',
      guest_email: 'guest@example.com',
      qr: 'qr-payload',
      url: 'https://example.com/checkout?token=abc123',
    });

    expect(result).toEqual({
      email: '[redacted]',
      name: '[redacted]',
      message: '[redacted]',
      token: '[redacted]',
      client_secret: '[redacted]',
      raw_feedback: '[redacted]',
      guest_email: '[redacted]',
      qr: '[redacted]',
      url: '[redacted]',
    });
  });

  it('preserves route_template while normalizing its value', () => {
    const result = sanitizeAnalyticsProperties({
      route_template:
        'https://braket.local/events/01j2k3l4m5n6o7p8q9?r=checkout&token=abc123',
    });

    expect(result).toEqual({
      route_template: '/events/:id',
    });
  });

  it('normalizes native PostHog URL and path fields', () => {
    const result = sanitizeAnalyticsProperties({
      $current_url:
        'https://braket.local/admin-invite/demo-admin-invite-lot45?token=secret',
      $pathname: '/confirm/verification/short-token',
      $referrer: 'https://braket.local/invite/abcDEF123_-abcDEF123_-',
      attr__href: '/checkout/abcdefghijklmnopqrstuvwxyz?client_secret=secret',
      has_replay_url: true,
    });

    expect(result).toEqual({
      $current_url: '/admin-invite/:token',
      $pathname: '/confirm/verification/:token',
      $referrer: '/invite/:token',
      attr__href: '/checkout/:token',
      has_replay_url: true,
    });
  });

  it('preserves required safe metadata keys that overlap denylist words', () => {
    const result = sanitizeAnalyticsProperties({
      message_length: 42,
      has_replay_url: false,
      application_id_hash: 'deadbeef',
      ticket_id_hash: 'feedface',
      hostname: 'app.braket.local',
      className: 'checkout-button',
      strawberry: 'safe fruit',
    });

    expect(result).toEqual({
      message_length: 42,
      has_replay_url: false,
      application_id_hash: 'deadbeef',
      ticket_id_hash: 'feedface',
      hostname: 'app.braket.local',
      className: 'checkout-button',
      strawberry: 'safe fruit',
    });
  });

  it('passes through safe primitive values and truncates long strings', () => {
    const result = sanitizeAnalyticsProperties({
      title: 'A short title',
      count: 3,
      visible: true,
      nullable: null,
      tags: ['a', 'b'],
      long_text: 'x'.repeat(220),
    });

    expect(result).toEqual({
      title: 'A short title',
      count: 3,
      visible: true,
      nullable: null,
      tags: ['a', 'b'],
      long_text: `${'x'.repeat(200)}[truncated]`,
    });
  });

  it('redacts object arrays from autocapture payloads', () => {
    const result = sanitizeAnalyticsProperties({
      $elements: [{attr__href: '/admin-invite/demo-admin-invite-lot45'}],
      tags: ['safe', 'metadata'],
    });

    expect(result).toEqual({
      $elements: '[redacted]',
      tags: ['safe', 'metadata'],
    });
  });
});
