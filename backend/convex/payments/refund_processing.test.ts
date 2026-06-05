import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {executeStoredProcessorRefund} from '../lib/payments/refund_processing';

describe('payments action helpers', () => {
  const runQuery = vi.fn();
  const runAction = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('executeStoredProcessorRefund routes Connect refunds through the snapshotted connectedAccountId', async () => {
    // resolveStripeConnectInfo: orders.getInternal returns an order with
    // a snapshotted connectedAccountId (Task 2 Step 3).
    runQuery.mockResolvedValueOnce({
      _id: 'order_123',
      connectedAccountId: 'acct_123',
    });
    runAction.mockResolvedValueOnce({
      success: true,
      refundId: 're_connect_123',
    });

    await executeStoredProcessorRefund({runQuery, runAction} as never, {
      stripePaymentIntentId: 'pi_123',
      orderId: 'order_123' as never,
      amountCents: 2500,
      reason: 'Admin refund',
      stripeIdempotencyKey: 'stripe-refund-key-123',
    });

    expect(runAction).toHaveBeenCalledTimes(1);
    expect(runAction.mock.calls[0]?.[1]).toMatchObject({
      paymentIntentId: 'pi_123',
      amountCents: 2500,
      reason: 'Admin refund',
      idempotencyKey: 'stripe-refund-key-123',
      connectedAccountId: 'acct_123',
      refundApplicationFee: true,
    });
    // Direct charges no longer use reverse_transfer.
    expect(runAction.mock.calls[0]?.[1]).not.toHaveProperty('reverseTransfer');
  });

  it('executeStoredProcessorRefund omits connectedAccountId for platform-only refunds', async () => {
    runQuery.mockResolvedValueOnce({
      _id: 'order_platform',
      connectedAccountId: undefined,
    });
    runAction.mockResolvedValueOnce({
      success: true,
      refundId: 're_platform_123',
    });

    await executeStoredProcessorRefund({runQuery, runAction} as never, {
      stripePaymentIntentId: 'pi_platform',
      orderId: 'order_platform' as never,
      amountCents: 1000,
      reason: 'Platform refund',
      stripeIdempotencyKey: 'stripe-platform-key',
    });

    expect(runAction).toHaveBeenCalledTimes(1);
    const call = runAction.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(call).toMatchObject({
      paymentIntentId: 'pi_platform',
      amountCents: 1000,
      reason: 'Platform refund',
      idempotencyKey: 'stripe-platform-key',
      refundApplicationFee: false,
    });
    expect(call).not.toHaveProperty('connectedAccountId');
    expect(call).not.toHaveProperty('reverseTransfer');
  });
});
