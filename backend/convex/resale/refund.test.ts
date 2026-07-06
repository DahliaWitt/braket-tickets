import {describe, expect, it} from 'vitest';
import {api, internal} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import {convexTest} from '../setup.testing';
import {markSellerOrderRefundedState} from '../lib/resale/settlement';

async function seedUser(
  t: ReturnType<typeof convexTest>,
  email: string,
): Promise<Id<'users'>> {
  return await t.mutation(api.testing.users.createUserDirectly, {
    name: 'Seller',
    email,
  });
}

async function seedEvent(
  t: ReturnType<typeof convexTest>,
): Promise<Id<'events'>> {
  const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
    name: 'Resale Refund Org',
    slug: `resale-refund-${Math.random().toString(36).slice(2, 8)}`,
  });

  return await t.mutation(api.testing.events.seedEvent, {
    title: 'Resale Refund Event',
    date: '2030-08-01',
    price: 2500,
    totalTickets: 20,
    status: 'published',
    visibility: 'public',
    resaleEnabled: true,
    organizerId,
  });
}

describe('resale seller refunds', () => {
  it('returns the Stripe refund id from seller refund work', async () => {
    const t = convexTest();
    const originalIsTest = process.env['IS_TEST'];
    process.env['IS_TEST'] = 'true';

    try {
      const sellerId = await seedUser(t, 'seller-refund-id@example.com');
      const eventId = await seedEvent(t);
      const sellerOrderId = await t.mutation(api.testing.orders.seedPayment, {
        userId: sellerId,
        eventId,
        amount: 5000,
        quantity: 2,
        status: 'completed',
        tier: 'regular',
        stripePaymentIntentId: 'pi_seller_refund_id',
        trustSource: 'open_access',
      });
      const sellerTicketId = await t.mutation(api.testing.tickets.seedTicket, {
        userId: sellerId,
        eventId,
        orderId: sellerOrderId,
        status: 'valid',
        tier: 'regular',
      });
      const listingId = await t.mutation(api.testing.resale.seedResaleListing, {
        eventId,
        sellerId,
        ticketId: sellerTicketId,
        status: 'listed',
      });

      const result = await t.action(
        internal.resale.listings.processSellerRefund,
        {
          sellerOrderId,
          sellerOrderStripePaymentIntentId: 'pi_seller_refund_id',
          listingId,
          eventId,
          refundAmountCents: 2395,
          lostProcessingFeeCents: 88,
          idempotencyKey: 'seller-refund-id-test',
        },
      );

      expect(result).toMatchObject({
        stripeRefundId: expect.stringMatching(/^re_mock_/),
      });
    } finally {
      if (originalIsTest === undefined) {
        delete process.env['IS_TEST'];
      } else {
        process.env['IS_TEST'] = originalIsTest;
      }
    }
  });

  it('records the seller refund in the ledger with connected-account net', async () => {
    // The payout settlement only counts payment_refunded rows that carry
    // connectedAccountId + connectedAccountNetCents. The raw insert this
    // path used to make produced rows settlement could never see, which
    // overcounted the seller's payable and tripped the payout trust gate.
    const t = convexTest();
    const sellerId = await seedUser(t, 'seller-refund-net@example.com');
    const eventId = await seedEvent(t);
    const sellerOrderId = await t.mutation(api.testing.orders.seedPayment, {
      userId: sellerId,
      eventId,
      amount: 5000,
      quantity: 2,
      status: 'completed',
      tier: 'regular',
      stripePaymentIntentId: 'pi_seller_refund_net',
      trustSource: 'open_access',
    });
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Test seed: snapshot the connected account onto the order as checkout does.
      await ctx.db.patch('ticket_orders', sellerOrderId, {
        connectedAccountId: 'acct_resale_net',
      });
    });

    const markRefunded = async () =>
      t.run(async (ctx) =>
        markSellerOrderRefundedState(ctx, {
          orderId: sellerOrderId,
          refundedAmountCents: 2_395,
          lostProcessingFeeCents: 88,
          stripeRefundId: 're_net_1',
          processorFeeCents: 30,
          connectedAccountNetCents: -2_365,
        }),
      );
    await markRefunded();

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query('order_financial_events')
        .withIndex('by_order_and_kind', (q) =>
          q.eq('orderId', sellerOrderId).eq('kind', 'payment_refunded'),
        )
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      amountCents: 2_395,
      stripeRefundId: 're_net_1',
      connectedAccountId: 'acct_resale_net',
      connectedAccountNetCents: -2_365,
      processorFeeCents: 30,
      note: 'resale_seller_refund_lost_fee:88',
    });

    // Redelivery/retry is a no-op on the same stripeRefundId.
    await markRefunded();
    const after = await t.run(async (ctx) =>
      ctx.db
        .query('order_financial_events')
        .withIndex('by_order_and_kind', (q) =>
          q.eq('orderId', sellerOrderId).eq('kind', 'payment_refunded'),
        )
        .collect(),
    );
    expect(after).toHaveLength(1);
  });

  it('enriches an existing bare payment_refunded row in place', async () => {
    // Legacy raw-insert rows (and webhook-first orderings) can leave a
    // payment_refunded row without net/account fields. A later
    // markSellerOrderRefundedState for the same stripeRefundId must patch
    // that row in place — never insert a duplicate.
    const t = convexTest();
    const sellerId = await seedUser(t, 'seller-refund-enrich@example.com');
    const eventId = await seedEvent(t);
    const sellerOrderId = await t.mutation(api.testing.orders.seedPayment, {
      userId: sellerId,
      eventId,
      amount: 5000,
      quantity: 2,
      status: 'completed',
      tier: 'regular',
      stripePaymentIntentId: 'pi_seller_refund_enrich',
      trustSource: 'open_access',
    });
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Test seed: snapshot the connected account onto the order as checkout does.
      await ctx.db.patch('ticket_orders', sellerOrderId, {
        connectedAccountId: 'acct_resale_enrich',
      });
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Test seed: legacy bare refund row written by the pre-fix raw insert.
      await ctx.db.insert('order_financial_events', {
        orderId: sellerOrderId,
        eventId,
        currency: 'USD',
        kind: 'payment_refunded',
        amountCents: 2_395,
        stripeRefundId: 're_enrich_1',
        occurredAt: Date.now(),
      });
    });

    await t.run(async (ctx) =>
      markSellerOrderRefundedState(ctx, {
        orderId: sellerOrderId,
        refundedAmountCents: 2_395,
        lostProcessingFeeCents: 88,
        stripeRefundId: 're_enrich_1',
        processorFeeCents: 30,
        connectedAccountNetCents: -2_365,
      }),
    );

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query('order_financial_events')
        .withIndex('by_order_and_kind', (q) =>
          q.eq('orderId', sellerOrderId).eq('kind', 'payment_refunded'),
        )
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      amountCents: 2_395,
      stripeRefundId: 're_enrich_1',
      connectedAccountId: 'acct_resale_enrich',
      connectedAccountNetCents: -2_365,
      processorFeeCents: 30,
      note: 'resale_seller_refund_lost_fee:88',
    });
  });
});
