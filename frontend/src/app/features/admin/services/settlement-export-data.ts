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

/**
 * Matches `YYYY-MM-DD` date-only strings. Date-only values must be constructed
 * as local dates, otherwise `new Date('2026-01-15')` renders as Jan 14 in US
 * timezones.
 */
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseSettlementEventDate(value: string): Date {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (match) {
    const [, yearStr, monthStr, dayStr] = match;
    return new Date(Number(yearStr), Number(monthStr) - 1, Number(dayStr));
  }
  return new Date(value);
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
