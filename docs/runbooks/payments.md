---
title: Payments
category: Runbooks
order: 11
description: Incident response runbook — payments
access: public
---

# Payment Incidents

This runbook is for engineers or admins who investigate checkout, webhook, refund, or settlement issues in the ticketing flow. It assumes access to Convex Dashboard and Stripe Dashboard. Use it when orders stick, tickets do not issue, or payment state and ticket state drift apart. Use [Event Change Refunds](./event-change-refunds.md) for cancellation, postponement, reschedule, moved-event, or buyer refund-request operations. Use [Stripe Connect Ops](./stripe-connect-ops.md) for organizer onboarding or payouts.

This runbook uses the current Stripe-only ticketing architecture:

- inventory is enforced through `events.inventoryId -> event_inventory`
- checkout attempts live in `ticket_orders`
- payment/refund/dispute history lives in `order_financial_events`
- Stripe webhook dedupe/audit lives in `stripe_webhook_events` (claim rows with `status = pending | completed | failed`)
- frontend checkout uses Stripe Embedded Checkout backed by Checkout Sessions

Do not diagnose ticket sales incidents from ticket rows alone. Use the order plus financial-event ledger as the canonical runtime state.

Jump to:

- [Release a stuck open order](#release-a-stuck-open-order)
- [Resolve a paid order with no ticket](#resolve-a-paid-order-with-no-ticket)
- [Handle a late success after expiry](#handle-a-late-success-after-expiry)
- [Repair Stripe webhook processing](#repair-stripe-webhook-processing)
- [Resolve a failed refund](#resolve-a-failed-refund)
- [Reconcile revenue](#reconcile-revenue)
- [Pause ticket sales](#pause-ticket-sales)

## Canonical Tables

When investigating a ticketing incident, check these in order:

1. `events`
2. `event_inventory`
3. `ticket_orders`
4. `order_financial_events`
5. `stripe_webhook_events`
6. `tickets`

### Quick invariants

- Primary remaining inventory = `events.totalTickets - event_inventory.soldCount - event_inventory.heldCount`
- `ticket_orders.state = open` means the order currently holds inventory or a resale listing
- `ticket_orders.state = completed` means tickets were issued or resale completed
- `ticket_orders.state = released` means the hold is gone and the order no longer blocks inventory
- For primary orders, `event_inventory.heldCount` should equal the sum of open primary `ticket_orders.quantity` for the event
- Refund/dispute status is derived from `order_financial_events` and ticket state, not from mutable order summary fields

---

## Release a stuck open order

**Symptom:** Customer reports their reservation is still open long after checkout should have expired, or inventory appears stuck.

### Diagnosis

1. Find the order in Convex Dashboard → Data → `ticket_orders`
2. Check:
   - `state`
   - `expiresAt`
   - `releasedAt`
   - `stripeCheckoutSessionId`
3. If this is a primary order, inspect the linked `event_inventory` row and confirm `heldCount`
4. In Stripe Dashboard, inspect the Checkout Session by `stripeCheckoutSessionId`

### Compare the order to the expected state

- open order + open Checkout Session before `expiresAt`: healthy
- open order + expired Checkout Session: should be released by webhook or scheduled expiry
- open order + non-card `payment_intent.payment_failed`: should be released by webhook as `payment_failed`
- released order + expired reason: healthy cleanup path
- released order + payment_failed reason: healthy cleanup path after a non-card Stripe processing failure

### Resolution

- If Stripe shows the Checkout Session is `expired` but the order is still `open`, manually run:

```bash
pnpm convex run --prod orders/core:expire '{"orderId":"<order_id>","force":true}'
```

- If this is a primary order, verify `event_inventory.heldCount` decreases after release.
- If this is a resale order, verify the listing returns to `status = "listed"` and `pendingOrderId` clears.
- If there are no open primary orders but `event_inventory.heldCount` is still positive, check for counter drift:

```bash
pnpm convex run --prod orders/core:getHeldInventoryReconciliation '{"eventId":"<event_id>"}'
```

Only repair after confirming `openPrimaryHeldCount` is the intended held count and passing the current stored value as a guard:

```bash
pnpm convex run --prod orders/core:repairHeldInventoryCount '{"eventId":"<event_id>","expectedStoredHeldCount":<current_held_count>}'
```

---

## Resolve a paid order with no ticket

**Symptom:** Customer completed payment but has no ticket in the app.

### Diagnosis

1. Find the order in `ticket_orders`
2. Check:
   - `state`
   - `stripeCheckoutSessionId`
   - `stripePaymentIntentId`
   - `stripeChargeId`
3. Inspect `order_financial_events` for:
   - `payment_captured`
   - `late_payment_after_release`
   - `payment_refunded`
4. Inspect `tickets` for rows with `orderId = <order_id>`
5. Inspect `stripe_webhook_events` for duplicate or failed processing patterns (filter by `status` — `pending` past 5 min is stale, `failed` is a poison pill the reaper surfaced)
6. In Stripe Dashboard, verify the Checkout Session `payment_status`

### Interpret the current state

- `state = completed` + tickets exist: fulfillment succeeded
- `state = completed` + no tickets: treat as a backend bug, investigate immediately
- `state = released` + `late_payment_after_release` event exists: late payment was rejected and should auto-refund
- `state = open` + Stripe paid: sync/webhook likely failed to finish completion

### Resolution

- If Stripe shows `payment_status = paid` and the order is still `open`, run:

```bash
pnpm convex run --prod orders:syncCheckoutSession '{"checkoutSessionId":"<checkout_session_id>"}'
```

- If the order was already released because it expired:
  - if capacity/listing is still valid, the sync path should complete it
  - otherwise the system should append `late_payment_after_release` and auto-refund
- If the order is `completed` but tickets are missing, escalate immediately; that should not happen under the transactional completion path

---

## Handle a late success after expiry

**Symptom:** Stripe reports a paid Checkout Session after the reservation was already released.

### Apply the expected policy

- If primary inventory is still available and the event is still valid, fulfill the order
- If inventory is no longer available, the event is paused/cancelled/past, or the resale listing is no longer valid, auto-refund
- Always record the anomaly in `order_financial_events`
- Acknowledge Stripe once the event is durably recorded, except when capture
  or refund settlement is still missing Stripe BalanceTransaction data; those
  cases intentionally stay retryable so payout ledger rows are not recorded
  without `connectedAccountNetCents`.
- Never use a webhook 4xx/5xx as a business rollback mechanism

### Resolution

1. Inspect `ticket_orders.releaseReason`
2. Inspect current `event_inventory` or `resale_listings` state
3. Confirm whether the system already created:
   - `payment_captured`, or
   - `late_payment_after_release` + `payment_refunded`
4. If the order is still unresolved, run the order sync path rather than mutating rows by hand:

```bash
pnpm convex run --prod orders:syncCheckoutSession '{"checkoutSessionId":"<checkout_session_id>"}'
```

5. If an automatic refund did not occur, issue the refund in Stripe and then record the refund event through the admin/debug path

---

## Repair Stripe webhook processing

**Symptom:** Payments succeed in Stripe but orders do not transition, or webhook retries continue.

### Webhook claim lifecycle

Every Stripe delivery claims a row in `stripe_webhook_events` before any side effect runs. The row is the idempotency primitive:

- `status = pending`, `claimedAt` recent: a handler is currently processing. Concurrent redeliveries inside the 5-minute stale window (`STALE_CLAIM_THRESHOLD_MS` in `convex/stripe/_impl/webhook_claims.ts`) observe this and skip.
- `status = pending`, `claimedAt` older than 5 min: the original attempt crashed or timed out. The next Stripe retry reclaims the row, increments `attempts`, and re-runs the handler.
- `status = completed`: handler finished successfully. All future redeliveries short-circuit.
- `status = failed`: either a terminal failure finalized the row, or the reaper promoted a stale pending row after the 96h poison-pill window (`REAPER_FAILURE_TIMEOUT_MS`). Failed rows are preserved for operator inspection, never auto-retried.

Defense-in-depth: `order_financial_events` also dedups on `(orderId, kind, stripeEventId)` via `by_order_and_kind_and_stripeEventId`, so even a hypothetical claim-layer escape cannot double-book a ledger entry.

The reaper runs every 30 minutes (`reap stale Stripe webhook claims` cron → `stripe/webhooks.reapStaleStripeWebhookClaims` → `stripe/_impl/webhook_claims.reapStaleWebhookClaims`) and promotes at most 100 stale pending rows per run (`REAPER_BATCH_SIZE`).

### Diagnosis

1. Check Stripe Dashboard → Developers → Webhooks → Recent deliveries
2. Inspect failed deliveries and confirm which event type is failing:
   - `account.updated`
   - `checkout.session.completed`
   - `checkout.session.expired`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `charge.refunded`
   - `charge.dispute.created`
   - `charge.dispute.closed`
3. Check Convex logs for the Stripe handler (`stripe/actions:verifyAndProcessWebhook` and `stripe/_impl/webhook_dispatch`)
4. Inspect `stripe_webhook_events` by `stripeEventId` to see the claim row's current `status`, `attempts`, `failureReason`

### Resolution

```bash
# Re-sync webhook secrets to Convex after rotating in Stripe
DOPPLER_CONFIG=prd pnpm sync:env:prod
```

- Retry failed deliveries from Stripe Dashboard once the secret/config issue is fixed
- If Stripe keeps retrying the same event and the row is `pending` but never advances: handler is crashing silently. Pull Convex logs for the `stripeEventId` and investigate. A retry within 5 min will skip as `in_flight`; after 5 min the next retry reclaims and re-runs.
- New Checkout Sessions explicitly set `payment_intent_data.capture_method = automatic` to avoid Stripe's `automatic_async` balance-transaction timing gap in the capture ledger path. If logs still mention `payment_captured missing balance_transaction`, the event is likely from an older `automatic_async` session or a transient Stripe lag; keep the Stripe delivery retrying. Buyer checkout sync may still return a completed status while webhook retry waits to enrich the `payment_captured` ledger row with the real connected-account net.
- If logs mention `Refund balance transaction unavailable`, `refund missing balance_transaction`, or `charge.refunded missing refund object`, keep the Stripe delivery retrying. The handler is waiting for Stripe to expose the BalanceTransaction so the payout ledger can record the real connected-account net.
- If the row is already `completed` but Stripe keeps delivering, Stripe has a stale retry queue — the handler is idempotent and will short-circuit, no action required.
- If the row is `failed` with `failureReason = 'stale_timeout'`, the reaper gave up after 96h. Inspect the event payload in Stripe, decide whether to replay it manually (clear the row first, then retry from Stripe) or write it off.

---

## Resolve a failed refund

**Symptom:** Admin initiates a refund or the system schedules an auto-refund, but Stripe does not return funds.

### Diagnosis

1. Find the order in `ticket_orders`
2. Inspect `order_financial_events` for:
   - `payment_refunded`
   - `late_payment_after_release`
   - `connectedAccountNetCents` on Connect refund rows
3. Check Stripe Dashboard for the charge/refund IDs
4. Confirm ticket state:
   - primary refunds should move affected tickets to `refunded`
   - resale refunds should not alter primary inventory counts

### Resolution

- Retry or issue the refund in Stripe Dashboard if Stripe-side processing failed
- Then ensure the corresponding financial event is recorded so the order history is complete
- If ticket state and financial events disagree, prioritize ticket entitlement safety first and escalate

---

## Reconcile revenue

**When to use:** Monthly reconciliation or after a suspected payment incident.

### Steps

1. Export `order_financial_events` for:
   - `payment_captured`
   - `payment_refunded`
2. Group by `eventId` or `orderId`
3. Compare totals against Stripe Dashboard → Balance → Activity
4. Investigate discrepancies:
   - financial event without a corresponding Stripe object
   - Stripe charge with no `payment_captured` event
   - refund in Stripe with no `payment_refunded` event

`order_financial_events` is the ledger to reconcile against.

---

## Pause ticket sales

If you need to stop ticket sales immediately:

1. Use the admin UI to set the event ticket sales status to `paused`
2. For a full stop, set the event status to `cancelled`

Behavior:

- `paused`
  - blocks new orders
  - allows existing open orders to run until expiry
  - late-success payments after release auto-refund
- `cancelled`
  - blocks new orders and checkout starts
  - releases open primary and resale orders
  - late-success payments auto-refund

Avoid disabling Stripe secrets as an emergency stop unless the payment provider itself is the incident. Pausing or cancelling the event preserves clearer state and cleaner recovery.
