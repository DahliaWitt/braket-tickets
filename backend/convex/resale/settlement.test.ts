import {ConvexError} from 'convex/values';
import {describe, expect, it} from 'vitest';
import {
  deriveResaleSettlement,
  type DeriveSettlementInput,
} from '../lib/resale/settlement';

// Narrow the fixture types to exactly what `deriveResaleSettlement` reads.
// The `DeriveSettlementInput` contract declares the fields — if derive
// reaches for something new, TS stops us here instead of letting the test
// pass with an `undefined` field it never validated.
type SellerOrderInput = NonNullable<DeriveSettlementInput['sellerOrder']>;
type SellerFinancialInput = NonNullable<
  DeriveSettlementInput['sellerFinancial']
>;

function buildSellerOrder(
  overrides: Partial<SellerOrderInput> = {},
): SellerOrderInput {
  return {
    _id: 'order_seller' as SellerOrderInput['_id'],
    amountCents: 5000,
    quantity: 2,
    stripePaymentIntentId: 'pi_seller_1',
    ...overrides,
  };
}

function buildSellerFinancial(
  overrides: Partial<SellerFinancialInput> = {},
): SellerFinancialInput {
  return {
    orderId: 'order_seller' as SellerFinancialInput['orderId'],
    eventId: 'event_1' as SellerFinancialInput['eventId'],
    kind: 'primary',
    tier: 'regular',
    quantity: 2,
    capturedAmountCents: 5000,
    refundedAmountCents: 0,
    recognizedQuantity: 2,
    originalProcessorFeeCents: 175,
    processorFeeCents: 175,
    platformFeeCents: 0,
    lostProcessingFeeCents: 0,
    netRevenueCents: 4825,
    status: 'completed',
    createdAt: 1,
    ...overrides,
  };
}

function buildInput(overrides: {
  sellerOrder: SellerOrderInput | null;
  sellerFinancial: SellerFinancialInput | null;
  resaleFeePct?: number;
  sellerTicketOrderId?: DeriveSettlementInput['sellerTicket']['orderId'];
}): DeriveSettlementInput {
  const sellerTicketOrderId =
    'sellerTicketOrderId' in overrides
      ? overrides.sellerTicketOrderId
      : overrides.sellerOrder?._id;
  return {
    sellerTicket: {orderId: sellerTicketOrderId},
    event: {resaleFeePct: overrides.resaleFeePct ?? 4.2},
    sellerOrder: overrides.sellerOrder,
    sellerFinancial: overrides.sellerFinancial,
  };
}

describe('deriveResaleSettlement', () => {
  it("returns kind: 'none' when the seller ticket has no original order", () => {
    // Complimentary / imported seat: no seller order means nothing to refund.
    const settlement = deriveResaleSettlement(
      buildInput({
        sellerOrder: null,
        sellerFinancial: null,
        sellerTicketOrderId: undefined,
      }),
    );

    expect(settlement).toEqual({
      resaleFeeCents: 0,
      sellerRefundAmount: 0,
      lostProcessingFeeCents: 0,
      refund: {kind: 'none'},
    });
  });

  it("returns kind: 'none' when the seller order exists but is unrefundable and no refund is owed", () => {
    // Seller order exists but loadOrderFinancial returned null (e.g.
    // order.state !== 'completed', or no capture event recorded). With
    // resaleFeePct zeroing out the refund amount, no money is owed, so
    // classification falls through to `'none'` — the same terminal refund
    // state as the complimentary-seat case above. A refund amount > 0
    // would have thrown instead (see the next test).
    const settlement = deriveResaleSettlement(
      buildInput({
        sellerOrder: buildSellerOrder(),
        sellerFinancial: null,
        resaleFeePct: 100,
      }),
    );

    expect(settlement.refund).toEqual({kind: 'none'});
    expect(settlement.sellerRefundAmount).toBe(0);
  });

  it('throws when a refund is owed but the seller order is not refundable', () => {
    // sellerOrder exists but loadOrderFinancial returned null (order.state !==
    // 'completed' or no capture event recorded). Settlement math still owes
    // the seller money, so we must hard-stop rather than silently skip.
    expect(() =>
      deriveResaleSettlement(
        buildInput({
          sellerOrder: buildSellerOrder(),
          sellerFinancial: null,
        }),
      ),
    ).toThrow(ConvexError);
  });

  it("returns kind: 'immediate' when a 100% resale fee leaves nothing to refund", () => {
    // Seller order refundable but sellerRefundAmount rounds to 0, so there is
    // no workpool job to enqueue — flip the listing's sellerRefundState to
    // 'completed' synchronously instead of leaving it in 'pending' forever.
    const settlement = deriveResaleSettlement(
      buildInput({
        sellerOrder: buildSellerOrder(),
        sellerFinancial: buildSellerFinancial(),
        resaleFeePct: 100,
      }),
    );

    expect(settlement.refund).toEqual({kind: 'immediate'});
    expect(settlement.sellerRefundAmount).toBe(0);
    expect(settlement.resaleFeeCents).toBe(2500);
  });

  it("returns kind: 'queued' with a narrowed stripePaymentIntentId when a refund is owed", () => {
    const settlement = deriveResaleSettlement(
      buildInput({
        sellerOrder: buildSellerOrder({
          stripePaymentIntentId: 'pi_seller_enqueue',
        }),
        sellerFinancial: buildSellerFinancial(),
      }),
    );

    expect(settlement.refund.kind).toBe('queued');
    if (settlement.refund.kind !== 'queued') throw new Error('unreachable');
    expect(settlement.refund.refundContext).toEqual({
      sellerOrderId: 'order_seller',
      sellerOrderStripePaymentIntentId: 'pi_seller_enqueue',
    });
    expect(settlement.sellerRefundAmount).toBe(2395);
    expect(settlement.resaleFeeCents).toBe(105);
    expect(settlement.lostProcessingFeeCents).toBe(88);
  });

  it('throws when a refund is owed but the seller order has no stripePaymentIntentId', () => {
    // Seller order is refundable in the domain sense but has no processor
    // PI attached — we have no supported refund provider, so stop hard.
    expect(() =>
      deriveResaleSettlement(
        buildInput({
          sellerOrder: buildSellerOrder({stripePaymentIntentId: undefined}),
          sellerFinancial: buildSellerFinancial(),
        }),
      ),
    ).toThrow(ConvexError);
  });
});
