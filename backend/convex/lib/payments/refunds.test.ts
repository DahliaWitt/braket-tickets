import {describe, expect, it} from 'vitest';
import {
  calculateLostProcessingFeeCents,
  calculateOrderPerTicketRefundAmount,
  calculateRefundableAmountFromTicketCount,
  calculateRefundedTicketCount,
  calculateRetainedPlatformFeeCents,
  estimateRefundedAmountForTicketCount,
  generateStripeIdempotencyKey,
  getProcessorFeeCents,
} from './refunds';

describe('refund helpers', () => {
  it('keeps per-ticket amounts stable across order-based helpers', () => {
    expect(calculateOrderPerTicketRefundAmount(1000, 4)).toBe(250);
    expect(calculateOrderPerTicketRefundAmount(1000, 0)).toBe(0);
    expect(calculateRefundedTicketCount(1000, 4, 500)).toBe(2);
  });

  it('maps full rounded refunds to the full ticket quantity', () => {
    for (const refundedTicketCount of [0, 1, 2, 3]) {
      const refundedAmount = estimateRefundedAmountForTicketCount({
        totalAmount: 10_001,
        refundedTicketCount,
        totalTicketCount: 3,
      });
      expect(calculateRefundedTicketCount(10_001, 3, refundedAmount)).toBe(
        refundedTicketCount,
      );
    }
    expect(calculateRefundedTicketCount(10_001, 3, 10_000)).toBe(2);
    expect(calculateRefundedTicketCount(10_001, 3, 10_001)).toBe(3);
  });

  it('calculates refunded and refundable amounts from ticket counts', () => {
    expect(
      estimateRefundedAmountForTicketCount({
        totalAmount: 1000,
        refundedTicketCount: 2,
        totalTicketCount: 4,
      }),
    ).toBe(500);
    expect(
      calculateRefundableAmountFromTicketCount({
        totalAmount: 1000,
        refundableTicketCount: 3,
        totalTicketCount: 4,
      }),
    ).toBe(750);
  });

  it('uses the stored processor fee when calculating lost processing fees', () => {
    expect(
      calculateLostProcessingFeeCents({
        refundedAmount: 500,
        totalAmount: 1000,
        storedProcessorFeeCents: 59,
      }),
    ).toBe(30);
    expect(
      getProcessorFeeCents({amount: 1000, storedProcessorFeeCents: 59}),
    ).toBe(59);
  });

  it('uses the shared platform fee policy for retained gross amounts', () => {
    expect(calculateRetainedPlatformFeeCents(1000)).toBe(20);
    expect(calculateRetainedPlatformFeeCents(0)).toBe(0);
  });
});

describe('generateStripeIdempotencyKey', () => {
  it('keeps long Stripe keys deterministic', () => {
    const subjectId = 'order_' + 'x'.repeat(80);
    const suffix = 'ticket_' + 'y'.repeat(40);

    const key = generateStripeIdempotencyKey(
      subjectId,
      'refund-ticket',
      suffix,
    );

    expect(key).toBe(`braket-refund-ticket-${subjectId}-${suffix}`);
    expect(key.length).toBeGreaterThan(45);
  });

  it('preserves deterministic keys for short inputs', () => {
    expect(generateStripeIdempotencyKey('order_123', 'refund')).toBe(
      'braket-refund-order_123',
    );
  });
});
