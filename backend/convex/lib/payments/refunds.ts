import {
  calculatePlatformFee,
  calculateStripeFee,
  PLATFORM_FEE_PERCENT,
} from '../../lib/stripe';

export function getProcessorFeeCents(args: {
  amount: number;
  storedProcessorFeeCents?: number;
}): number {
  if (args.storedProcessorFeeCents !== undefined) {
    return args.storedProcessorFeeCents;
  }

  return calculateStripeFee(args.amount);
}

export function calculateLostProcessingFeeCents(args: {
  refundedAmount: number;
  totalAmount: number;
  storedProcessorFeeCents?: number;
}): number {
  if (args.totalAmount <= 0) return 0;

  const totalFee = getProcessorFeeCents({
    amount: args.totalAmount,
    storedProcessorFeeCents: args.storedProcessorFeeCents,
  });
  const refundRatio = args.refundedAmount / args.totalAmount;
  return Math.round(totalFee * refundRatio);
}

export function calculatePerTicketRefundAmount(
  totalAmount: number,
  quantity: number,
): number {
  return Math.round(totalAmount / Math.max(quantity, 1));
}

export function calculateOrderPerTicketRefundAmount(
  totalAmount: number,
  quantity: number,
): number {
  if (quantity <= 0) {
    return 0;
  }

  return Math.round(totalAmount / quantity);
}

export function calculateRefundedTicketCount(
  totalAmount: number,
  quantity: number,
  refundedAmount: number,
): number {
  if (quantity <= 0 || refundedAmount <= 0) {
    return 0;
  }
  if (refundedAmount >= totalAmount) {
    return quantity;
  }

  const perTicketAmount = calculateOrderPerTicketRefundAmount(
    totalAmount,
    quantity,
  );
  if (perTicketAmount <= 0) {
    return quantity;
  }

  let refundedTicketCount = 0;
  for (let count = 1; count <= quantity; count += 1) {
    const estimatedRefundAmount = estimateRefundedAmountForTicketCount({
      totalAmount,
      refundedTicketCount: count,
      totalTicketCount: quantity,
    });
    if (estimatedRefundAmount > refundedAmount) {
      break;
    }
    refundedTicketCount = count;
  }

  return refundedTicketCount;
}

export function estimateRefundedAmountForTicketCount(args: {
  totalAmount: number;
  refundedTicketCount: number;
  totalTicketCount: number;
}): number {
  if (args.totalTicketCount <= 0) {
    return 0;
  }

  return Math.round(
    (args.refundedTicketCount / args.totalTicketCount) * args.totalAmount,
  );
}

export function calculateRefundableAmountFromTicketCount(args: {
  totalAmount: number;
  refundableTicketCount: number;
  totalTicketCount: number;
}): number {
  return estimateRefundedAmountForTicketCount({
    totalAmount: args.totalAmount,
    refundedTicketCount: args.refundableTicketCount,
    totalTicketCount: args.totalTicketCount,
  });
}

export function calculateRetainedPlatformFeeCents(
  retainedGrossAmountCents: number,
): number {
  return calculatePlatformFee(retainedGrossAmountCents, PLATFORM_FEE_PERCENT);
}

export function generateStripeIdempotencyKey(
  subjectId: string,
  operation: string,
  suffix?: string,
): string {
  const base = `braket-${operation}-${subjectId}`;
  return suffix ? `${base}-${suffix}` : base;
}
