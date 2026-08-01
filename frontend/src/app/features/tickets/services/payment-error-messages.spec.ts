import {ConvexError} from 'convex/values';
import {describe, it, expect} from 'vitest';
import {PAYMENT_ERROR_CODES} from '@shared/contracts/payment-error-codes';
import {extractPaymentErrorMessage} from './payment-error-messages';

const GENERIC_FALLBACK =
  'Payment processing failed. Please try again or contact support if the problem persists.';

describe('extractPaymentErrorMessage', () => {
  it('prefers the friendly code copy over the raw backend message for a known code', () => {
    // Backend always sends BOTH code and message; the raw message here leaks
    // internal cent amounts. The friendly copy must win.
    const err = new ConvexError({
      code: 'PRICE_MISMATCH',
      message: 'Invalid amount for regular tier. Expected 4000, got 4400',
    });

    expect(extractPaymentErrorMessage(err)).toBe(
      'Price has changed, please refresh',
    );
  });

  it('maps every known payment code to its friendly copy, never the raw message or code', () => {
    for (const code of PAYMENT_ERROR_CODES) {
      const err = new ConvexError({
        code,
        message: `raw backend diagnostic for ${code}`,
      });

      const resolved = extractPaymentErrorMessage(err);

      expect(resolved).not.toContain('raw backend diagnostic');
      expect(resolved).not.toBe(code);
      expect(resolved).not.toBe(GENERIC_FALLBACK);
      expect(resolved.length).toBeGreaterThan(0);
    }
  });

  it('falls back to the message for an unknown code', () => {
    const err = new ConvexError({
      code: 'SOME_UNMAPPED_CODE',
      message: 'A human-readable backend message',
    });

    expect(extractPaymentErrorMessage(err)).toBe(
      'A human-readable backend message',
    );
  });

  it('falls back to the message when no code is present', () => {
    const err = new ConvexError({
      message: 'A human-readable backend message',
    });

    expect(extractPaymentErrorMessage(err)).toBe(
      'A human-readable backend message',
    );
  });

  it('uses the friendly copy for a known code even when the message is absent', () => {
    const err = new ConvexError({code: 'SOLD_OUT'});

    expect(extractPaymentErrorMessage(err)).toBe('This event is sold out');
  });

  it('falls back to the raw code as a last resort when it is unmapped and no message exists', () => {
    const err = new ConvexError({code: 'SOME_UNMAPPED_CODE'});

    expect(extractPaymentErrorMessage(err)).toBe('SOME_UNMAPPED_CODE');
  });

  it('returns the generic fallback when neither code nor message is present', () => {
    const err = new ConvexError({});

    expect(extractPaymentErrorMessage(err)).toBe(GENERIC_FALLBACK);
  });

  it('maps the rate-limiter component error shape with a wait estimate', () => {
    // @convex-dev/rate-limiter throws {kind, name, retryAfter} with no `code`.
    const err = new ConvexError({
      kind: 'RateLimited',
      name: 'initiateGuestSession',
      retryAfter: 5 * 60_000,
    });

    expect(extractPaymentErrorMessage(err)).toBe(
      'Too many attempts, try again in about 5 minutes',
    );
  });

  it('maps a rate-limiter error without retryAfter to the generic rate-limit copy', () => {
    const err = new ConvexError({
      kind: 'RateLimited',
      name: 'initiateGuestSession',
    });

    expect(extractPaymentErrorMessage(err)).toBe(
      'Too many attempts, try again later',
    );
  });

  it('uses singular copy when the wait rounds to one minute', () => {
    const err = new ConvexError({
      kind: 'RateLimited',
      name: 'initiateGuestSession',
      retryAfter: 30_000,
    });

    expect(extractPaymentErrorMessage(err)).toBe(
      'Too many attempts, try again in about 1 minute',
    );
  });

  it('returns a string ConvexError payload directly', () => {
    const err = new ConvexError('Server Error something went wrong');

    expect(extractPaymentErrorMessage(err)).toBe('something went wrong');
  });

  it('uses the message for a plain Error', () => {
    expect(extractPaymentErrorMessage(new Error('plain error'))).toBe(
      'plain error',
    );
  });

  it('returns the generic fallback for an empty non-Convex value', () => {
    expect(extractPaymentErrorMessage(new Error(''))).toBe(GENERIC_FALLBACK);
  });

  it('uses a caller-provided fallback for unmappable errors', () => {
    const fallback = 'Could not start guest checkout. Please try again.';

    expect(extractPaymentErrorMessage(new Error(''), fallback)).toBe(fallback);
    // A mappable error still wins over the fallback.
    expect(
      extractPaymentErrorMessage(new ConvexError({code: 'SOLD_OUT'}), fallback),
    ).toBe('This event is sold out');
  });
});
