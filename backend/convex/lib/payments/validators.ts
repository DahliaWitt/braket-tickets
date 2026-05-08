import {v} from 'convex/values';

export const singleTicketRefundInfoValidator = v.object({
  refundAmount: v.number(),
  canRefund: v.boolean(),
  reason: v.optional(v.string()),
  orderId: v.optional(v.id('ticket_orders')),
  orderStripePaymentIntentId: v.optional(v.string()),
  orderAmount: v.optional(v.number()),
  orderProcessorFee: v.optional(v.number()),
  orderEventId: v.optional(v.id('events')),
});

export const refundableAmountValidator = v.object({
  refundableAmount: v.number(),
  validTicketCount: v.number(),
  totalTicketCount: v.number(),
});

export const refundResultValidator = v.object({
  success: v.boolean(),
  refundedAmount: v.number(),
  ticketsRefunded: v.number(),
  lostProcessingFee: v.number(),
});

export const refundTicketResultValidator = v.object({
  success: v.boolean(),
  refundedAmount: v.number(),
  lostProcessingFee: v.number(),
});
