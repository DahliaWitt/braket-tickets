import {describe, expect, it} from 'vitest';
import {api, internal} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import {convexTest} from '../setup.testing';

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
});
