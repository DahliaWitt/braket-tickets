---
title: Stripe Connect Ops
category: Runbooks
order: 14
description: Incident response runbook — stripe connect ops
access: public
---

# Stripe Connect Ops

This runbook is for engineers or admins who manage organizer onboarding and payouts. It assumes access to Stripe Dashboard, Convex Dashboard, and the admin UI. Use it when an organizer cannot complete onboarding, cannot manage their account, or does not receive an expected payout. Use [Payment Incidents](./payments.md) for checkout, refund, dispute, or webhook delivery issues.

## Architecture — Stripe Connect V2

Braket runs Stripe Accounts V2 with direct charges and embedded components. There is no Express login link surface; the onboarding and account-management surfaces live inside the Braket UI via Stripe's embedded Connect components loaded through `@stripe/connect-js`. Some Accounts V2 configurations still require a Stripe-hosted onboarding redirect for initial KYC (minted via `stripe/actions.createAccountOnboardingLink`), but post-onboarding management remains embedded.

Responsibilities at account creation (locked at merchant configuration activation):

- `fees_collector: 'stripe'` — Stripe deducts its processing fee from the connected account directly.
- `losses_collector: 'stripe'` — Stripe is responsible for connected-account negative balances; Braket still owns negative balances on the platform account.

Source of truth:

- `backend/convex/stripe/_impl/accounts.ts` — V2 account creation, balance settings, status projection.
- `backend/convex/stripe/_impl/checkout.ts` — direct charge + platform charge session builders.
- `backend/convex/stripe/_impl/payouts.ts` — pure settlement ledger math (reserves + FIFO).
- `backend/convex/stripe/_impl/settlement.ts` — `recordPaymentCaptured` helper.
- `backend/convex/stripe/_impl/constants.ts` — `STRIPE_V2_ACCOUNT_CONFIG` SSOT.
- `backend/convex/stripe/actions.ts` — Connect onboarding, account session, refund/payout processors, webhook verification+dispatch.
- `backend/convex/stripe/connect.ts` — Connect thin event destinations (account.updated, etc).
- `backend/convex/stripe/webhooks.ts` — webhook claim-row mutations (`stripe_webhook_events`).
- `backend/convex/http.ts` + `backend/convex/http/_impl/stripe.ts` — webhook routes.
- `frontend/src/app/features/admin/components/stripe-connect/stripe-connect-embed.component.ts` — embedded Connect wrapper.
- `frontend/src/app/features/admin/pages/community-admin-settings/community-admin-settings.component.ts`
- `frontend/src/app/features/admin/pages/communities/community-editor/community-editor.component.ts`

Jump to:

- [Start organizer onboarding](#start-organizer-onboarding)
- [Resume or complete onboarding](#resume-or-complete-onboarding)
- [Promoter account management](#promoter-account-management)
- [Webhook topology + env vars](#webhook-topology--env-vars)
- [Check payout eligibility](#check-payout-eligibility)
- [Explain why a scheduled payout did not happen](#explain-why-a-scheduled-payout-did-not-happen)
- [Explain a low payout amount](#explain-a-low-payout-amount)
- [Explain a missing payout email](#explain-a-missing-payout-email)

## Start organizer onboarding

Backend actions (V2):

- `stripe/actions.createConnectedAccount` — creates a V2 account using `STRIPE_V2_ACCOUNT_CONFIG`, then verifies the manual payout schedule via `balanceSettings.update` + `balanceSettings.retrieve`.
- `stripe/actions.createAccountSession` — issues a short-lived Account Session the frontend hands to `@stripe/connect-js`.
- `stripe/actions.checkAccountStatus` — retrieves the V2 account, projects status through `mapV2AccountStatus`, and persists via `updateOrganizerFromStripeAccount`.

Frontend entry points:

- `/community-admin/settings`
- `/admin/communities/:id/edit`

Verified behavior:

- Only community admins for that organizer, or root admins, may start onboarding.
- `createConnectedAccount` is idempotent: if a stored `stripeConnectedAccountId` exists, it skips the V2 create call and only re-runs `ensureManualPayoutSettings` before returning.
- After account creation the organizer row sits in `stripeOnboardingStatus: 'payout_settings_pending'` until the manual payout schedule is verified; a crash between create and verify resumes from this state on the next attempt.

Check these first when onboarding fails:

1. Caller has community-admin or root-admin access for that organizer.
2. Organizer exists.
3. `STRIPE_SECRET_KEY` is set for the deployment (see `backend/convex/lib/stripe_node.ts`).
4. Action is not throwing `STRIPE_PAYOUT_SETTINGS_NOT_VERIFIED` — that's the create-succeeded, verify-failed case; retry after confirming the Stripe account is reachable.

## Resume or complete onboarding

Onboarding may complete inside the embedded Connect component, or (for Accounts V2 flows that require it) via a Stripe-hosted onboarding redirect created by `stripe/actions.createAccountOnboardingLink`, which returns the user to `/community-admin/settings?stripeOnboardingReturn=1`.

Frontend state:

- Not charge-ready (`stripeChargesEnabled !== true` or `stripeOnboardingStatus` not in `complete|restricted`) → page mounts the embedded `account-onboarding` component.
- Charge-ready → page mounts `account-management` + `payments` + `balances` + `notification-banner`.
- When the user exits any component, the page refreshes state via `checkAccountStatus`. The Accounts V2 thin event destination (below) may also refresh state asynchronously via `updateOrganizerFromStripeAccount`.

If the UI still says onboarding is incomplete after the user finishes inside the embedded component:

1. Rerun the status check from the UI (the page exposes an embedded refresh on the admin surfaces). Backend equivalent: call `stripe/actions.checkAccountStatus`.
2. Inspect the connected account in Stripe. For V2 accounts, check `configuration.merchant.capabilities.card_payments.status` and `requirements.entries[]`.
3. `mapV2AccountStatus` maps V2 shape onto our enum:
   - `not_started` — no merchant configuration.
   - `payout_settings_pending` — connected account exists but payout schedule is not verified as `manual`.
   - `complete` — manual payout schedule verified + `card_payments.status === 'active'` + no open requirements entries.
   - `restricted` — active capability but Stripe is waiting on user action (`awaiting_action_from === 'user'` entries exist).
   - `in_progress` — everything else (capability pending / restricted, or Stripe-side review).

## Promoter account management

The embedded `account-management` + `payments` components replace the V1 Express dashboard. Promoters self-serve:

- KYC / tax details.
- External bank account linkage (via `external_account_collection: true` on the balances component).
- Dispute management (via `dispute_management: true` on the payments component).
- Payout history display.

Instant payouts, standard payouts, and edit-payout-schedule are explicitly disabled on the balances component. The platform owns the payout cadence — promoters cannot trigger their own payouts.

There is no Express login link to open. If an operator asks for it, redirect them to the Braket admin page for that community.

## Webhook topology + env vars

Three Stripe delivery paths:

- `/stripe/webhook` — platform account webhook. Verified with `STRIPE_WEBHOOK_SECRET`. Receives events on platform-owned objects: `application_fee.*`, platform-owned order charges.
- `/stripe/connect-webhook` — v1 snapshot events for connected accounts. Verified with `STRIPE_WEBHOOK_SECRET_CONNECT`. Receives charges, refunds, disputes (including `charge.dispute.funds_withdrawn` / `.funds_reinstated`), payouts (`payout.paid` / `.failed`), balance, onboarding lifecycle. The payload's `event.account` threads through `dispatchStripeEvent` so handlers pass `{stripeAccount}` on any Stripe SDK call that targets connected-account objects.
- `/stripe/v2-events` — Accounts V2 thin Event Destination. Verified with `STRIPE_WEBHOOK_SECRET_V2_EVENTS`. Receives `v2.core.account.updated`, `.requirements.updated`, and merchant capability transitions. Parsed with `stripe.parseEventNotification`; the related V2 Account is fetched via `eventNotification.fetchRelatedObject()`.

Dashboard registration required for each environment (test, staging, production):

1. **Connect webhook** (Dashboard → Developers → Webhooks, Listen to events on Connected accounts):
   - Events: `checkout.session.completed`, `checkout.session.expired`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`, `payout.paid`, `payout.failed`, `balance.available`, `person.updated`, `capability.updated`, `account.external_account.updated`, `application_fee.created`.
   - Signing secret → `STRIPE_WEBHOOK_SECRET_CONNECT` in Doppler.
2. **V2 Event Destination** (Dashboard → Developers → Event Destinations):
   - Events: `v2.core.account.updated`, `v2.core.account[requirements].updated`, `v2.core.account[future_requirements].updated`, `v2.core.account[configuration.merchant].updated`, `v2.core.account[configuration.merchant].capability_status_updated`.
   - Signing secret → `STRIPE_WEBHOOK_SECRET_V2_EVENTS` in Doppler.

Removed env vars (delete from Doppler once V2 rollout completes):

- `STRIPE_WEBHOOK_SECRET_ACCOUNT` — the V1 dual-secret fallback is gone.

## Check payout eligibility

The daily cron `process scheduled Stripe payouts` runs `stripe/actions.processScheduledPayouts`. Per run it:

1. Retires platform-organizer eligible events locally via `stripe/connect.markEventPaidOut` (no Connect round trip).
2. Lists Connect accounts with past-date, payouts-enabled events via `stripe/connect.listConnectedAccountsWithEligibleEvents`.
3. Per account, calls `stripe/connect.getSettlementDataForAccount` to load events + `order_financial_events` + confirmed allocations, then projects through `computeEventSettlements` + `buildPayoutPlan` to produce one account-scoped payout.
4. Calls `stripe/connect.createPayoutIntent` — an atomic mutation that returns an existing non-terminal batch or inserts a new `payout_batches` row plus `payout_allocations` children.
5. Submits to Stripe with the batch's idempotency key and flips the batch to `submitted`.

An event is in the eligible set only when all of these are true:

- `status = 'published'`
- The event date is older than the payout delay window.
- Its organizer has a Connect account and is payout-ready: `stripeOnboardingStatus === 'complete'` and `stripePayoutsEnabled === true` (or is a platform organizer, in which case the event retires via path 1).

### Read the payout status in the UI

`event-management.ts` currently renders four payout states:

- `pre-event`: event date has not happened yet.
- `pending`: event happened, but the settlement window has not elapsed.
- `processing`: event is past the settlement window and the event does not yet have a paid-out marker.
- `paid`: `paidOutAt` exists. For Connect events, `confirmPayout` sets this marker only after confirmed allocation rows cover the event's current settlement; partial payouts leave it unset so later cron runs can continue paying the remaining balance.

Connect payout eligibility is derived from `payout_allocations`, not from `events.paidOutAt`. `processing` covers "waiting for next cron", "batch submitted, waiting for `payout.paid` webhook", and "partially paid with remaining payable balance".

## Explain why a scheduled payout did not happen

Verified cases where `processScheduledPayouts` does not produce a Stripe payout:

- No Connect accounts have eligible events — `listConnectedAccountsWithEligibleEvents` returned empty.
- The account's `computeEventSettlements` produced a plan with `payableCents <= 0`. Common reasons:
  - Future-event settlements reserved the full available balance.
  - The connected account balance is lower than reserved + eligible.
  - Refunds / disputes fully offset captured revenue.
- An existing non-terminal `payout_batches` row already exists for the account — `createPayoutIntent` returns that batch unchanged. The original submission either succeeded and is awaiting `payout.paid`, or it crashed before Stripe accepted it. The next cron run reuses the same batch.
- The organizer has `stripePayoutsEnabled !== true` — they're excluded from `listConnectedAccountsWithEligibleEvents`.
- The organizer is not payout-ready (`stripeOnboardingStatus !== 'complete'`) — also excluded from `listConnectedAccountsWithEligibleEvents`.

If a batch is stuck in `submitted` forever:

1. Check Stripe for `payout.paid` / `payout.failed` events matching the `stripePayoutId` on the batch.
2. Confirm the Connect webhook endpoint is registered and its secret (`STRIPE_WEBHOOK_SECRET_CONNECT`) matches the signing key in Stripe.
3. If Stripe fired the event but our `stripe_webhook_events` table has no matching row, the webhook payload was lost in transit — re-send it from Stripe Dashboard.

If a batch moved to `failed`, the underlying events stay eligible — the next cron run picks them up. Check the batch's `failureReason` for context.

Platform organizers never go through this path. `listPlatformOrganizerEligibleEventIds` marks their events paid-out locally.

## Explain a low payout amount

`buildPayoutPlan` produces `payableCents = min(eligibleNetCents, max(0, availableBalanceCents − reservedCents))`. A payout can be smaller than the event's captured revenue when:

- Future-event settlements reserved part of the balance. Check `payout_batches.amountCents` vs the event's `payment_captured` rows — if there are past-date settlements still showing positive `payableCents` for events the user didn't expect to see, they're being reserved because their event date is in the future.
- Refund / dispute net debits reduced the account's Stripe balance after capture.
- Another cron run already paid out part of the captured revenue on a prior day.

All numbers are sourced from `order_financial_events.connectedAccountNetCents`, populated from Stripe's expanded BalanceTransaction data on captures and refunds. There is no estimation — if the numbers look wrong, the underlying BalanceTransaction is the source of truth. Capture or refund webhook deliveries that cannot read that BalanceTransaction should remain retryable instead of completing with a payout-skipped ledger row.

## Explain a missing payout email

`stripe.confirmPayout` confirms `payout_allocations` and may stamp `paidOutAt` only when the event has no remaining Connect payable balance. Platform-organizer events use `stripe.markEventPaidOut` directly. The payout email fires from inside `markEventPaidOut` when `payoutAmountCents > 0`, guarded by `guardEmailDedup` to avoid duplicates on retries.

No email is sent when:

- The event was a platform organizer event retired via `markEventPaidOut` without a payout amount.
- Revenue was zero before the settlement window (rare but possible — `buildPayoutPlan` excludes events with `payableCents <= 0`).
- The organizer row has no `email`.

If the event was paid out with a positive amount and no email arrived, switch to [Email Delivery](./email-delivery.md).
