---
title: Payment Edge Cases
category: Reference
order: 2
description: Ticketing and payment design edge cases
access: public
---

# Payment Edge Cases

This reference documents the payment and ticketing edge cases that shape checkout, reservation expiry, webhook settlement, refunds, and disputes:

- inventory is held in `event_inventory`
- purchase attempts live in `ticket_orders`
- Stripe Embedded Checkout uses Checkout Sessions
- Stripe webhooks and landing-page sync both feed the same idempotent order completion path
- `order_financial_events` is the audit ledger

## 1. Checkout Session Expires Before Completion

### Runtime Behavior

- `ticket_orders.expiresAt` is set to 30 minutes from order creation
- Stripe Checkout Session uses the same `expires_at`
- local release is scheduled at `expiresAt + 2 minutes`
- `checkout.session.expired` should release the order early if Stripe reports expiry first

### Expected Result

| Order Kind | Post-expiry result                                                        |
| ---------- | ------------------------------------------------------------------------- |
| primary    | `ticket_orders.state = released`, `event_inventory.heldCount` decremented |
| resale     | `ticket_orders.state = released`, listing returned to `status = "listed"` |

### Risk

The scheduled release or webhook can be delayed, temporarily leaving the order open and inventory/listing held longer than intended.

### Mitigation

- same-owner retry path releases already-expired open orders inline before creating a fresh order
- scheduled release is idempotent
- Stripe expiry webhook and local expiry scheduler both converge on the same release path

## 2. Buyer Refreshes or Closes the Browser Mid-Checkout

### Runtime Behavior

- the order remains `open`
- inventory or resale listing remains reserved until expiry
- embedded Checkout can be resumed using the existing Checkout Session bound to the order
- landing-page sync and Stripe webhooks can both complete the order if payment succeeded

### Expected Result

| Browser Event                  | Stripe paid? | Final state                           |
| ------------------------------ | ------------ | ------------------------------------- |
| user closes before paying      | No           | order expires and releases            |
| user closes after paying       | Yes          | webhook or sync completes order       |
| user refreshes during checkout | Maybe        | existing session reused if still open |

### Mitigation

- `orders.startCheckout` reuses the bound open Checkout Session
- `orders.syncCheckoutSession` lets the success page reconcile immediately
- webhooks remain authoritative if the buyer never returns

## 3. Double-Click or Concurrent Checkout Starts

### Runtime Behavior

- `orders.open` is rate-limited
- same-owner equivalent open orders are reused
- same-owner changed quantity/tier supersedes the previous open order atomically
- `orders.startCheckout` uses a Stripe idempotency key derived from `orderId`
- binding a Checkout Session to an order accepts the same session ID and rejects conflicting ones

### Expected Result

| Race                                   | Result                                                   |
| -------------------------------------- | -------------------------------------------------------- |
| two buyers want last ticket            | one order succeeds, one fails after OCC retry            |
| same buyer opens identical order twice | existing order reused                                    |
| same buyer changes quantity/tier       | old order released as `superseded`, new order created    |
| same order starts Checkout twice       | one Stripe session survives, both callers converge on it |

## 4. Late Success After Local Expiry

### Runtime Behavior

This happens when Stripe reports a successful payment after the local order was already released for `expired`.

### Policy

- fulfill if the order was released for `expired` and the business constraints are still valid
- otherwise auto-refund

### Prerequisite gate

Before any settlement logic runs, the webhook handler verifies `session.payment_status === 'paid'`. If payment is not confirmed, the handler logs a warning and exits without attempting fulfillment. This gate is enforced in `backend/convex/stripe/actions.ts` before calling `settlePaidOrderFromStripe`.

### Primary fulfill conditions

- event still exists
- event is not cancelled
- event date has not passed
- ticket sales are not paused
- `event_inventory` still has enough remaining capacity

### Resale fulfill conditions

- event is still sold out
- listing is still valid for this exact order
- seller ticket is still transferable

### Fallback

If those conditions fail:

- append `late_payment_after_release`
- trigger refund
- emit alerts / admin notification
- do not fulfill

## 5. Webhook Delay or Duplicate Delivery

### Runtime Behavior

- Stripe can redeliver the same webhook event
- `stripe_webhook_events` (claim-row FSM) records processed event IDs with
  `pending | completed | failed` status; duplicate deliveries short-circuit
  with a `skip` disposition before the handler runs
- order completion/release transitions remain idempotent as a defense in depth

### Expected Result

| Event pattern                            | Result                                     |
| ---------------------------------------- | ------------------------------------------ |
| duplicate `checkout.session.completed`   | first completes, later deliveries no-op    |
| duplicate `checkout.session.expired`     | first release wins, later deliveries no-op |
| sync endpoint completes before webhook   | later webhook no-ops                       |
| webhook arrives before landing-page sync | sync sees already-completed order          |

## 6. Refund and Dispute Edge Cases

### Refund source of truth

- entitlement state: `tickets.status`
- money ledger: `order_financial_events`

### Important rules

- primary refunds decrement `event_inventory.soldCount` only for tickets transitioning from `valid` or `used` to `refunded`
- resale refunds do not change primary sold/held counters
- disputes append financial events but do not change inventory unless ticket entitlement is explicitly revoked

### Operational risk

The main risk is drift between ticket entitlement state and recorded money events if an operator partially repairs one without the other.

### Mitigation

- follow the runbook in `docs/runbooks/payments.md`
- never mutate ticketing rows manually without also recording the corresponding financial event

## Regression Coverage Targets

1. E2E test: complete embedded Checkout end-to-end without leaving the site
2. E2E test: let an order expire, then verify same-owner retry opens a fresh order
3. Integration test: duplicate and out-of-order Stripe webhook delivery
4. Integration test: late-success fulfill vs refund branching
5. Load/concurrency test: two buyers racing for the last ticket
