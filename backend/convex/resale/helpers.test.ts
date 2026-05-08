import {describe, expect, it} from 'vitest';
import {calculateResaleSellerSettlement} from '../lib/resale/helpers';

describe('resale helpers', () => {
  it('calculates seller settlement for a shared Stripe payment', () => {
    expect(
      calculateResaleSellerSettlement(
        {
          amountCents: 5000,
          quantity: 2,
          stripePaymentIntentId: undefined,
        },
        175,
        4.2,
      ),
    ).toEqual({
      sellerPaidAmount: 2500,
      resaleFeeCents: 105,
      sellerRefundAmount: 2395,
      lostProcessingFeeCents: 88,
    });
  });

  it('returns zeroed settlement values when no seller payment exists', () => {
    expect(calculateResaleSellerSettlement(null, undefined, 4.2)).toEqual({
      sellerPaidAmount: 0,
      resaleFeeCents: 0,
      sellerRefundAmount: 0,
      lostProcessingFeeCents: 0,
    });
  });
});
