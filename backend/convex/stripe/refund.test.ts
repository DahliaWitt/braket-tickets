import {describe, expect, it, vi, beforeEach, afterEach} from 'vitest';
import {convexTest} from '../setup.testing';
import {internal} from '../_generated/api';

const {stripeCtor, refundsCreateMock, refundsRetrieveMock} = vi.hoisted(() => ({
  stripeCtor: vi.fn(function StripeMock(this: unknown, _secretKey: string) {
    return {
      refunds: {
        create: refundsCreateMock,
        retrieve: refundsRetrieveMock,
      },
    };
  }),
  refundsCreateMock: vi.fn(),
  refundsRetrieveMock: vi.fn(),
}));

vi.mock('stripe', () => ({
  default: stripeCtor,
}));

describe('processStripeRefund', () => {
  const originalSecretKey = process.env.STRIPE_SECRET_KEY;
  const originalIsTest = process.env.IS_TEST;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    delete process.env.IS_TEST;
    stripeCtor.mockImplementation(function StripeMock(
      this: unknown,
      _secretKey: string,
    ) {
      return {
        refunds: {
          create: refundsCreateMock,
          retrieve: refundsRetrieveMock,
        },
      };
    });
    refundsCreateMock.mockResolvedValue({
      id: 're_test_123',
      balance_transaction: {
        amount: -1234,
        net: -1200,
        fee_details: [],
      },
    });
    refundsRetrieveMock.mockResolvedValue({
      id: 're_test_123',
      balance_transaction: {
        amount: -1234,
        net: -1200,
        fee_details: [],
      },
    });
  });

  afterEach(() => {
    if (originalSecretKey === undefined) {
      delete process.env.STRIPE_SECRET_KEY;
    } else {
      process.env.STRIPE_SECRET_KEY = originalSecretKey;
    }

    if (originalIsTest === undefined) {
      delete process.env.IS_TEST;
    } else {
      process.env.IS_TEST = originalIsTest;
    }
  });

  it('passes the deterministic idempotency key to Stripe', async () => {
    const t = convexTest();

    await t.action(internal.stripe.actions.processStripeRefund, {
      paymentIntentId: 'pi_123',
      amountCents: 1234,
      idempotencyKey: 'stripe-refund-key-123',
    });

    expect(stripeCtor).toHaveBeenCalledWith('sk_test_123');
    expect(refundsCreateMock).toHaveBeenCalledTimes(1);
    expect(refundsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_intent: 'pi_123',
        amount: 1234,
        expand: ['balance_transaction'],
      }),
      {
        idempotencyKey: 'stripe-refund-key-123',
      },
    );
  });

  it('returns distinct mock refund ids for distinct idempotency keys in test mode', async () => {
    const t = convexTest();
    process.env.IS_TEST = 'true';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-17T12:00:00.000Z'));

    try {
      const first = await t.action(
        internal.stripe.actions.processStripeRefund,
        {
          paymentIntentId: 'pi_mock_refund',
          amountCents: 2500,
          idempotencyKey: 'stripe-mock-refund-key-one',
        },
      );
      const second = await t.action(
        internal.stripe.actions.processStripeRefund,
        {
          paymentIntentId: 'pi_mock_refund',
          amountCents: 2500,
          idempotencyKey: 'stripe-mock-refund-key-two',
        },
      );

      expect(first.refundId).toMatch(/^re_mock_/);
      expect(second.refundId).toMatch(/^re_mock_/);
      expect(first.refundId).not.toBe(second.refundId);
      expect(refundsCreateMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('passes stripeAccount and refund_application_fee for direct-charge Connect refunds', async () => {
    const t = convexTest();

    await t.action(internal.stripe.actions.processStripeRefund, {
      paymentIntentId: 'pi_connect_456',
      amountCents: 5000,
      idempotencyKey: 'stripe-connect-refund-key',
      connectedAccountId: 'acct_connect_456',
      refundApplicationFee: true,
    });

    expect(refundsCreateMock).toHaveBeenCalledTimes(1);
    expect(refundsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_intent: 'pi_connect_456',
        amount: 5000,
        expand: ['balance_transaction'],
        refund_application_fee: true,
      }),
      {
        idempotencyKey: 'stripe-connect-refund-key',
        stripeAccount: 'acct_connect_456',
      },
    );
    // Direct charges: no reverse_transfer — there is no transfer to reverse.
    const [refundParams] = refundsCreateMock.mock.calls[0] ?? [];
    expect(refundParams).not.toHaveProperty('reverse_transfer');
  });

  it('omits reverse_transfer and refund_application_fee for platform-only refunds', async () => {
    const t = convexTest();

    await t.action(internal.stripe.actions.processStripeRefund, {
      paymentIntentId: 'pi_platform_789',
      amountCents: 3000,
      idempotencyKey: 'stripe-platform-refund-key',
    });

    expect(refundsCreateMock).toHaveBeenCalledTimes(1);
    const [refundParams] = refundsCreateMock.mock.calls[0] ?? [];
    expect(refundParams).toEqual(
      expect.objectContaining({
        payment_intent: 'pi_platform_789',
        amount: 3000,
        expand: ['balance_transaction'],
      }),
    );
    expect(refundParams).not.toHaveProperty('reverse_transfer');
    expect(refundParams).not.toHaveProperty('refund_application_fee');
  });

  it('returns refund balance transaction fields for payout settlement', async () => {
    const t = convexTest();
    refundsCreateMock.mockResolvedValueOnce({
      id: 're_with_balance_transaction',
      balance_transaction: {
        amount: -5000,
        net: -4800,
        fee_details: [
          {type: 'stripe_fee', amount: 0},
          {type: 'application_fee', amount: -200},
        ],
      },
    });

    const result = await t.action(internal.stripe.actions.processStripeRefund, {
      paymentIntentId: 'pi_connect_balance',
      amountCents: 5000,
      idempotencyKey: 'stripe-connect-refund-balance-key',
      connectedAccountId: 'acct_connect_balance',
      refundApplicationFee: true,
    });

    expect(result).toMatchObject({
      success: true,
      refundId: 're_with_balance_transaction',
      processorFeeCents: 0,
      platformFeeCents: -200,
      connectedAccountNetCents: -4800,
    });
  });

  it('retrieves the created refund when create omits balance transaction', async () => {
    const t = convexTest();
    refundsCreateMock.mockResolvedValueOnce({
      id: 're_needs_retrieve',
      balance_transaction: null,
    });
    refundsRetrieveMock.mockResolvedValueOnce({
      id: 're_needs_retrieve',
      balance_transaction: {
        amount: -5000,
        net: -4750,
        fee_details: [
          {type: 'stripe_fee', amount: 0},
          {type: 'application_fee', amount: -250},
        ],
      },
    });

    const result = await t.action(internal.stripe.actions.processStripeRefund, {
      paymentIntentId: 'pi_connect_missing_balance',
      amountCents: 5000,
      idempotencyKey: 'stripe-connect-refund-missing-balance-key',
      connectedAccountId: 'acct_connect_balance',
      refundApplicationFee: true,
    });

    expect(refundsRetrieveMock).toHaveBeenCalledWith(
      're_needs_retrieve',
      {expand: ['balance_transaction']},
      {stripeAccount: 'acct_connect_balance'},
    );
    expect(result).toMatchObject({
      success: true,
      refundId: 're_needs_retrieve',
      processorFeeCents: 0,
      platformFeeCents: -250,
      connectedAccountNetCents: -4750,
    });
  });
});
