import {describe, expect, it} from 'vitest';
import {
  formatUsdCents,
  getBuyerPricingSummary,
} from '@shared/pricing/pricing-summary';

describe('formatUsdCents', () => {
  it('renders whole-dollar amounts without decimal places', () => {
    expect(formatUsdCents(2500)).toBe('$25');
    expect(formatUsdCents(4000)).toBe('$40');
  });

  it('renders zero without decimal places', () => {
    expect(formatUsdCents(0)).toBe('$0');
  });

  it('keeps the trailing zero on half-dollar amounts', () => {
    expect(formatUsdCents(1050)).toBe('$10.50');
    expect(formatUsdCents(1090)).toBe('$10.90');
  });

  it('renders sub-dime cents with both decimal places', () => {
    expect(formatUsdCents(1005)).toBe('$10.05');
  });

  it('renders non-zero-terminating cents unchanged', () => {
    expect(formatUsdCents(1099)).toBe('$10.99');
  });
});

describe('getBuyerPricingSummary', () => {
  it('preserves trailing zeros across regular unit and total copy', () => {
    expect(
      getBuyerPricingSummary({price: 1050, quantity: 3}),
    ).toMatchObject({
      kind: 'regular',
      primaryText: '$10.50',
      ariaLabel: '$10.50 regular ticket price',
      unitAmountCents: 1050,
      totalAmountCents: 3150,
    });
  });

  it('preserves trailing zeros in resale total copy', () => {
    expect(
      getBuyerPricingSummary({price: 1050, isResale: true, quantity: 3}),
    ).toMatchObject({
      kind: 'resale',
      primaryText: '$10.50 each resale',
      secondaryText: '$31.50 total',
      totalAmountCents: 3150,
    });
  });

  it('labels regular buyer-visible prices plainly', () => {
    expect(
      getBuyerPricingSummary({price: 2500, supporterDefaultPrice: 4000}),
    ).toMatchObject({
      kind: 'regular',
      primaryText: '$25',
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
      primaryText: '$0-$25 sliding scale',
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
