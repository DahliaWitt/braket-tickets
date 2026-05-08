---
title: Set Up Stripe
category: Payments
categoryOrder: 3
order: 0
description: Connect Stripe so your community can sell paid tickets and receive payouts
access: public
---

# Set up Stripe

This guide is for community admins setting up paid ticket sales in Braket Tickets. It covers connecting Stripe, finishing Stripe's setup flow, reading the payment status, and fixing a stuck setup.

Most communities need Stripe before they can sell paid tickets. Stripe handles card payments, identity checks, tax details, and payout bank information. Braket Tickets never sees or stores card numbers, tax IDs, or bank-account credentials.

If your Payments section says payouts are handled by Braket Tickets, you do not need to connect Stripe for that community.

## Before you start

Sign in with the Braket Tickets admin account that should manage Stripe for your community. Stripe may ask this person to verify their identity, set up Stripe authentication, or return later if more information is needed.

Have these ready:

- your legal name or business name
- tax details Stripe asks for
- payout bank-account details
- access to the email address and phone number you want Stripe to use
- any identity or business documents Stripe requests

Use your real information. Stripe uses those details for payment compliance, fraud prevention, tax reporting, and payouts.

## Connect Stripe

1. Open your Community Admin dashboard.
2. Go to **Settings**.
3. Find **Payments**.
4. Click **Connect with Stripe**.
5. Wait for Braket Tickets to create your community's connected Stripe account.
6. Click **Continue Setup on Stripe** if the page shows **Onboarding In Progress**.
7. Complete the steps on Stripe.
8. Return to Braket Tickets when Stripe sends you back.
9. Confirm the Payments section shows **Stripe Connected**.

Always start Stripe setup from Braket Tickets. Stripe setup links expire and can only be used once. Do not email or text the setup URL to someone else.

## What the status means

After you connect Stripe, the Payments section can show three checks:

| Status     | What it means                                                    |
| ---------- | ---------------------------------------------------------------- |
| Charges    | Stripe has enabled card payments for your community.             |
| Payouts    | Stripe currently allows payouts for your connected account.      |
| User Steps | Stripe is not waiting on you for required information right now. |

You can sell paid tickets once card payments are enabled and Stripe setup is ready. Payouts are stricter. If Stripe still needs payout or compliance details, ticket sales may work before your event payout can be sent.

## After you are connected

Your Payments section becomes your Stripe home inside Braket Tickets. Use that section to:

- update business, tax, and account details
- review payments
- respond to disputes or Stripe notices
- view balance and payout information
- update payout bank details

Braket controls payout timing. You can update where the money goes, but you cannot trigger instant payouts or change the payout schedule from Stripe.

## Payout timing

Braket sends payouts after the event settlement window. The short version: Braket waits 3 days after the event, then includes the event in the next daily payout run. Banks usually take another 1 to 2 business days after that.

For more detail, see [Payout Schedule](./payout-schedule.md).

## If setup gets stuck

Try this first:

1. Go back to Community Admin → **Settings**.
2. Open **Payments**.
3. Click **Continue Setup on Stripe**.
4. Finish every field or document request Stripe shows.
5. Return to Braket Tickets and wait for the status to refresh.

If **Charges** stays incomplete, your community cannot sell paid tickets yet.

If **Payouts** or **User Steps** stays incomplete after ticket sales are enabled, Stripe likely needs another step. Finish any payout or compliance requests before your money can be sent.

Do not create a second Stripe account for the same community unless support asks you to. Braket Tickets resumes setup for the Stripe account already connected to your community.
