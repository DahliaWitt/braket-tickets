import {describe, expect, it} from 'vitest';
import {
  calculatePlatformFee,
  calculateStripeFee,
  mapStripeDisputeStatus,
} from './stripe';

/**
 * Pure-function unit tests for `lib/stripe.ts`.
 *
 * Every export here is side-effect-free and runtime-agnostic, so the tests
 * exercise branches directly instead of going through `convexTest()` + a
 * seeded organizer. V2 integration coverage lives in
 * `stripe_connect_actions.test.ts` (mocked Stripe SDK + real Convex
 * fixture).
 */

describe('calculateStripeFee', () => {
  it('returns zero for non-positive amounts', () => {
    expect(calculateStripeFee(0)).toBe(0);
    expect(calculateStripeFee(-100)).toBe(0);
  });

  it('applies 2.9% + 30c and rounds to the nearest cent', () => {
    // 1000c * 0.029 + 30 = 59
    expect(calculateStripeFee(1000)).toBe(59);
    // 1234c * 0.029 + 30 = 65.786 -> 66
    expect(calculateStripeFee(1234)).toBe(66);
  });
});

describe('calculatePlatformFee', () => {
  it('computes the percentage of the total amount', () => {
    expect(calculatePlatformFee(1000, 10)).toBe(100);
    expect(calculatePlatformFee(2500, 2.5)).toBe(63);
  });

  it('rejects out-of-range fee percentages', () => {
    expect(() => calculatePlatformFee(1000, -1)).toThrow(/out of bounds/i);
    expect(() => calculatePlatformFee(1000, 51)).toThrow(/out of bounds/i);
  });
});

describe('mapStripeDisputeStatus', () => {
  it('maps won and warning_closed to won', () => {
    expect(mapStripeDisputeStatus('won')).toBe('won');
    expect(mapStripeDisputeStatus('warning_closed')).toBe('won');
  });

  it('maps lost to lost', () => {
    expect(mapStripeDisputeStatus('lost')).toBe('lost');
  });

  it('maps every other status to withdrawn', () => {
    expect(mapStripeDisputeStatus('withdrawn')).toBe('withdrawn');
    expect(mapStripeDisputeStatus('charge_refunded')).toBe('withdrawn');
    expect(mapStripeDisputeStatus('needs_response')).toBe('withdrawn');
    expect(mapStripeDisputeStatus('')).toBe('withdrawn');
  });
});

