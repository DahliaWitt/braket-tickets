---
title: Refunds
category: Events
categoryOrder: 3
order: 1
description: How to issue refunds for ticket purchases
access: public
---

# Refunds

Sometimes you need to give someone their money back. Refunds are admin-initiated from the [event management page](./managing-events.md) — buyers can't self-service refund through Braket.

## How to issue a refund

1. Open the event from your Community Admin dashboard → **Events** tab
2. Click into the event's management page
3. Go to the **Buyers** tab
4. Find the ticket you want to refund
5. Click the refund option

You can refund individual tickets or all tickets in an order. The refund goes back to the buyer's original payment method through Stripe.

## What happens when you refund

- The ticket is deactivated. It can't be used at the door anymore.
- The buyer gets their money back on their card. Timing depends on their bank, but usually a few business days.
- The refund shows up in your event's payment records.
- If the event hasn't been paid out yet, the refund reduces the payout amount. If it has, the refund comes out of your Stripe balance.

## Processing fees

Stripe keeps its processing fee from the original charge when you issue a refund. The buyer gets the full ticket price back, but the fee Stripe already took is gone. Nothing we can do about that one — it's Stripe's policy.

## Refunds and the payout hold

Braket holds payouts for 3 days after an event (see [Payout schedule](./payout-schedule.md)). One reason for this hold is to cover refunds and chargebacks that come in shortly after the event.

If you issue a refund during the hold period, the math just adjusts — less money goes out when the payout runs. If you refund after the payout has already been sent, Stripe deducts the amount from your connected account balance.

## When to refund

Up to you. Common reasons:

- Event was cancelled
- Buyer can't attend and asks nicely
- Something went wrong at the event

Braket doesn't have a platform-wide refund policy. Each community decides how to handle refund requests.
