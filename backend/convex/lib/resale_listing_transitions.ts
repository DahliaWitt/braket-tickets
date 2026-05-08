import type {Doc, Id} from '../_generated/dataModel';
import type {ResaleListingStatus} from './validators/ticketing';
import {throwAppError} from './errors';

export type {ResaleListingStatus} from './validators/ticketing';

/**
 * Legal resale-listing state transitions.
 *
 * The listing lifecycle is a four-state finite state machine. Every legal
 * transition is driven by exactly one callsite helper below, and every
 * transition flows through `assertValidListingTransition` so schema drift
 * here forces an immediate failure rather than a silent bad state.
 *
 * ## Transition table
 *
 * | From      | To          | Trigger                                  | Patch builder                      |
 * | --------- | ----------- | ---------------------------------------- | ---------------------------------- |
 * | (insert)  | `listed`    | Seller publishes a listing               | `buildNewListingStatusFields`      |
 * | listed    | `pending`   | Buyer enters checkout                    | `buildAcquirePatch`                |
 * | listed    | `cancelled` | Seller withdraws or ticket is checked-in | `buildCancellationPatch`           |
 * | pending   | `listed`    | Buyer abandons (expiry / failure / stale cleanup) | `buildReopenPatch`        |
 * | pending   | `completed` | Buyer checkout succeeds                  | `buildCompletionPatch`             |
 * | completed | —           | Terminal (seller-refund overlays only)   | `buildSellerRefund*Patch`          |
 * | cancelled | —           | Terminal                                 | —                                  |
 *
 * ## Explicitly illegal transitions
 *
 * These are the ones most likely to be introduced by accident:
 *  - `listed → listed`: no-op patch that would clobber `buyerId` history.
 *  - `listed → completed`: skipping the `pending` lock lets two buyers race.
 *  - `pending → cancelled`: would strand the buyer with a pending order; use
 *    the reopen path (`pending → listed`) or let checkout time out.
 *  - `completed → *`: resale bookkeeping is immutable once settled.
 *  - `cancelled → *`: once withdrawn, sellers must publish a new listing.
 *
 * After reaching `completed`, the row accepts overlay patches from
 * `buildSellerRefund*Patch` that mutate only the `sellerRefund*` fields —
 * those are NOT status transitions and do not pass through the FSM guard.
 */
const LEGAL_RESALE_LISTING_TRANSITIONS: Readonly<
  Record<ResaleListingStatus, ReadonlySet<ResaleListingStatus>>
> = {
  listed: new Set<ResaleListingStatus>(['pending', 'cancelled']),
  pending: new Set<ResaleListingStatus>(['listed', 'completed']),
  completed: new Set<ResaleListingStatus>(),
  cancelled: new Set<ResaleListingStatus>(),
};

/**
 * Throw if `from → to` is not a permitted resale-listing status transition.
 */
export function assertValidListingTransition(
  from: ResaleListingStatus,
  to: ResaleListingStatus,
): void {
  const allowed = LEGAL_RESALE_LISTING_TRANSITIONS[from];
  if (allowed.has(to)) return;

  throwAppError(
    'INVALID_STATE',
    `Illegal resale listing transition: ${from} → ${to}`,
  );
}

export function isListedResaleListingStatus(
  status: ResaleListingStatus,
): status is 'listed' {
  return status === 'listed';
}

export function isPendingResaleListingStatus(
  status: ResaleListingStatus,
): status is 'pending' {
  return status === 'pending';
}

export function isCompletedResaleListingStatus(
  status: ResaleListingStatus,
): status is 'completed' {
  return status === 'completed';
}

export function isCancelledResaleListingStatus(
  status: ResaleListingStatus,
): status is 'cancelled' {
  return status === 'cancelled';
}

export function isActiveResaleListingStatus(
  status: ResaleListingStatus,
): status is 'listed' | 'pending' {
  return (
    isListedResaleListingStatus(status) || isPendingResaleListingStatus(status)
  );
}

export function doesResaleListingLockTicket(
  status: ResaleListingStatus,
): boolean {
  return isActiveResaleListingStatus(status);
}

/**
 * Returns the status literal for a brand-new resale listing.
 *
 * Callers still supply `ticketId`, `eventId`, and `sellerId` themselves; this
 * only pins the initial status so no raw `'listed'` literal leaks into
 * insert call sites.
 */
export function buildNewListingStatusFields(): {status: 'listed'} {
  return {status: 'listed'};
}

type AcquirePatch = {
  status: 'pending';
  buyerId: Id<'users'>;
  pendingOrderId: Id<'ticket_orders'>;
};

/**
 * Build the patch that moves a listing from `listed` → `pending` when a buyer
 * enters checkout. Pair with `assertValidListingTransition(from, 'pending')`.
 */
export function buildAcquirePatch(args: {
  buyerId: Id<'users'>;
  pendingOrderId: Id<'ticket_orders'>;
}): AcquirePatch {
  return {
    status: 'pending',
    buyerId: args.buyerId,
    pendingOrderId: args.pendingOrderId,
  };
}

type ReopenPatch = Partial<Doc<'resale_listings'>> & {
  status: 'listed';
  buyerId: undefined;
  pendingOrderId: undefined;
};

/**
 * Build the patch that moves a listing from `pending` → `listed` when a buyer
 * abandons checkout (expired order, failed payment, stale cleanup).
 *
 * Clears `buyerId` and `pendingOrderId` so the listing
 * returns to the open queue with no residual buyer state.
 */
export function buildReopenPatch(): ReopenPatch {
  return {
    status: 'listed',
    buyerId: undefined,
    pendingOrderId: undefined,
  };
}

type CompletionPatch = {
  status: 'completed';
  completedAt: number;
  sellerRefundAmountCents: number;
  resaleFeeCents: number;
  lostProcessingFeeCents: number;
  sellerRefundState: 'pending';
};

/**
 * Build the patch that moves a listing from `pending` → `completed` after a
 * successful buyer checkout. `sellerRefundState` starts at `'pending'`; the
 * caller may override it via a spread when the seller refund has already been
 * resolved synchronously (see `lib/resale/settlement.ts`).
 */
export function buildCompletionPatch(args: {
  sellerRefundAmountCents: number;
  resaleFeeCents: number;
  lostProcessingFeeCents: number;
  now: number;
}): CompletionPatch {
  return {
    status: 'completed',
    completedAt: args.now,
    sellerRefundAmountCents: args.sellerRefundAmountCents,
    resaleFeeCents: args.resaleFeeCents,
    lostProcessingFeeCents: args.lostProcessingFeeCents,
    sellerRefundState: 'pending',
  };
}

type CancellationPatch = {
  status: 'cancelled';
  cancelledAt: number;
};

/**
 * Build the patch that moves a listing from `listed` → `cancelled` (seller
 * withdrawal or check-in of the underlying ticket).
 */
export function buildCancellationPatch(args: {now: number}): CancellationPatch {
  return {
    status: 'cancelled',
    cancelledAt: args.now,
  };
}

/**
 * Partial listing patch describing the current seller-refund phase. Always
 * layered on top of `buildCompletionPatch` at a finalization site so the
 * canonical completion fields are preserved and only refund-state fields
 * are overridden.
 */
export type SellerRefundListingPatch = {
  sellerRefundState?: 'pending' | 'retrying' | 'completed' | 'failed';
  sellerRefundAttempts?: number;
  sellerRefundCompletedAt?: number;
  sellerRefundFailedAt?: number | null;
  sellerRefundNextRetryAt?: number | null;
  sellerRefundLastError?: string | null;
};

/**
 * Build the refund-state overlay for a listing whose seller refund has just
 * been enqueued. Keeps `sellerRefundState: 'pending'` (matching
 * `buildCompletionPatch`'s default) and zeroes the attempt/retry counters
 * so the workpool's onComplete handler can compare against `retryCount`.
 */
export function buildSellerRefundPendingPatch(): SellerRefundListingPatch {
  return {
    sellerRefundState: 'pending',
    sellerRefundAttempts: 0,
    sellerRefundFailedAt: null,
    sellerRefundNextRetryAt: null,
    sellerRefundLastError: null,
  };
}

/**
 * Build the refund-state overlay when the seller-refund lifecycle is fully
 * resolved inside the finalization mutation with no workpool handoff.
 *
 * Used for two cases the finalization pipeline collapses into one state:
 *  - no refund source: complimentary / imported seat, no seller order to
 *    refund against.
 *  - refund source present but $0 owed: e.g. 100% resale fee.
 *
 * Both leave nothing for the workpool to do, so the listing must be flipped
 * off `'pending'` in the same mutation; otherwise it sits indefinitely
 * waiting for a completion that will never fire.
 */
export function buildSellerRefundResolvedPatch(args: {
  now: number;
}): SellerRefundListingPatch {
  return {
    sellerRefundState: 'completed',
    // Explicit 0 (not omitted) so the listing row's refund bookkeeping is
    // always in a canonical resolved shape: no prior retry residue carries
    // over, and read models can assume `sellerRefundAttempts` is defined
    // whenever `sellerRefundState` is set.
    sellerRefundAttempts: 0,
    sellerRefundCompletedAt: args.now,
    sellerRefundFailedAt: null,
    sellerRefundNextRetryAt: null,
    sellerRefundLastError: null,
  };
}
