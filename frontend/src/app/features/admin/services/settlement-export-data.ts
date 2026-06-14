import {type SettlementExportInput} from '../models/event-management.model';

type SettlementPurchase = SettlementExportInput['purchases'][number];
type SettlementResaleListing = SettlementExportInput['resaleListings'][number];

export interface RefundTierStats {
  quantity: number;
  amountCents: number;
}

export interface SettlementRefundSummary {
  refundedPurchases: SettlementPurchase[];
  refundsByTier: Partial<Record<SettlementPurchase['tier'], RefundTierStats>>;
  totalRefundedTickets: number;
  hasRefunds: boolean;
}

export function getPurchaseRefundAmountCents(
  purchase: SettlementPurchase,
): number {
  const explicitRefundAmount = purchase.refundedAmountCents ?? 0;
  if (explicitRefundAmount > 0) {
    return explicitRefundAmount;
  }

  return purchase.status === 'refunded' ? purchase.amount : 0;
}

export function getPurchaseRefundedTicketCount(
  purchase: SettlementPurchase,
): number {
  const refundedTicketCount = purchase.tickets.filter(
    (ticket) => ticket.status === 'refunded',
  ).length;
  if (refundedTicketCount > 0) {
    return Math.min(refundedTicketCount, purchase.quantity);
  }

  const refundAmount = getPurchaseRefundAmountCents(purchase);
  if (
    purchase.status === 'refunded' ||
    (purchase.amount > 0 && refundAmount >= purchase.amount)
  ) {
    return purchase.quantity;
  }

  return 0;
}

export function hasPurchaseRefund(purchase: SettlementPurchase): boolean {
  return (
    getPurchaseRefundAmountCents(purchase) > 0 ||
    getPurchaseRefundedTicketCount(purchase) > 0
  );
}

export function summarizeSettlementRefunds(
  purchases: SettlementPurchase[],
): SettlementRefundSummary {
  const refundedPurchases = purchases.filter(hasPurchaseRefund);
  const refundsByTier = refundedPurchases.reduce<
    Partial<Record<SettlementPurchase['tier'], RefundTierStats>>
  >((acc, purchase) => {
    const tier = purchase.tier;
    acc[tier] ??= {quantity: 0, amountCents: 0};
    acc[tier].quantity += getPurchaseRefundedTicketCount(purchase);
    acc[tier].amountCents += getPurchaseRefundAmountCents(purchase);
    return acc;
  }, {});
  const totalRefundedTickets = refundedPurchases.reduce(
    (sum, purchase) => sum + getPurchaseRefundedTicketCount(purchase),
    0,
  );

  return {
    refundedPurchases,
    refundsByTier,
    totalRefundedTickets,
    hasRefunds: refundedPurchases.length > 0,
  };
}

export function completedResaleListings(
  resaleListings: SettlementResaleListing[],
): SettlementResaleListing[] {
  return resaleListings.filter((listing) => listing.status === 'completed');
}
