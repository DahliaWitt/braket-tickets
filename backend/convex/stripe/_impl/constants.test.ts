import {describe, expect, it} from 'vitest';
import {
  STATEMENT_DESCRIPTOR_MAX_LENGTH,
  STRIPE_V2_ACCOUNT_CONFIG,
  sanitizeStatementDescriptor,
} from './constants';

describe('STRIPE_V2_ACCOUNT_CONFIG', () => {
  it('locks the immutable responsibility fields', () => {
    // These values cannot change after the first merchant configuration
    // activates, so regressions here would be load-bearing Stripe behavior.
    expect(STRIPE_V2_ACCOUNT_CONFIG.defaults.responsibilities).toStrictEqual({
      fees_collector: 'stripe',
      losses_collector: 'stripe',
    });
    expect(STRIPE_V2_ACCOUNT_CONFIG.dashboard).toBe('none');
    expect(STRIPE_V2_ACCOUNT_CONFIG.defaults.currency).toBe('usd');
  });

  it('requests card_payments under merchant configuration', () => {
    expect(
      STRIPE_V2_ACCOUNT_CONFIG.configuration.merchant.capabilities.card_payments
        .requested,
    ).toBe(true);
  });
});

describe('sanitizeStatementDescriptor', () => {
  it('strips characters Stripe does not allow', () => {
    expect(sanitizeStatementDescriptor("Summer'Party")).toBe('SummerParty');
    expect(sanitizeStatementDescriptor('<script>')).toBe('script');
  });

  it('preserves Stripe-allowed punctuation (. , ; # @ ! -)', () => {
    expect(sanitizeStatementDescriptor('A.B-C 1,2;3#4@5!')).toBe(
      'A.B-C 1,2;3#4@5!',
    );
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeStatementDescriptor('  concert  ')).toBe('concert');
  });

  it('truncates to STATEMENT_DESCRIPTOR_MAX_LENGTH', () => {
    const long = 'a'.repeat(STATEMENT_DESCRIPTOR_MAX_LENGTH + 10);
    const out = sanitizeStatementDescriptor(long);
    expect(out.length).toBe(STATEMENT_DESCRIPTOR_MAX_LENGTH);
  });

  it('returns an empty string when input has no usable characters', () => {
    expect(sanitizeStatementDescriptor("'*()")).toBe('');
    expect(sanitizeStatementDescriptor('')).toBe('');
  });
});
