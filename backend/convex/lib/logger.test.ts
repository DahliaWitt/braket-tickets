import {describe, expect, it, vi, beforeEach, afterEach} from 'vitest';
import {logger, sanitize} from './logger';

describe('sanitize', () => {
  it('redacts sensitive object fields', () => {
    const input = {
      displayName: 'alice',
      password: 'hunter2',
      apiKey: 'sk_live_abc',
      email: 'alice@example.com',
    };
    const result = sanitize(input);
    expect(result).toEqual({
      displayName: 'alice',
      password: '[REDACTED]',
      apiKey: '[REDACTED]',
      email: '[REDACTED]',
    });
  });

  it('redacts email patterns in strings', () => {
    const result = sanitize('Contact user@example.com for details');
    expect(result).toBe('Contact [REDACTED] for details');
  });

  it('redacts phone numbers in strings', () => {
    const result = sanitize('Call me at (415) 555-1234 today');
    expect(result).toBe('Call me at [REDACTED] today');
  });

  it('redacts US social security numbers in strings', () => {
    const result = sanitize('SSN 123-45-6789 was submitted');
    expect(result).toBe('SSN [REDACTED] was submitted');
  });

  it('redacts card-like numbers that pass Luhn validation', () => {
    const result = sanitize('Card 4242 4242 4242 4242 declined');
    expect(result).toBe('Card [REDACTED] declined');
  });

  it('handles nested objects', () => {
    const input = {user: {name: 'Bob', sessionToken: 'abc123'}};
    const result = sanitize(input);
    expect(result).toEqual({user: {name: 'Bob', sessionToken: '[REDACTED]'}});
  });

  it('handles arrays', () => {
    const result = sanitize([{token: 'xyz'}, {name: 'ok'}]);
    expect(result).toEqual([{token: '[REDACTED]'}, {name: 'ok'}]);
  });

  it('handles null and undefined', () => {
    expect(sanitize(null)).toBeNull();
    expect(sanitize(undefined)).toBeUndefined();
  });

  it('handles Error objects', () => {
    const err = new Error('failed for user@test.com');
    const result = sanitize(err);
    expect(result.message).toBe('failed for [REDACTED]');
    expect(result).toBeInstanceOf(Error);
  });

  it('handles Date objects', () => {
    const date = new Date('2026-01-01');
    const result = sanitize(date);
    expect(result).toEqual(date);
    expect(result).not.toBe(date);
  });

  it('preserves primitives', () => {
    expect(sanitize(42)).toBe(42);
    expect(sanitize(true)).toBe(true);
    expect(sanitize('safe string')).toBe('safe string');
  });

  it('redacts case-insensitive field matches', () => {
    const input = {AccessToken: 'bearer xyz', CreditCard: '4111...'};
    const result = sanitize(input);
    expect(result).toEqual({
      AccessToken: '[REDACTED]',
      CreditCard: '[REDACTED]',
    });
  });

  it('redacts Convex-specific fields', () => {
    const input = {convexToken: 'ct_abc', adminKey: 'ak_123', data: 'ok'};
    const result = sanitize(input);
    expect(result).toEqual({
      convexToken: '[REDACTED]',
      adminKey: '[REDACTED]',
      data: 'ok',
    });
  });
});

describe('logger', () => {
  let consoleSpy: {
    log: ReturnType<typeof vi.spyOn>;
    info: ReturnType<typeof vi.spyOn>;
    warn: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('formats debug messages with module prefix', () => {
    logger.debug('payments', 'Processing order');
    expect(consoleSpy.log).toHaveBeenCalledWith(
      '[DEBUG][payments] Processing order',
    );
  });

  it('formats info messages with module prefix', () => {
    logger.info('auth', 'User logged in');
    expect(consoleSpy.info).toHaveBeenCalledWith(
      '[INFO][auth] User logged in',
    );
  });

  it('formats warn messages with module prefix', () => {
    logger.warn('http', 'Rate limit approached');
    expect(consoleSpy.warn).toHaveBeenCalledWith(
      '[WARN][http] Rate limit approached',
    );
  });

  it('formats error messages with module prefix', () => {
    logger.error('stripe', 'Webhook verification failed');
    expect(consoleSpy.error).toHaveBeenCalledWith(
      '[ERROR][stripe] Webhook verification failed',
    );
  });

  it('sanitizes message strings', () => {
    logger.info('auth', 'Login from user@example.com');
    expect(consoleSpy.info).toHaveBeenCalledWith(
      '[INFO][auth] Login from [REDACTED]',
    );
  });

  it('sanitizes additional arguments', () => {
    logger.error('payments', 'Failed', {token: 'sk_live', orderId: '123'});
    expect(consoleSpy.error).toHaveBeenCalledWith(
      '[ERROR][payments] Failed',
      {token: '[REDACTED]', orderId: '123'},
    );
  });
});
