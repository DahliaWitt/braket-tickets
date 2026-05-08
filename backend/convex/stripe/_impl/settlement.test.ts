import {describe, expect, it, vi} from 'vitest';
import {mockDeep} from 'vitest-mock-extended';
import type Stripe from 'stripe';
import type {Id} from '../../_generated/dataModel';
import {recordPaymentCaptured} from './settlement';

/**
 * Pure tests for `recordPaymentCaptured` — the single normalizer between
 * a Stripe Charge's BalanceTransaction and our `order_financial_events`
 * ledger. Money-movement correctness is load-bearing here; a bug that
 * drops `connectedAccountNetCents` silently produces zero-payout events.
 */

function makeStripeMock(opts: {charge: Partial<Stripe.Charge>}): {
  stripe: Stripe;
  retrieve: ReturnType<typeof vi.fn>;
} {
  const retrieve = vi.fn().mockResolvedValue(opts.charge);
  const stripe = mockDeep<Stripe>();
  stripe.charges.retrieve.mockImplementation(retrieve);
  return {stripe, retrieve};
}

function makeCtxMock(): {
  ctx: Parameters<typeof recordPaymentCaptured>[0]['ctx'];
  runMutation: ReturnType<typeof vi.fn>;
} {
  const runMutation = vi.fn().mockResolvedValue(undefined);
  return {
    ctx: {
      runMutation,
      runAction: vi.fn(),
      runQuery: vi.fn(),
    },
    runMutation,
  };
}

const ORDER_ID = 'order_1' as Id<'ticket_orders'>;
const EVENT_ID = 'event_1' as Id<'events'>;

describe('recordPaymentCaptured', () => {
  it('records processor fee, platform fee, and net from the expanded BalanceTransaction', async () => {
    const bt: Partial<Stripe.BalanceTransaction> = {
      amount: 10_000,
      net: 9_500,
      fee_details: [
        {type: 'stripe_fee', amount: 300},
        {type: 'application_fee', amount: 200},
      ] as Stripe.BalanceTransaction.FeeDetail[],
    };
    const {stripe, retrieve} = makeStripeMock({
      charge: {balance_transaction: bt as Stripe.BalanceTransaction},
    });
    const {ctx, runMutation} = makeCtxMock();

    await recordPaymentCaptured({
      ctx,
      stripe,
      orderId: ORDER_ID,
      eventId: EVENT_ID,
      stripePaymentIntentId: 'pi_1',
      stripeChargeId: 'ch_1',
      connectedAccountId: 'acct_1',
      stripeEventId: 'evt_1',
    });

    // Retrieve routes through the connected account.
    expect(retrieve).toHaveBeenCalledWith(
      'ch_1',
      {expand: ['balance_transaction']},
      {stripeAccount: 'acct_1'},
    );

    expect(runMutation).toHaveBeenCalledTimes(1);
    const [, args] = runMutation.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(args).toMatchObject({
      orderId: ORDER_ID,
      eventId: EVENT_ID,
      kind: 'payment_captured',
      amountCents: 10_000,
      processorFeeCents: 300,
      platformFeeCents: 200,
      connectedAccountNetCents: 9_500,
      connectedAccountId: 'acct_1',
      stripePaymentIntentId: 'pi_1',
      stripeChargeId: 'ch_1',
      stripeEventId: 'evt_1',
    });
  });

  it('omits stripeAccount option for platform-owned orders', async () => {
    const bt: Partial<Stripe.BalanceTransaction> = {
      amount: 5_000,
      net: 5_000,
      fee_details: [] as Stripe.BalanceTransaction.FeeDetail[],
    };
    const {stripe, retrieve} = makeStripeMock({
      charge: {balance_transaction: bt as Stripe.BalanceTransaction},
    });
    const {ctx, runMutation} = makeCtxMock();

    await recordPaymentCaptured({
      ctx,
      stripe,
      orderId: ORDER_ID,
      eventId: EVENT_ID,
      stripePaymentIntentId: 'pi_platform',
      stripeChargeId: 'ch_platform',
      connectedAccountId: undefined,
    });

    expect(retrieve).toHaveBeenCalledWith(
      'ch_platform',
      {expand: ['balance_transaction']},
      undefined,
    );
    // Both fee types missing → default to zero so the ledger row still
    // carries coherent numbers.
    const [, args] = runMutation.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(args['processorFeeCents']).toBe(0);
    expect(args['platformFeeCents']).toBe(0);
    expect(args['connectedAccountNetCents']).toBe(5_000);
    expect(args).not.toHaveProperty('connectedAccountId');
  });

  it('throws so Stripe retries when balance_transaction is unexpanded', async () => {
    const {stripe} = makeStripeMock({
      charge: {
        amount: 7_500,
        balance_transaction:
          'txn_unexpanded' as unknown as Stripe.BalanceTransaction,
      },
    });
    const {ctx, runMutation} = makeCtxMock();

    await expect(
      recordPaymentCaptured({
        ctx,
        stripe,
        orderId: ORDER_ID,
        eventId: EVENT_ID,
        stripePaymentIntentId: 'pi_missing',
        stripeChargeId: 'ch_missing',
        connectedAccountId: 'acct_missing',
      }),
    ).rejects.toThrow('Charge balance transaction is not available yet');

    expect(runMutation).not.toHaveBeenCalled();
  });

  it('throws so Stripe retries when balance_transaction is null', async () => {
    const {stripe} = makeStripeMock({
      charge: {
        amount: 2_500,
        balance_transaction: null as unknown as Stripe.BalanceTransaction,
      },
    });
    const {ctx, runMutation} = makeCtxMock();

    await expect(
      recordPaymentCaptured({
        ctx,
        stripe,
        orderId: ORDER_ID,
        eventId: EVENT_ID,
        stripePaymentIntentId: 'pi_null',
        stripeChargeId: 'ch_null',
        connectedAccountId: 'acct_null',
      }),
    ).rejects.toThrow('Charge balance transaction is not available yet');

    expect(runMutation).not.toHaveBeenCalled();
  });
});
