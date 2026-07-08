import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import {hasEventEnded} from '../../lib/timezone';
import type {CallerIdentity} from '../../lib/caller_identity';
import {throwAppError} from '../../lib/errors';
import type {PaymentErrorCode} from '@shared/contracts/payment-error-codes';

export type OrderErrorCode = PaymentErrorCode | 'FORBIDDEN';

export function throwOrderError(code: OrderErrorCode, message: string): never {
  throwAppError(code, message);
}

export function getOwnerFieldsForInsert(
  identity: CallerIdentity,
): {userId: Id<'users'>} | {guestSessionId: Id<'guest_sessions'>} {
  return identity.type === 'user'
    ? {userId: identity.userId}
    : {guestSessionId: identity.guestSessionId};
}

export function isOrderOwnedByIdentity(
  order: Pick<Doc<'ticket_orders'>, 'userId' | 'guestSessionId'>,
  identity: CallerIdentity,
): boolean {
  return identity.type === 'user'
    ? order.userId === identity.userId
    : order.guestSessionId === identity.guestSessionId;
}

export function assertOrderOwnedByIdentity(
  order: Pick<Doc<'ticket_orders'>, 'userId' | 'guestSessionId'>,
  identity: CallerIdentity,
): void {
  if (!isOrderOwnedByIdentity(order, identity)) {
    throwOrderError('FORBIDDEN', 'You do not have access to this order');
  }
}

export function assertPurchasableEvent(
  event: Pick<
    Doc<'events'>,
    'status' | 'ticketSalesStatus' | 'date' | 'endDate'
  >,
): void {
  if (event.status !== 'published') {
    throwOrderError(
      'EVENT_UNAVAILABLE',
      'This event is not available for purchase',
    );
  }

  const salesStatus = event.ticketSalesStatus ?? 'active';
  if (salesStatus !== 'active') {
    throwOrderError('EVENT_UNAVAILABLE', 'Ticket sales are not active');
  }

  if (hasEventEnded(event)) {
    throwOrderError('EVENT_UNAVAILABLE', 'This event has already occurred');
  }
}

export function assertEventStillFulfillable(
  event: Pick<
    Doc<'events'>,
    'status' | 'ticketSalesStatus' | 'date' | 'endDate'
  >,
): void {
  if (event.status === 'cancelled') {
    throwOrderError('EVENT_UNAVAILABLE', 'This event has been cancelled');
  }

  if (event.ticketSalesStatus === 'paused') {
    throwOrderError('EVENT_UNAVAILABLE', 'Ticket sales are paused');
  }

  if (hasEventEnded(event)) {
    throwOrderError('EVENT_UNAVAILABLE', 'This event has already occurred');
  }
}

export function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throwOrderError('INVALID_STATE', `${label} must be a positive integer`);
  }
}

export async function getOrderForCaller(
  db: Pick<QueryCtx['db'], 'get'> | Pick<MutationCtx['db'], 'get'>,
  args: {
    orderId: Id<'ticket_orders'>;
    identity: CallerIdentity;
  },
): Promise<Doc<'ticket_orders'>> {
  const order = await db.get('ticket_orders', args.orderId);
  if (!order) {
    throwOrderError('INVALID_STATE', 'Order not found');
  }

  assertOrderOwnedByIdentity(order, args.identity);
  return order;
}
