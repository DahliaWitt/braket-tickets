import type {Doc, Id} from '../../_generated/dataModel';
import type {QueryCtx} from '../../_generated/server';
import {
  calculateLostProcessingFeeCents,
  calculateRefundedTicketCount,
  calculateRetainedPlatformFeeCents,
  getProcessorFeeCents,
} from '../payments/refunds';

type ReportingDb = Pick<QueryCtx['db'], 'get' | 'query'>;

export type TicketOrderForReporting = Pick<
  Doc<'ticket_orders'>,
  | '_id'
  | '_creationTime'
  | 'completedAt'
  | 'eventId'
  | 'guestSessionId'
  | 'kind'
  | 'quantity'
  | 'tier'
  | 'amountCents'
  | 'userId'
>;

export type EventOrderFinancial = {
  orderId: Id<'ticket_orders'>;
  eventId: Id<'events'>;
  userId?: Id<'users'>;
  guestSessionId?: Id<'guest_sessions'>;
  kind: Doc<'ticket_orders'>['kind'];
  tier: Doc<'ticket_orders'>['tier'];
  quantity: number;
  capturedAmountCents: number;
  refundedAmountCents: number;
  recognizedQuantity: number;
  originalProcessorFeeCents: number;
  processorFeeCents: number;
  platformFeeCents: number;
  lostProcessingFeeCents: number;
  netRevenueCents: number;
  status: 'completed' | 'refunded';
  createdAt: number;
};

export function summarizeOrderFinancials(
  order: TicketOrderForReporting,
  financialEvents: Array<Doc<'order_financial_events'>>,
): EventOrderFinancial | null {
  const hasCaptureEvent = financialEvents.some(
    (event) => event.kind === 'payment_captured',
  );
  const capturedAmountCents = financialEvents.reduce((sum, event) => {
    if (event.kind !== 'payment_captured') {
      return sum;
    }

    return sum + (event.amountCents ?? 0);
  }, 0);

  if (!hasCaptureEvent && order.amountCents > 0) {
    return null;
  }

  if (
    capturedAmountCents < 0 ||
    (capturedAmountCents === 0 && order.amountCents > 0)
  ) {
    return null;
  }

  const refundedAmountCents = Math.min(
    capturedAmountCents,
    financialEvents.reduce((sum, event) => {
      if (event.kind !== 'payment_refunded') {
        return sum;
      }

      return sum + (event.amountCents ?? 0);
    }, 0),
  );

  const totalProcessorFeeCents = getProcessorFeeCents({
    amount: capturedAmountCents,
  });
  const lostProcessingFeeCents =
    calculateLostProcessingFeeCents({
      refundedAmount: refundedAmountCents,
      totalAmount: capturedAmountCents,
    });
  const processorFeeCents =
    refundedAmountCents >= capturedAmountCents
      ? 0
      : Math.max(0, totalProcessorFeeCents - lostProcessingFeeCents);
  const retainedGrossCents = Math.max(
    0,
    capturedAmountCents - refundedAmountCents,
  );
  const platformFeeCents = calculateRetainedPlatformFeeCents(retainedGrossCents);
  const refundedTicketCount = calculateRefundedTicketCount(
    order.amountCents,
    order.quantity,
    refundedAmountCents,
  );
  const recognizedQuantity = Math.max(0, order.quantity - refundedTicketCount);

  return {
    orderId: order._id,
    eventId: order.eventId,
    userId: order.userId,
    guestSessionId: order.guestSessionId,
    kind: order.kind,
    tier: order.tier,
    quantity: order.quantity,
    capturedAmountCents,
    refundedAmountCents,
    recognizedQuantity,
    originalProcessorFeeCents: totalProcessorFeeCents,
    processorFeeCents,
    platformFeeCents,
    lostProcessingFeeCents,
    netRevenueCents:
      capturedAmountCents -
      refundedAmountCents -
      processorFeeCents -
      platformFeeCents -
      lostProcessingFeeCents,
    status:
      capturedAmountCents > 0 && refundedAmountCents >= capturedAmountCents
        ? 'refunded'
        : 'completed',
    createdAt: order.completedAt ?? order._creationTime,
  };
}

export function summarizeEventOrderFinancials(
  orders: TicketOrderForReporting[],
  financialEvents: Array<Doc<'order_financial_events'>>,
): EventOrderFinancial[] {
  const financialEventsByOrder = new Map<
    Id<'ticket_orders'>,
    Array<Doc<'order_financial_events'>>
  >();

  for (const financialEvent of financialEvents) {
    const orderEvents =
      financialEventsByOrder.get(financialEvent.orderId) ?? [];
    orderEvents.push(financialEvent);
    financialEventsByOrder.set(financialEvent.orderId, orderEvents);
  }

  const summarizedOrders: EventOrderFinancial[] = [];
  for (const order of orders) {
    const summarizedOrder = summarizeOrderFinancials(
      order,
      financialEventsByOrder.get(order._id) ?? [],
    );
    if (summarizedOrder) {
      summarizedOrders.push(summarizedOrder);
    }
  }

  return summarizedOrders;
}

export async function loadEventOrderFinancials(
  db: ReportingDb,
  eventId: Id<'events'>,
): Promise<EventOrderFinancial[]> {
  const financialEvents: Array<Doc<'order_financial_events'>> = [];

  // This helper intentionally computes an exact event-level rollup from the
  // canonical ledger. Keep it on one-shot/reporting paths, not reactive hot
  // paths.
  for await (const financialEvent of db
    .query('order_financial_events')
    .withIndex('by_event', (q) => q.eq('eventId', eventId))) {
    financialEvents.push(financialEvent);
  }

  const orders: TicketOrderForReporting[] = [];
  for await (const order of db
    .query('ticket_orders')
    .withIndex('by_event_and_state', (q) =>
      q.eq('eventId', eventId).eq('state', 'completed'),
    )) {
    orders.push(order);
  }

  return summarizeEventOrderFinancials(orders, financialEvents);
}

export async function loadOrderFinancial(
  db: ReportingDb,
  orderId: Id<'ticket_orders'>,
): Promise<EventOrderFinancial | null> {
  const order = await db.get('ticket_orders', orderId);
  if (!order || order.state !== 'completed') {
    return null;
  }

  const financialEvents: Array<Doc<'order_financial_events'>> = [];
  for await (const financialEvent of db
    .query('order_financial_events')
    .withIndex('by_order', (q) => q.eq('orderId', orderId))) {
    financialEvents.push(financialEvent);
  }

  return summarizeOrderFinancials(order, financialEvents);
}
