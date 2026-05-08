import {v, type Infer} from 'convex/values';
import {TICKET_TIERS, type TicketTier as SharedTicketTier} from '@shared/domain/ticket-tier';
import {TICKET_STATUSES, type TicketStatus as SharedTicketStatus} from '@shared/domain/ticket-status';
import {
  RESALE_LISTING_STATUSES,
  type ResaleListingStatus as SharedResaleListingStatus,
} from '@shared/domain/resale-listing-status';
import type {AssertEqual} from '../type_utils';

export type {TicketTier} from '@shared/domain/ticket-tier';
export type {TicketStatus} from '@shared/domain/ticket-status';
export type {ResaleListingStatus} from '@shared/domain/resale-listing-status';
export type TicketOrderKind = 'primary' | 'resale';
export type TicketOrderState = 'open' | 'completed' | 'released';
export type TicketOrderReleaseReason =
  | 'expired'
  | 'payment_failed'
  | 'cancelled'
  | 'superseded'
  | 'late_invalid';
export type SellerRefundState =
  | 'pending'
  | 'retrying'
  | 'completed'
  | 'failed';
export type CallerTrustSource =
  | 'direct'
  | 'shared'
  | 'open_access';
export type OrderFinancialEventKind =
  | 'payment_captured'
  | 'payment_refunded'
  | 'late_payment_after_release'
  | 'dispute_opened'
  | 'dispute_closed'
  | 'dispute_funds_withdrawn'
  | 'dispute_funds_reinstated'
  | 'resale_seller_refund_queued'
  | 'resale_seller_refund_completed'
  | 'resale_seller_refund_failed';

export const tierValidator = v.union(
  v.literal(TICKET_TIERS[0]),
  v.literal(TICKET_TIERS[1]),
  v.literal(TICKET_TIERS[2]),
);

export const ticketStatusValidator = v.union(
  v.literal(TICKET_STATUSES[0]),
  v.literal(TICKET_STATUSES[1]),
  v.literal(TICKET_STATUSES[2]),
  v.literal(TICKET_STATUSES[3]),
);

const _tierValidatorMatchesShared: AssertEqual<
  Infer<typeof tierValidator>,
  SharedTicketTier
> = true;

const _ticketStatusValidatorMatchesShared: AssertEqual<
  Infer<typeof ticketStatusValidator>,
  SharedTicketStatus
> = true;

export function isValidTicketStatus(
  status: SharedTicketStatus,
): status is 'valid' {
  return status === 'valid';
}

export function isUsedTicketStatus(status: SharedTicketStatus): status is 'used' {
  return status === 'used';
}

export function isRefundedTicketStatus(
  status: SharedTicketStatus,
): status is 'refunded' {
  return status === 'refunded';
}

export function isExpiredTicketStatus(
  status: SharedTicketStatus,
): status is 'expired' {
  return status === 'expired';
}

export function isActiveTicketStatus(
  status: SharedTicketStatus,
): status is 'valid' | 'used' {
  return isValidTicketStatus(status) || isUsedTicketStatus(status);
}

export function isVisibleInMyTicketsStatus(
  status: SharedTicketStatus,
): status is 'valid' | 'used' | 'refunded' {
  return !isExpiredTicketStatus(status);
}

/**
 * Denormalized roster projection status persisted on `tickets` rows and used
 * by `event_analytics` + the CSV export. Distinct from `TicketStatus` — the
 * roster flattens the `'valid' | 'used' | 'refunded' | 'expired'` source into
 * the surface-level states attendees and organizers actually see:
 *
 *   - `valid`      → ticket has not been redeemed (ticket.status === 'valid')
 *   - `checked_in` → attendee has been checked in (ticket.status === 'used')
 *   - `refunded`   → ticket refunded
 *   - `cancelled`  → order expired before completion (ticket.status === 'expired')
 *
 * Backend-only: this vocabulary is an internal reporting projection, not a
 * shared frontend contract.
 */
export const ROSTER_STATUSES = [
  'valid',
  'checked_in',
  'refunded',
  'cancelled',
] as const;
export type RosterStatus = typeof ROSTER_STATUSES[number];

export const rosterStatusValueValidator = v.union(
  v.literal(ROSTER_STATUSES[0]),
  v.literal(ROSTER_STATUSES[1]),
  v.literal(ROSTER_STATUSES[2]),
  v.literal(ROSTER_STATUSES[3]),
);

export const rosterStatusValidator = v.optional(rosterStatusValueValidator);

const _rosterStatusValidatorMatchesType: AssertEqual<
  Infer<typeof rosterStatusValueValidator>,
  RosterStatus
> = true;

export const resaleListingStatusValidator = v.union(
  v.literal(RESALE_LISTING_STATUSES[0]),
  v.literal(RESALE_LISTING_STATUSES[1]),
  v.literal(RESALE_LISTING_STATUSES[2]),
  v.literal(RESALE_LISTING_STATUSES[3]),
);

const _resaleListingStatusValidatorMatchesShared: AssertEqual<
  Infer<typeof resaleListingStatusValidator>,
  SharedResaleListingStatus
> = true;

export const ticketOrderKindValidator = v.union(
  v.literal('primary'),
  v.literal('resale'),
);

export const ticketOrderStateValidator = v.union(
  v.literal('open'),
  v.literal('completed'),
  v.literal('released'),
);

export const ticketOrderReleaseReasonValidator = v.union(
  v.literal('expired'),
  v.literal('payment_failed'),
  v.literal('cancelled'),
  v.literal('superseded'),
  v.literal('late_invalid'),
);

export const sellerRefundStateValidator = v.union(
  v.literal('pending'),
  v.literal('retrying'),
  v.literal('completed'),
  v.literal('failed'),
);

export const disputeStatusValidator = v.union(
  v.literal('needs_response'),
  v.literal('under_review'),
  v.literal('won'),
  v.literal('lost'),
  v.literal('withdrawn'),
);

export const callerTrustSourceValidator = v.union(
  v.literal('direct'),
  v.literal('shared'),
  v.literal('open_access'),
);

export const orderFinancialEventKindValidator = v.union(
  v.literal('payment_captured'),
  v.literal('payment_refunded'),
  v.literal('late_payment_after_release'),
  v.literal('dispute_opened'),
  v.literal('dispute_closed'),
  /**
   * Connected account was debited for a dispute (Stripe's
   * `charge.dispute.funds_withdrawn` event). `connectedAccountNetCents` is
   * negative here.
   */
  v.literal('dispute_funds_withdrawn'),
  /**
   * Dispute resolved in favor of the merchant and Stripe returned funds to
   * the connected account (`charge.dispute.funds_reinstated`).
   * `connectedAccountNetCents` is positive here.
   */
  v.literal('dispute_funds_reinstated'),
  v.literal('resale_seller_refund_queued'),
  v.literal('resale_seller_refund_completed'),
  v.literal('resale_seller_refund_failed'),
);

/**
 * Compile-time guard: the runtime validator must mirror the TS union so
 * `ctx.db.patch` / `ctx.db.insert` stay checked against the string-literal
 * type everywhere.
 */
const _orderFinancialEventKindMatchesType: AssertEqual<
  Infer<typeof orderFinancialEventKindValidator>,
  OrderFinancialEventKind
> = true;
