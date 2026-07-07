import {afterEach, describe, expect, it, vi} from 'vitest';
import {mockDeep} from 'vitest-mock-extended';
import Stripe from 'stripe';
import {dispatchStripeEvent} from './webhook_dispatch';
import {STRIPE_WEBHOOK_IN_FLIGHT_CODE} from '../../lib/stripe_webhook_errors';
import {logger} from '../../lib/logger';

type DispatchCtx = Parameters<typeof dispatchStripeEvent>[0];

/** Stripe instance with no methods wired — sufficient for handlers that never call Stripe directly. */
const NOOP_STRIPE = mockDeep<Stripe>();

function paymentIntentSucceededEvent(id: string): Stripe.Event {
  const paymentIntent = mockDeep<Stripe.PaymentIntent>();
  paymentIntent.id = 'pi_test';
  paymentIntent.metadata = {orderId: 'order_test'};

  return {
    id,
    object: 'event',
    api_version: Stripe.API_VERSION,
    created: 1_700_000_000,
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: 'payment_intent.succeeded',
    data: {
      object: paymentIntent,
    },
  };
}

function paymentIntentFailedEvent(
  id: string,
  lastPaymentError?: {type: string; code?: string},
): Stripe.Event {
  const paymentIntent = {
    id: 'pi_failed',
    metadata: {orderId: 'order_failed'},
    ...(lastPaymentError
      ? {
          last_payment_error:
            lastPaymentError as Stripe.PaymentIntent.LastPaymentError,
        }
      : {}),
  } as unknown as Stripe.PaymentIntent;

  return {
    id,
    object: 'event',
    api_version: Stripe.API_VERSION,
    created: 1_700_000_000,
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: 'payment_intent.payment_failed',
    data: {
      object: paymentIntent,
    },
  };
}

function checkoutSessionCompletedEvent(id: string): Stripe.Event {
  return {
    id,
    object: 'event',
    api_version: Stripe.API_VERSION,
    created: 1_700_000_000,
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test',
        payment_status: 'paid',
        metadata: {orderId: 'order_checkout'},
        payment_intent: 'pi_checkout',
      },
    },
  } as unknown as Stripe.Event;
}

function checkoutSessionExpiredEvent(id: string): Stripe.Event {
  return {
    id,
    object: 'event',
    api_version: Stripe.API_VERSION,
    created: 1_700_000_000,
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: 'checkout.session.expired',
    data: {
      object: {
        id: 'cs_expired',
        metadata: {orderId: 'order_checkout'},
      },
    },
  } as unknown as Stripe.Event;
}

/**
 * Claim mutation returns `{disposition: 'proceed', mode: 'new', claimId: ...}`
 * when the event is fresh. Other mutations (order lookups, ledger
 * writes, finalize) return whatever the handler needs.
 */
/**
 * Identify a mutation call by inspecting its args. We can't rely on
 * function-reference identity because the test imports `internal.*`
 * through a different module graph than the dispatcher, and convex-test
 * isn't running here. Args are shape-stable so the shape check is
 * unambiguous.
 */
type MutationMatcher = (args: Record<string, unknown>) => boolean;
const isClaimMutation: MutationMatcher = (args) =>
  typeof args['stripeEventId'] === 'string' &&
  typeof args['stripeEventType'] === 'string';
const isFinalizeMutation: MutationMatcher = (args) =>
  typeof args['claimId'] === 'string' && 'outcome' in args;
const isRecordFinancialEvent: MutationMatcher = (args) =>
  args['kind'] !== undefined && 'orderId' in args;
const isApplyExternalRefund: MutationMatcher = (args) =>
  'refundedAmountCents' in args && 'orderId' in args;
// Match on distinctive args shapes, not key counts — additive args (an
// audit field, new optional flag) should NOT silently break the
// matcher and force a cryptic "expected 1, got 0" failure.
const isConfirmPayout: MutationMatcher = (args) =>
  'stripePayoutId' in args && !('failureReason' in args);
const isFailPayout: MutationMatcher = (args) =>
  'stripePayoutId' in args && 'failureReason' in args;

function makeClaimingCtx(
  claimResponse: Record<string, unknown> = {
    disposition: 'proceed',
    mode: 'new',
    claimId: 'claim_1',
  },
): {
  ctx: DispatchCtx;
  runMutation: ReturnType<typeof vi.fn>;
  runQuery: ReturnType<typeof vi.fn>;
  runAction: ReturnType<typeof vi.fn>;
} {
  const runMutation = vi.fn();
  const runQuery = vi.fn();
  const runAction = vi.fn();
  runMutation.mockImplementation(
    (_ref: unknown, args: Record<string, unknown>) => {
      if (isClaimMutation(args)) {
        return Promise.resolve(claimResponse);
      }
      return Promise.resolve(null);
    },
  );
  return {
    ctx: {
      runMutation,
      runQuery,
      runAction,
      scheduler: {runAfter: vi.fn().mockResolvedValue(undefined)},
    } as unknown as DispatchCtx,
    runMutation,
    runQuery,
    runAction,
  };
}

/** Ctx mock where the claim mutation returns a skip disposition. */
function makeSkipCtx(skipResponse: Record<string, unknown>): {
  ctx: DispatchCtx;
  runAction: ReturnType<typeof vi.fn>;
} {
  const runAction = vi.fn();
  return {
    ctx: {
      runMutation: vi.fn().mockResolvedValue(skipResponse),
      runQuery: vi.fn(),
      runAction,
      scheduler: {runAfter: vi.fn().mockResolvedValue(undefined)},
    } as unknown as DispatchCtx,
    runAction,
  };
}

function mutationCalls(
  runMutation: ReturnType<typeof vi.fn>,
  match: MutationMatcher,
): Array<Record<string, unknown>> {
  return runMutation.mock.calls
    .map((call) => call[1] as Record<string, unknown>)
    .filter((args) => args && match(args));
}

describe('dispatchStripeEvent claim skip behavior', () => {
  it('throws a retryable ConvexError when the claim is still in flight', async () => {
    const {ctx, runAction} = makeSkipCtx({
      disposition: 'skip',
      reason: 'in_flight',
      existingClaimId: 'claim_in_flight',
    });

    await expect(
      dispatchStripeEvent(
        ctx,
        paymentIntentSucceededEvent('evt_in_flight'),
        NOOP_STRIPE,
      ),
    ).rejects.toMatchObject({
      data: {code: STRIPE_WEBHOOK_IN_FLIGHT_CODE},
    });

    expect(runAction).not.toHaveBeenCalled();
  });

  it('acknowledges already completed webhook events without rerunning handlers', async () => {
    const {ctx, runAction} = makeSkipCtx({
      disposition: 'skip',
      reason: 'already_completed',
      existingClaimId: 'claim_completed',
    });

    await expect(
      dispatchStripeEvent(
        ctx,
        paymentIntentSucceededEvent('evt_completed'),
        NOOP_STRIPE,
      ),
    ).resolves.toBeUndefined();

    expect(runAction).not.toHaveBeenCalled();
  });
});

describe('dispatchStripeEvent — payment_intent.succeeded log-only behavior', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not settle the order on payment_intent.succeeded', async () => {
    const {ctx, runAction} = makeClaimingCtx();

    await dispatchStripeEvent(
      ctx,
      paymentIntentSucceededEvent('evt_pi_log'),
      NOOP_STRIPE,
      'acct_connect',
    );

    // Post-V2 design: checkout.session.completed is canonical. No
    // settle action should be dispatched from payment_intent.succeeded.
    expect(runAction).not.toHaveBeenCalled();
  });
});

describe('dispatchStripeEvent — connected-account order ownership checks', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not settle checkout.session.completed when connected account does not match order', async () => {
    const {ctx, runAction, runQuery, runMutation} = makeClaimingCtx();
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    runQuery.mockResolvedValueOnce('order_checkout').mockResolvedValueOnce({
      _id: 'order_checkout',
      connectedAccountId: 'acct_expected',
      state: 'open',
    });
    const stripe = mockDeep<Stripe>();
    stripe.paymentIntents.retrieve.mockResolvedValue({
      latest_charge: 'ch_checkout',
    } as unknown as Awaited<ReturnType<Stripe['paymentIntents']['retrieve']>>);

    await dispatchStripeEvent(
      ctx,
      checkoutSessionCompletedEvent('evt_checkout_account_mismatch'),
      stripe,
      'acct_attacker',
    );

    expect(runAction).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'stripe',
      'checkout.session.completed validation failed: account_mismatch',
      {orderId: 'order_checkout', connectedAccountId: 'acct_attacker'},
    );
    expect(mutationCalls(runMutation, isFinalizeMutation).at(-1)).toMatchObject(
      {outcome: 'failed', failureReason: 'order_not_found'},
    );
  });

  it('logs missing orders distinctly from connected account mismatches', async () => {
    const {ctx, runAction, runQuery, runMutation} = makeClaimingCtx();
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    runQuery
      .mockResolvedValueOnce('order_checkout')
      .mockResolvedValueOnce(null);

    await dispatchStripeEvent(
      ctx,
      checkoutSessionCompletedEvent('evt_checkout_missing_order'),
      NOOP_STRIPE,
      'acct_connect',
    );

    expect(runAction).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'stripe',
      'checkout.session.completed validation failed: order_not_found',
      {orderId: 'order_checkout', connectedAccountId: 'acct_connect'},
    );
    expect(mutationCalls(runMutation, isFinalizeMutation).at(-1)).toMatchObject(
      {outcome: 'failed', failureReason: 'order_not_found'},
    );
  });

  it('does not expire checkout.session.expired when connected account does not match order', async () => {
    const {ctx, runMutation, runQuery} = makeClaimingCtx();
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    runQuery.mockResolvedValueOnce('order_checkout').mockResolvedValueOnce({
      _id: 'order_checkout',
      connectedAccountId: 'acct_expected',
      state: 'open',
    });

    await dispatchStripeEvent(
      ctx,
      checkoutSessionExpiredEvent('evt_checkout_expired_account_mismatch'),
      NOOP_STRIPE,
      'acct_attacker',
    );

    const expireCalls = runMutation.mock.calls.filter(([, args]) => {
      const mutationArgs = args as Record<string, unknown> | undefined;
      return (
        mutationArgs?.['orderId'] === 'order_checkout' &&
        'force' in mutationArgs
      );
    });
    expect(expireCalls).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(
      'stripe',
      'checkout.session.expired validation failed: account_mismatch',
      {orderId: 'order_checkout', connectedAccountId: 'acct_attacker'},
    );
    expect(mutationCalls(runMutation, isFinalizeMutation).at(-1)).toMatchObject(
      {outcome: 'failed', failureReason: 'order_not_found'},
    );
  });

  it('does not release orders for payment_intent.payment_failed on account mismatch', async () => {
    const {ctx, runMutation, runQuery} = makeClaimingCtx();
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    runQuery.mockResolvedValueOnce('order_failed').mockResolvedValueOnce({
      _id: 'order_failed',
      connectedAccountId: 'acct_expected',
      state: 'open',
    });

    await dispatchStripeEvent(
      ctx,
      paymentIntentFailedEvent('evt_pi_failed_mismatch', {
        type: 'invalid_request_error',
        code: 'account_invalid',
      }),
      NOOP_STRIPE,
      'acct_attacker',
    );

    const releaseCalls = runMutation.mock.calls.filter(([, args]) => {
      const mutationArgs = args as Record<string, unknown> | undefined;
      return mutationArgs?.['failureStage'] === 'payment_intent';
    });
    expect(releaseCalls).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(
      'stripe',
      'payment_intent.payment_failed validation failed: account_mismatch',
      {
        orderId: 'order_failed',
        paymentIntentId: 'pi_failed',
        connectedAccountId: 'acct_attacker',
      },
    );
    expect(mutationCalls(runMutation, isFinalizeMutation).at(-1)).toMatchObject(
      {outcome: 'failed', failureReason: 'order_not_found'},
    );
  });
});

describe('dispatchStripeEvent — payment_intent.payment_failed recovery behavior', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not release the order on a failed Checkout card attempt', async () => {
    const {ctx, runMutation, runQuery} = makeClaimingCtx();
    runQuery.mockResolvedValueOnce('order_failed').mockResolvedValueOnce({
      _id: 'order_failed',
      connectedAccountId: 'acct_connect',
      state: 'open',
    });

    await dispatchStripeEvent(
      ctx,
      paymentIntentFailedEvent('evt_pi_failed_log', {
        type: 'card_error',
        code: 'card_declined',
      }),
      NOOP_STRIPE,
      'acct_connect',
    );

    const releaseCalls = runMutation.mock.calls.filter(([, args]) => {
      const mutationArgs = args as Record<string, unknown> | undefined;
      return (
        mutationArgs?.['orderId'] === 'order_failed' &&
        mutationArgs?.['failureStage'] === 'payment_intent'
      );
    });
    expect(releaseCalls).toHaveLength(0);
  });

  it('releases the order on a non-card Checkout failure', async () => {
    const {ctx, runMutation, runQuery} = makeClaimingCtx();
    runQuery.mockResolvedValueOnce('order_failed').mockResolvedValueOnce({
      _id: 'order_failed',
      connectedAccountId: 'acct_connect',
      state: 'open',
    });

    await dispatchStripeEvent(
      ctx,
      paymentIntentFailedEvent('evt_pi_failed_config', {
        type: 'invalid_request_error',
        code: 'account_invalid',
      }),
      NOOP_STRIPE,
      'acct_connect',
    );

    const releaseCalls = runMutation.mock.calls.filter(([, args]) => {
      const mutationArgs = args as Record<string, unknown> | undefined;
      return (
        mutationArgs?.['orderId'] === 'order_failed' &&
        mutationArgs?.['errorCode'] === 'account_invalid' &&
        mutationArgs?.['failureStage'] === 'payment_intent'
      );
    });
    expect(releaseCalls).toHaveLength(1);
  });
});

describe('dispatchStripeEvent — dispute funds routing', () => {
  function disputeFundsEvent(
    id: string,
    type: 'charge.dispute.funds_withdrawn' | 'charge.dispute.funds_reinstated',
    amount: number,
  ): Stripe.Event {
    return {
      id,
      type,
      data: {
        object: {
          id: 'dp_1',
          amount,
          payment_intent: 'pi_dispute',
          status: type === 'charge.dispute.funds_withdrawn' ? 'lost' : 'won',
        },
      },
    } as unknown as Stripe.Event;
  }

  it('records a negative amountCents and connectedAccountNetCents on funds_withdrawn', async () => {
    const {ctx, runMutation, runQuery} = makeClaimingCtx();
    runQuery.mockResolvedValue({
      _id: 'order_dispute',
      eventId: 'event_dispute',
      stripeChargeId: 'ch_dispute',
    });

    await dispatchStripeEvent(
      ctx,
      disputeFundsEvent('evt_disp_w', 'charge.dispute.funds_withdrawn', 4000),
      NOOP_STRIPE,
      'acct_connect',
    );

    const ledgerCalls = mutationCalls(runMutation, isRecordFinancialEvent);
    expect(ledgerCalls).toHaveLength(1);
    expect(ledgerCalls[0]).toMatchObject({
      kind: 'dispute_funds_withdrawn',
      amountCents: -4000,
      connectedAccountNetCents: -4000,
      connectedAccountId: 'acct_connect',
    });
  });

  it('records a positive amountCents and connectedAccountNetCents on funds_reinstated', async () => {
    const {ctx, runMutation, runQuery} = makeClaimingCtx();
    runQuery.mockResolvedValue({
      _id: 'order_dispute',
      eventId: 'event_dispute',
      stripeChargeId: 'ch_dispute',
    });

    await dispatchStripeEvent(
      ctx,
      disputeFundsEvent('evt_disp_r', 'charge.dispute.funds_reinstated', 4000),
      NOOP_STRIPE,
      'acct_connect',
    );

    const ledgerCalls = mutationCalls(runMutation, isRecordFinancialEvent);
    expect(ledgerCalls).toHaveLength(1);
    expect(ledgerCalls[0]).toMatchObject({
      kind: 'dispute_funds_reinstated',
      amountCents: 4000,
      connectedAccountNetCents: 4000,
      connectedAccountId: 'acct_connect',
    });
  });
});

describe('dispatchStripeEvent — refunded charge settlement', () => {
  function chargeRefundedEvent(id: string): Stripe.Event {
    return {
      id,
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_refunded',
          amount: 5000,
          amount_refunded: 2500,
          payment_intent: 'pi_refunded',
          refunds: {
            data: [{id: 're_refunded_1', amount: 2500}],
          },
        },
      },
    } as unknown as Stripe.Event;
  }

  it('retrieves the refund balance transaction on the connected account', async () => {
    const {ctx, runMutation, runQuery} = makeClaimingCtx();
    runQuery.mockResolvedValue({
      _id: 'order_refunded',
      eventId: 'event_refunded',
    });
    const stripe = mockDeep<Stripe>();
    stripe.refunds.retrieve.mockResolvedValue({
      id: 're_refunded_1',
      balance_transaction: {
        amount: -2500,
        net: -2400,
        fee_details: [
          {type: 'stripe_fee', amount: 0},
          {type: 'application_fee', amount: -100},
        ],
      },
    } as unknown as Awaited<ReturnType<Stripe['refunds']['retrieve']>>);

    await dispatchStripeEvent(
      ctx,
      chargeRefundedEvent('evt_charge_refunded'),
      stripe,
      'acct_connect',
    );

    expect(stripe.refunds.retrieve).toHaveBeenCalledWith(
      're_refunded_1',
      {expand: ['balance_transaction']},
      {stripeAccount: 'acct_connect'},
    );
    const refundCalls = mutationCalls(runMutation, isApplyExternalRefund);
    expect(refundCalls).toHaveLength(1);
    expect(refundCalls[0]).toMatchObject({
      orderId: 'order_refunded',
      refundedAmountCents: 2500,
      stripeRefundId: 're_refunded_1',
      ledgerRefundAmountCents: 2500,
      processorFeeCents: 0,
      platformFeeCents: -100,
      connectedAccountNetCents: -2400,
    });
  });

  it('uses the individual refund amount for ledger movement when cumulative amount is higher', async () => {
    const {ctx, runMutation, runQuery} = makeClaimingCtx();
    runQuery.mockResolvedValue({
      _id: 'order_refunded',
      eventId: 'event_refunded',
    });
    const stripe = mockDeep<Stripe>();
    stripe.refunds.retrieve.mockResolvedValue({
      id: 're_refunded_2',
      amount: 2500,
      balance_transaction: {
        amount: -2500,
        net: -2400,
        fee_details: [
          {type: 'stripe_fee', amount: 0},
          {type: 'application_fee', amount: -100},
        ],
      },
    } as unknown as Awaited<ReturnType<Stripe['refunds']['retrieve']>>);

    await dispatchStripeEvent(
      ctx,
      {
        id: 'evt_charge_refunded_out_of_order',
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_refunded',
            amount: 5000,
            amount_refunded: 5000,
            payment_intent: 'pi_refunded',
            refunds: {
              data: [{id: 're_refunded_2', amount: 2500}],
            },
          },
        },
      } as unknown as Stripe.Event,
      stripe,
      'acct_connect',
    );

    const refundCalls = mutationCalls(runMutation, isApplyExternalRefund);
    expect(refundCalls).toHaveLength(1);
    expect(refundCalls[0]).toMatchObject({
      refundedAmountCents: 5000,
      stripeRefundId: 're_refunded_2',
      ledgerRefundAmountCents: 2500,
      connectedAccountNetCents: -2400,
    });
  });

  it('releases the webhook claim for retry when refund balance transaction is missing', async () => {
    const {ctx, runMutation, runQuery} = makeClaimingCtx();
    runQuery.mockResolvedValue({
      _id: 'order_refunded',
      eventId: 'event_refunded',
    });
    const stripe = mockDeep<Stripe>();
    stripe.refunds.retrieve.mockResolvedValue({
      id: 're_refunded_1',
      balance_transaction: null,
    } as unknown as Awaited<ReturnType<Stripe['refunds']['retrieve']>>);

    await expect(
      dispatchStripeEvent(
        ctx,
        chargeRefundedEvent('evt_charge_refunded_missing_bt'),
        stripe,
        'acct_connect',
      ),
    ).rejects.toThrow('Refund balance transaction is not available yet');

    expect(mutationCalls(runMutation, isApplyExternalRefund)).toHaveLength(0);
    expect(mutationCalls(runMutation, isFinalizeMutation)).toHaveLength(0);
    expect(
      runMutation.mock.calls.some(([, args]) => {
        const mutationArgs = args as Record<string, unknown> | undefined;
        return (
          mutationArgs?.['claimId'] === 'claim_1' &&
          !('outcome' in mutationArgs)
        );
      }),
    ).toBe(true);
  });
});

describe('dispatchStripeEvent — payout routing', () => {
  function payoutEvent(
    id: string,
    type: 'payout.paid' | 'payout.failed',
    object: Record<string, unknown>,
  ): Stripe.Event {
    return {id, type, data: {object}} as unknown as Stripe.Event;
  }

  it('routes payout.paid to confirmPayout with the full webhook context', async () => {
    const {ctx, runMutation} = makeClaimingCtx();

    await dispatchStripeEvent(
      ctx,
      payoutEvent('evt_payout_paid', 'payout.paid', {
        id: 'po_paid_1',
        amount: 2_400,
        currency: 'usd',
        metadata: {braketBatchId: 'batch_meta_1'},
      }),
      NOOP_STRIPE,
      'acct_x',
    );

    const confirmCalls = mutationCalls(runMutation, isConfirmPayout);
    expect(confirmCalls).toStrictEqual([
      {
        stripePayoutId: 'po_paid_1',
        amountCents: 2_400,
        currency: 'usd',
        metadataBatchId: 'batch_meta_1',
        connectedAccountId: 'acct_x',
      },
    ]);

    const finalizeCalls = mutationCalls(runMutation, isFinalizeMutation);
    expect(finalizeCalls[0]).toMatchObject({outcome: 'completed'});
  });

  it('omits webhook context fields that the payout object lacks', async () => {
    const {ctx, runMutation} = makeClaimingCtx();

    await dispatchStripeEvent(
      ctx,
      payoutEvent('evt_payout_paid_bare', 'payout.paid', {id: 'po_paid_2'}),
      NOOP_STRIPE,
      undefined,
    );

    const confirmCalls = mutationCalls(runMutation, isConfirmPayout);
    expect(confirmCalls).toStrictEqual([{stripePayoutId: 'po_paid_2'}]);
  });

  it('routes payout.failed to failPayout with failure message', async () => {
    const {ctx, runMutation} = makeClaimingCtx();

    await dispatchStripeEvent(
      ctx,
      payoutEvent('evt_payout_fail', 'payout.failed', {
        id: 'po_fail_1',
        failure_message: 'insufficient_funds',
        failure_code: null,
      }),
      NOOP_STRIPE,
      'acct_x',
    );

    const failCalls = mutationCalls(runMutation, isFailPayout);
    expect(failCalls).toStrictEqual([
      {
        stripePayoutId: 'po_fail_1',
        failureReason: 'insufficient_funds',
        connectedAccountId: 'acct_x',
      },
    ]);
  });
});
