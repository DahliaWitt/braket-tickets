import {describe, expect, it} from 'vitest';
import {getBuyerPricingSummary} from '@shared/pricing/pricing-summary';

describe('getBuyerPricingSummary', () => {
  it('labels regular buyer-visible prices as all-in', () => {
    expect(
      getBuyerPricingSummary({price: 2500, supporterDefaultPrice: 4000}),
    ).toMatchObject({
      kind: 'regular',
      primaryText: '$25 all-in',
      secondaryText: 'Supporter from $40',
      unitAmountCents: 2500,
      totalAmountCents: 2500,
    });
  });

  it('describes sliding scale ranges without falling back to bare price', () => {
    expect(
      getBuyerPricingSummary({
        price: 2500,
        slidingScaleEnabled: true,
        slidingScaleMin: 0,
        slidingScaleMax: 2500,
        supporterDefaultPrice: 4000,
      }),
    ).toMatchObject({
      kind: 'sliding_scale',
      primaryText: '$0-$25 all-in sliding scale',
      secondaryText: 'Regular $25 / supporter from $40',
    });
  });

  it('hides public-viewable prices when the caller cannot see pricing', () => {
    expect(
      getBuyerPricingSummary({price: 2500, canSeePrice: false}),
    ).toMatchObject({
      kind: 'sign_in_required',
      primaryText: 'Sign in for pricing',
      unitAmountCents: null,
      totalAmountCents: null,
    });
  });

  it('keeps resale quantity math explicit', () => {
    expect(
      getBuyerPricingSummary({price: 2500, isResale: true, quantity: 2}),
    ).toMatchObject({
      kind: 'resale',
      primaryText: '$25 each resale',
      secondaryText: '$50 total',
      totalAmountCents: 5000,
    });
  });
});
