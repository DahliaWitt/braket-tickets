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

/**
 * Upper bound on a client free-claim idempotency key. The frontend mints a
 * 36-char `crypto.randomUUID()`; 64 leaves headroom for any future prefixed
 * scheme while keeping the value far below Convex's document/index size limits
 * so a direct (non-browser) caller cannot write a huge document or index entry.
 */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 64;

/**
 * Restrict the key to the UUID charset plus URL-safe separators. `randomUUID`
 * only ever produces `[0-9a-f-]`; `_` is permitted so the contract survives a
 * base64url-style key without a schema change. Anything else (whitespace,
 * punctuation, control bytes, multi-byte payloads) is a contract violation.
 */
const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9_-]+$/;

/**
 * Validate a caller-supplied free-claim idempotency key before it is used for
 * an index lookup or persisted on the order. These are public mutations, so
 * the value is fully attacker-controlled: reject blank / over-long /
 * non-conforming strings up front rather than indexing and storing arbitrary
 * data on every order.
 */
export function assertValidIdempotencyKey(value: string): void {
  if (value.trim().length === 0) {
    throwOrderError('INVALID_STATE', 'Idempotency key must not be blank');
  }
  if (value.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throwOrderError(
      'INVALID_STATE',
      `Idempotency key exceeds maximum length of ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`,
    );
  }
  if (!IDEMPOTENCY_KEY_REGEX.test(value)) {
    throwOrderError('INVALID_STATE', 'Idempotency key is malformed');
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
