/**
 * Per-account settlement ledger math.
 *
 * Pure module — no Node, no Stripe SDK, no `ctx.db`. The action layer in
 * `stripe/actions.processScheduledPayouts` queries the raw rows, projects
 * them through these functions, and submits the resulting plan to Stripe.
 *
 * The two exports represent the two stages:
 *
 * 1. `computeEventSettlements` — fold every ledger row for a connected
 *    account's events into a per-event net. Uses
 *    `connectedAccountNetCents` (written by Task 6's `recordPaymentCaptured`
 *    from actual Stripe BalanceTransactions) as the source of truth; rows
 *    without that field are skipped rather than estimated.
 *
 * 2. `buildPayoutPlan` — take the per-event settlements, reserve future-
 *    event net, respect the connected account's available Stripe balance,
 *    and allocate the payable amount oldest-first (FIFO by event date).
 */

export interface EventSettlement {
  eventId: string;
  eventDate: number;
  /** Sum of connected-account net from `payment_captured` rows. */
  capturedNetCents: number;
  /**
   * Sum of connected-account net from `payment_refunded` rows. Negative
   * (money out) — less negative when `refund_application_fee=true` because
   * the platform's application fee flows back to the connected account.
   */
  refundNetCents: number;
  /**
   * Sum of dispute money movement (`dispute_funds_withdrawn` negative,
   * `dispute_funds_reinstated` positive). Status-only dispute events are
   * excluded here; this is the actual money-moved figure.
   */
  disputeNetCents: number;
  /** Total already paid out via confirmed `payout_allocations`. */
  alreadyPaidOutCents: number;
  /**
   * capturedNet + refundNet + disputeNet − alreadyPaidOut. Refund and
   * dispute net are negative where appropriate, so this is an addition
   * that happens to subtract them.
   */
  payableCents: number;
}

export interface AccountPayoutPlan {
  connectedAccountId: string;
  /** Events eligible for payout in this run (past date + delay). */
  eligibleEvents: EventSettlement[];
  /**
   * Sum of positive-net future-event settlements. Reserved out of the
   * available balance so funds aren't paid out before the event occurs.
   */
  reservedCents: number;
  /** Sum of `payableCents` across `eligibleEvents`. */
  eligibleNetCents: number;
  /** Available balance on the Stripe account (cents). */
  availableBalanceCents: number;
  /**
   * Final payout amount. `min(eligibleNet, max(0, available − reserved))`.
   * Zero when the available balance is insufficient after reserving.
   */
  payableCents: number;
  /**
   * FIFO allocation (oldest event first) up to `payableCents`. Each
   * allocation's amount is capped at the event's settlement payable.
   */
  allocations: Array<{eventId: string; amountCents: number}>;
}

/**
 * Map each `order_financial_events.kind` to a settlement bucket. Kinds
 * that represent status changes without money movement map to `null` so
 * the aggregator skips them.
 *
 * `dispute_funds_withdrawn` and `dispute_funds_reinstated` are the new
 * kinds from Task 2 that carry the actual connected-account balance
 * impact of a dispute.
 */
const KIND_TO_CATEGORY: Record<
  string,
  'captured' | 'refunded' | 'disputed' | null
> = {
  payment_captured: 'captured',
  payment_refunded: 'refunded',
  dispute_funds_withdrawn: 'disputed',
  dispute_funds_reinstated: 'disputed',
  dispute_opened: null,
  dispute_closed: null,
  late_payment_after_release: null,
  resale_seller_refund_queued: null,
  resale_seller_refund_completed: null,
  resale_seller_refund_failed: null,
  fees_recorded: null,
};

export interface FinancialEventRow {
  eventId: string;
  kind: string;
  connectedAccountNetCents?: number;
}

export interface ConfirmedAllocationRow {
  eventId: string;
  amountCents: number;
}

export interface EventDateRow {
  _id: string;
  date: number;
}

/**
 * Group rows by event and sum each settlement bucket, then subtract the
 * already-paid-out allocations.
 *
 * Rows with an unmapped `kind` or a missing `connectedAccountNetCents` are
 * silently skipped. The dispute-funds kinds carry a signed net, so
 * `disputeNetCents` can be negative (withdrawal) or positive (reinstate).
 */
export function computeEventSettlements(
  financialEvents: ReadonlyArray<FinancialEventRow>,
  events: ReadonlyArray<EventDateRow>,
  confirmedAllocations: ReadonlyArray<ConfirmedAllocationRow>,
): EventSettlement[] {
  const byEvent = new Map<
    string,
    {capturedNet: number; refundNet: number; disputeNet: number}
  >();

  for (const fe of financialEvents) {
    const category = KIND_TO_CATEGORY[fe.kind];
    if (!category) continue;
    if (fe.connectedAccountNetCents === undefined) continue;

    let entry = byEvent.get(fe.eventId);
    if (!entry) {
      entry = {capturedNet: 0, refundNet: 0, disputeNet: 0};
      byEvent.set(fe.eventId, entry);
    }

    if (category === 'captured') {
      entry.capturedNet += fe.connectedAccountNetCents;
    } else if (category === 'refunded') {
      entry.refundNet += fe.connectedAccountNetCents;
    } else {
      entry.disputeNet += fe.connectedAccountNetCents;
    }
  }

  const paidOutByEvent = new Map<string, number>();
  for (const alloc of confirmedAllocations) {
    paidOutByEvent.set(
      alloc.eventId,
      (paidOutByEvent.get(alloc.eventId) ?? 0) + alloc.amountCents,
    );
  }

  const eventDateMap = new Map(events.map((e) => [e._id, e.date]));
  const settlements: EventSettlement[] = [];

  for (const [eventId, sums] of byEvent) {
    const eventDate = eventDateMap.get(eventId);
    if (eventDate === undefined) continue;

    const alreadyPaidOutCents = paidOutByEvent.get(eventId) ?? 0;
    const payableCents =
      sums.capturedNet + sums.refundNet + sums.disputeNet - alreadyPaidOutCents;

    settlements.push({
      eventId,
      eventDate,
      capturedNetCents: sums.capturedNet,
      refundNetCents: sums.refundNet,
      disputeNetCents: sums.disputeNet,
      alreadyPaidOutCents,
      payableCents,
    });
  }

  return settlements;
}

export interface BuildPayoutPlanArgs {
  connectedAccountId: string;
  settlements: ReadonlyArray<EventSettlement>;
  /** Event ids considered past-date-plus-delay and eligible this run. */
  eligibleEventIds: ReadonlySet<string>;
  /** Connected account's available balance (USD cents). */
  availableBalanceCents: number;
}

/**
 * Given per-event settlements, reserve future-event net, compute the
 * account's payable amount, and allocate it FIFO by event date.
 *
 * Invariants:
 * - Eligible events with payable ≤ 0 are dropped from the plan.
 * - Future-event positive payables are reserved.
 * - `payableCents = min(eligibleNet, max(0, available − reserved))`.
 * - Allocation order is oldest event first; each allocation is capped at
 *   the event's payable net.
 */
export function buildPayoutPlan(args: BuildPayoutPlanArgs): AccountPayoutPlan {
  const eligibleEvents = args.settlements
    .filter((s) => args.eligibleEventIds.has(s.eventId) && s.payableCents > 0)
    .slice()
    .sort((a, b) => a.eventDate - b.eventDate);

  const reservedCents = args.settlements
    .filter((s) => !args.eligibleEventIds.has(s.eventId) && s.payableCents > 0)
    .reduce((sum, s) => sum + s.payableCents, 0);

  const eligibleNetCents = eligibleEvents.reduce(
    (sum, s) => sum + s.payableCents,
    0,
  );
  const payableCents = Math.min(
    eligibleNetCents,
    Math.max(0, args.availableBalanceCents - reservedCents),
  );

  const allocations: Array<{eventId: string; amountCents: number}> = [];
  let remaining = payableCents;
  for (const eventSettlement of eligibleEvents) {
    if (remaining <= 0) break;
    const amountCents = Math.min(eventSettlement.payableCents, remaining);
    if (amountCents > 0) {
      allocations.push({eventId: eventSettlement.eventId, amountCents});
      remaining -= amountCents;
    }
  }

  return {
    connectedAccountId: args.connectedAccountId,
    eligibleEvents,
    reservedCents,
    eligibleNetCents,
    availableBalanceCents: args.availableBalanceCents,
    payableCents,
    allocations,
  };
}

/**
 * Tolerance for the ledger trust gate. Steady-state delta is exactly zero
 * because ledger nets come from Stripe BalanceTransactions; the epsilon only
 * absorbs sub-dollar rounding artifacts, never real drift.
 */
export const PAYOUT_TRUST_EPSILON_CENTS = 100;

export interface LedgerTrustGateArgs {
  /** ALL settlements for the account (eligible and future alike). */
  settlements: ReadonlyArray<EventSettlement>;
  /**
   * Sum of `amountCents` over the account's `submitted` payout batches.
   * Money that already left the Stripe balance but whose allocations are
   * not yet confirmed `paid`, so the ledger still claims it.
   */
  inflightSubmittedCents: number;
  /** Connected account's available balance (USD cents). */
  stripeAvailableCents: number;
  /** Connected account's pending balance (USD cents). */
  stripePendingCents: number;
  epsilonCents?: number;
}

export interface LedgerTrustGateResult {
  ok: boolean;
  /** Signed sum of every settlement's payable — expected remaining cash. */
  ledgerClaimCents: number;
  /** available + pending. */
  stripeTruthCents: number;
  /** ledgerClaim − (stripeTruth + inflightSubmitted). */
  deltaCents: number;
}

/**
 * Fail-closed reconciliation gate: the ledger's remaining claim must match
 * the money actually in Stripe before any payout is submitted.
 *
 * The claim is a SIGNED sum — settlements driven negative by post-payout
 * refunds or disputes legitimately offset positive ones, exactly as they do
 * in the real balance. One-off mismatches are expected timing races (a
 * refund debits the balance before its webhook lands, a capture credits
 * pending before its ledger row exists) and self-heal by the next daily
 * run; only a persistent mismatch indicates real divergence.
 */
export function computeLedgerTrustGate(
  args: LedgerTrustGateArgs,
): LedgerTrustGateResult {
  const epsilonCents = args.epsilonCents ?? PAYOUT_TRUST_EPSILON_CENTS;
  const ledgerClaimCents = args.settlements.reduce(
    (sum, s) => sum + s.payableCents,
    0,
  );
  const stripeTruthCents = args.stripeAvailableCents + args.stripePendingCents;
  const deltaCents =
    ledgerClaimCents - (stripeTruthCents + args.inflightSubmittedCents);

  return {
    ok: Math.abs(deltaCents) <= epsilonCents,
    ledgerClaimCents,
    stripeTruthCents,
    deltaCents,
  };
}
