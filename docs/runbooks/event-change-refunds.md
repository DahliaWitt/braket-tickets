---
title: Event Change Refunds
category: Runbooks
order: 13
description: Planned operations runbook — cancellation, postponement, reschedule, moved-event, and refund-request handling
access: public
---

# Event Change Refunds

This runbook is for the Braket operator handling event cancellations, postponements, reschedules, venue moves, materially replaced events, and buyer refund requests. It assumes access to the admin UI, Convex Dashboard, Stripe Dashboard, and the private support inbox.

This is an operations checklist, not legal advice. Use it to make the public refund policy operational while the product does not yet have a dedicated event-change/refund-request workflow.

Source of truth:

- [`terms-of-service.html`](../../frontend/src/app/features/legal/pages/terms-of-service/terms-of-service.html)
- [`payments.md`](./payments.md)
- [`stripe-connect-ops.md`](./stripe-connect-ops.md)
- [`event-status.ts`](../../shared/domain/event-status.ts)
- [`payments/refunds.ts`](../../backend/convex/payments/refunds.ts)
- [California Business and Professions Code Section 22507](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=22507.)

Current product limitation: Braket currently models event lifecycle status as `draft`, `published`, or `cancelled`. Postponed, rescheduled, moved, and replacement events are represented by edits to event fields plus operator records, not by first-class event-change rows or refund-request rows. Until that product gap is closed, the private support record is the SLA tracker.

## Policy Clock

Use these clocks for events sold through Braket:

| Situation                                                   | Required operator deadline                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Event cancelled                                             | Process full buyer refunds within 30 calendar days of cancellation.             |
| Event postponed, rescheduled, moved, or materially replaced | Process full buyer refunds within 30 calendar days of a verified buyer request. |

"Full buyer refund" means the buyer-facing ticket price paid through Braket, including mandatory Braket service fees. Stripe or a buyer's bank may take additional time to make the refund visible after Braket processes it.

## Intake A Change

Create a private support record before changing or refunding anything. Do not put attendee names, emails, refund details, or private event details in public issues.

Record these fields:

| Field               | Value                                                                     |
| ------------------- | ------------------------------------------------------------------------- |
| Case ID             | `REFUND-YYYYMMDD-N`                                                       |
| Event ID            | Convex `events._id`                                                       |
| Event title         | Current title at intake                                                   |
| Organizer           | Organizer/community and admin contact                                     |
| Change type         | cancellation, postponement, reschedule, venue move, replacement, or mixed |
| Change decided at   | Timestamp when Braket or the organizer decided/confirmed the change       |
| Refund clock starts | Cancellation timestamp, or verified request timestamp                     |
| Refund due by       | 30 calendar days after the clock starts                                   |
| Buyer scope         | all paid buyers, affected tier, specific order, or unknown                |
| Owner               | Operator handling the case                                                |
| Final status        | open, refunded, not eligible, escalated, or closed                        |

## Classify The Event Change

Use the narrowest classification that matches reality:

| Classification | Use when                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------- |
| Cancellation   | The event will not happen as sold.                                                        |
| Postponement   | The event will happen later, but the new time is not final.                               |
| Reschedule     | The event has a new date or time.                                                         |
| Venue move     | The event has a new venue or location that may materially affect attendance.              |
| Replacement    | Buyers are offered another event in place of the original event.                          |
| Minor update   | The change does not materially affect attendance, such as typo fixes or small copy edits. |

When unsure whether a change is material, treat it as refund-request eligible and escalate for human review. Do not rely on the absence of a first-class `rescheduled` status in the product.

## Cancellation Workflow

1. Confirm the organizer's cancellation decision in writing or from a trusted admin channel.
2. In the admin UI, set the event status to `cancelled`.
3. Confirm public listings and checkout no longer show the event as purchasable.
4. Send a broadcast to affected buyers that states the event was cancelled and refunds will be processed.
5. Export or list completed paid orders for the event from the event management purchases panel.
6. For each completed paid order, use **Force Refund All** unless a narrower refund is legally reviewed and documented.
7. Verify each order has `order_financial_events.kind = "payment_refunded"` and tickets are marked `refunded`.
8. Check Stripe Dashboard for failed or pending refunds.
9. Update the private support record with each order ID, Stripe refund ID if visible, processing timestamp, and any failure.

Open checkout orders are released by the event cancellation path; they should not be charged. If Stripe later reports a paid Checkout Session after release, follow [Handle a late success after expiry](./payments.md#handle-a-late-success-after-expiry).

## Postponed, Rescheduled, Moved, Or Replaced Event Workflow

Because these changes are currently product-field edits rather than distinct lifecycle states, the operator owns communication and request tracking.

1. Confirm the exact old and new event details: date, time, venue, title, and replacement event, if any.
2. Capture a before/after snapshot in the private support record.
3. Send a broadcast to affected buyers explaining the change and the refund request deadline/process.
4. Direct refund requests to `contact@braket.gay`.
5. For each request, verify the requester against the order email, account email, ticket, or Stripe receipt detail already held by Braket.
6. Record the verified request timestamp; this starts the 30-calendar-day refund clock for that buyer.
7. Use the event management purchases panel to refund the relevant order:
   - Use **Refund** for unused-ticket refunds when the policy and event state allow it.
   - Use **Force Refund All** when the buyer is entitled to the full buyer-facing paid amount, including used or otherwise non-standard ticket states.
   - Use **Refund Ticket** only when the buyer requests or is entitled to a single-ticket refund from a multi-ticket order.
8. Verify `order_financial_events.kind = "payment_refunded"` for the order and confirm ticket state.
9. Update the support record with order ID, refund type, refund timestamp, and any unresolved balance.

Do not tell a buyer that a refund is unavailable only because the event row still says `published`. For this workflow, the support record and event edit history are the event-change source of truth.

## Stripe Connect Notes

For Third-Party Events, refunds run through Stripe Connect against the original payment. Braket's refund actions pass the snapshotted connected-account context so Stripe can debit or offset the connected account and refund applicable platform fees through Stripe's refund flow.

Before closing a refund case:

1. Confirm Stripe accepted each refund.
2. Confirm `order_financial_events` has the refund ledger row.
3. Check whether the event has already paid out. If it has, review the connected account balance and refund impact in Stripe.
4. If Stripe reports insufficient balance, restricted account status, a dispute, or a failed refund, keep the case open and follow [Resolve a failed refund](./payments.md#resolve-a-failed-refund).

## What Not To Do

- Do not delete orders, tickets, financial events, Stripe webhook rows, payout rows, or audit logs to "undo" an event.
- Do not issue an off-platform refund without recording how the order, ticket, and ledger state will be reconciled.
- Do not promise a faster bank posting time than Stripe or the buyer's bank can control.
- Do not let organizer preference override Braket's published refund policy for purchases made through Braket.
- Do not close a case with only a broadcast sent; cancellation and verified event-change refund requests need refund processing evidence.

## Product Follow-Up

File product work when any of these happen:

- More than one event-change refund case is handled manually in a month.
- A cancellation involves more than 25 completed paid orders.
- A reschedule, postponement, move, or replacement requires more than 10 buyer refund requests.
- Operators cannot confidently reconstruct who requested a refund and when.

The product gap to close is a first-class event-change and refund-request workflow with: change type, buyer notification, request intake, verification status, due date, refund state, Stripe refund ID, and audit history.
