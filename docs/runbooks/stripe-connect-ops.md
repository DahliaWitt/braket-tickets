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
- `backend/convex/stripe/_impl/payouts.ts` — pure settlement ledger math (reserves + FIFO + trust gate).
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
- [Payout trust gate](#payout-trust-gate)
- [Explain why a scheduled payout did not happen](#explain-why-a-scheduled-payout-did-not-happen)
- [Explain a low payout amount](#explain-a-low-payout-amount)
- [Manual payouts from the Stripe dashboard](#manual-payouts-from-the-stripe-dashboard)
- [Stuck-batch recovery](#stuck-batch-recovery)
- [Repair tooling](#repair-tooling)
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
2. Runs [stuck-batch recovery](#stuck-batch-recovery) against Stripe.
3. Lists payout-ready Connect accounts via `stripe/connect.listPayoutReadyConnectedAccounts`, cursor-paging through EVERY organizer with no result cap (event status and dates play no role in discovery, and no account can be starved by a fixed batch size).
4. Per account, calls `stripe/connect.getSettlementDataForAccount` to load `order_financial_events` + confirmed allocations + in-flight submitted batches. The settlement event set is derived from the ledger rows themselves, so an event that was drafted, cancelled, or reassigned after capturing revenue still settles. Accounts with nothing payable exit before any Stripe call.
5. Checks the [payout trust gate](#payout-trust-gate) against the live Stripe balance, then projects through `computeEventSettlements` + `buildPayoutPlan` to produce one account-scoped payout.
6. Calls `stripe/connect.createPayoutIntent` — an atomic mutation that returns an existing non-terminal batch or inserts a new `payout_batches` row plus `payout_allocations` children. Every submitted plan is logged (`Submitting payout plan`); balance-capped partial payouts log a `Partial payout` warning.
7. Submits to Stripe with the batch's idempotency key and `metadata.braketBatchId`, then flips the batch to `submitted`.

An event settles for payout only when all of these are true:

- It has `order_financial_events` rows for the organizer's connected account (ledger-derived — event `status` does not matter).
- The event is **over** by more than the payout delay window (otherwise its positive net is reserved, not paid). "Over" means the payout reference instant — `events.endDate` when set, else the start `events.date` — is older than `now - PAYOUT_DELAY_MS`. A running multi-day event stays reserved until its `endDate` plus the delay, even though its start is already past. See `eventEndInstantMs` in [shared/event-time.ts](../../shared/event-time.ts).
- Its organizer has a Connect account and is payout-ready: `stripeOnboardingStatus === 'complete'` and `stripePayoutsEnabled === true` (or is a platform organizer, in which case the event retires via path 1).

### Read the payout status in the UI

`event-management.ts` currently renders four payout states:

- `pre-event`: event date has not happened yet.
- `pending`: event happened, but the settlement window has not elapsed.
- `processing`: event is past the settlement window and the event does not yet have a paid-out marker.
- `paid`: `paidOutAt` exists. For Connect events, `confirmPayout` sets this marker only after confirmed allocation rows cover the event's current settlement; partial payouts leave it unset so later cron runs can continue paying the remaining balance.

Connect payout eligibility is derived from `payout_allocations`, not from `events.paidOutAt`. `processing` covers "waiting for next cron", "batch submitted, waiting for `payout.paid` webhook", and "partially paid with remaining payable balance".

## Payout trust gate

Before submitting any payout, `processAccountPayout` reconciles the ledger against Stripe (`computeLedgerTrustGate` in `backend/convex/stripe/_impl/payouts.ts`):

```text
ledgerClaim  = signed sum of every settlement's payableCents
stripeTruth  = balance.available + balance.pending (USD)
delta        = ledgerClaim − (stripeTruth + submitted-batch in-flight cents)
```

If `|delta| > PAYOUT_TRUST_EPSILON_CENTS` (100¢), the account is **skipped for the run** and a `payout trust gate mismatch` error is logged with all the numbers. The gate is deliberately fail-closed: the balance cap means the system can never overpay cash, so holding a payout costs a delay, never money.

**One-off trips are normal.** Webhook timing races legitimately diverge for minutes-to-hours: a refund or dispute debits the balance before its webhook writes the ledger row, or a fresh capture credits `pending` before its `payment_captured` row lands. These self-heal by the next daily run.

**Persistent trips (2+ consecutive days for the same account) are incidents.** Read the logged numbers:

- `ledgerClaim < stripeTruth` (negative delta) — Stripe holds money the ledger doesn't know about. Usual causes: `payment_captured` rows missing `connectedAccountNetCents`, or an un-ingested inbound transfer/top-up. Run [`backfillPaymentCapturedNet`](#repair-tooling).
- `ledgerClaim > stripeTruth` (positive delta) — money left Stripe that the ledger didn't record. Usual causes: a manual payout that predates external ingestion (run [`ingestExternalPayoutById`](#repair-tooling)), a batch failed as `stale_pending_superseded` whose payout actually went through (same fix), or an out-of-band transfer/adjustment in the dashboard (inspect the account's balance transactions in Stripe and reconcile by hand).

## Explain why a scheduled payout did not happen

Verified cases where `processScheduledPayouts` does not produce a Stripe payout:

- The [trust gate](#payout-trust-gate) tripped — look for `payout trust gate mismatch` in the logs.
- The account's `computeEventSettlements` produced a plan with `payableCents <= 0`. Common reasons:
  - Future-event settlements reserved the full available balance.
  - The connected account balance is lower than reserved + eligible.
  - Refunds / disputes fully offset captured revenue.
- An existing non-terminal `payout_batches` row already exists for the account — `createPayoutIntent` returns that batch unchanged. Fresh batches (<24h) are retried under the same idempotency key; older stuck batches are handled by [stuck-batch recovery](#stuck-batch-recovery).
- The organizer has `stripePayoutsEnabled !== true` or `stripeOnboardingStatus !== 'complete'` — excluded from `listPayoutReadyConnectedAccounts`.

If a batch moved to `failed`, the underlying events stay eligible — the next cron run picks them up. Check the batch's `failureReason` for context.

Platform organizers never go through this path. `listPlatformOrganizerEligibleEventIds` marks their events paid-out locally.

## Explain a low payout amount

`buildPayoutPlan` produces `payableCents = min(eligibleNetCents, max(0, availableBalanceCents − reservedCents))`. A payout can be smaller than the event's captured revenue when:

- Future-event settlements reserved part of the balance. Check `payout_batches.amountCents` vs the event's `payment_captured` rows — if there are past-date settlements still showing positive `payableCents` for events the user didn't expect to see, they're being reserved because their event date is in the future.
- Refund / dispute net debits reduced the account's Stripe balance after capture.
- Another cron run already paid out part of the captured revenue on a prior day.

All numbers are sourced from `order_financial_events.connectedAccountNetCents`, populated from Stripe's expanded BalanceTransaction data on captures and refunds. There is no estimation — if the numbers look wrong, the underlying BalanceTransaction is the source of truth. Capture or refund webhook deliveries that cannot read that BalanceTransaction should remain retryable instead of completing with a payout-skipped ledger row. The [trust gate](#payout-trust-gate) blocks the payout entirely when the ledger and the Stripe balance disagree, so a payout that _did_ go out was computed from numbers that matched Stripe at submit time.

## Manual payouts from the Stripe dashboard

Prefer letting the cron pay. If you must pay an organizer by hand (dashboard → connected account → Balances → Pay out funds):

- The resulting `payout.paid` webhook is **auto-ingested**: `confirmPayout` records an already-`paid` `payout_batches` row with `origin: 'external'` and FIFO `payout_allocations` across the account's positive payables (oldest event first, eligibility ignored — the money already moved). Settlement and `paidOutAt` markers stay truthful.
- Verify afterward: the account has a batch with `idempotencyKey: external-<payoutId>` and `origin: 'external'`, and the affected events' allocations are `paid`.
- If the manual amount exceeded everything the ledger can attribute, the remainder is logged as `External payout exceeds ledger payable; remainder unattributed` — that usually means the ledger is missing capture nets; run [`backfillPaymentCapturedNet`](#repair-tooling) and reconcile.
- Manual payouts made **before external ingestion shipped** were ignored ("payout.paid received for unknown payout") and must be registered with [`ingestExternalPayoutById`](#repair-tooling).

Non-payout manual actions (transfers, top-ups, balance adjustments) are still invisible to the ledger and will trip the trust gate — reconcile them by hand against the account's balance transactions in Stripe.

## Stuck-batch recovery

The cron's pre-pass (`recoverStuckPayoutBatches` in `backend/convex/stripe/_impl/actions.ts`) reconciles wedged batches against Stripe every run:

- **`submitted` older than 48h** (lost `payout.paid`/`payout.failed` webhook): polls `payouts.retrieve` and confirms or fails the batch from the payout's actual status. `pending`/`in_transit` payouts are left for the next run.
- **`pending` older than 24h** (Stripe idempotency keys expire after 24h — replaying would create a NEW payout with the stale frozen amount): checks `payouts.list` for a payout carrying the batch's `metadata.braketBatchId` (the crash-after-create case) and stamps + confirms it; otherwise fails the batch as `stale_pending_superseded` so the next run recomputes a fresh, correctly-sized batch.

The `payout.paid`-before-`markPayoutBatchSubmitted` race is also healed inline: `confirmPayout` matches the payout's `braketBatchId` metadata and stamps the batch + allocations before confirming.

If a batch failed as `stale_pending_superseded` but its payout actually went through without our metadata (pre-metadata era), the trust gate will trip positive for the account — run [`ingestExternalPayoutById`](#repair-tooling) with that payout's id.

## Repair tooling

Internal actions, run from the Convex Dashboard (Functions → `stripe/actions`):

- `ingestExternalPayoutById({stripePayoutId, connectedAccountId})` — retrieves the payout from Stripe and runs external ingestion (see [manual payouts](#manual-payouts-from-the-stripe-dashboard)). Only `paid` payouts ingest; idempotent via the `external-<payoutId>` key.
- `backfillPaymentCapturedNet({connectedAccountId})` — finds `payment_captured` rows missing `connectedAccountNetCents` (the pre-capture-race-fix population), re-reads each charge's BalanceTransaction, and enriches the row in place. Idempotent; returns `{scanned, enriched, skipped, failed}`.

**Run order matters when both are needed on one account: ingest the external payout FIRST, then backfill.** Backfilling first inflates payable while the manual payout is still unrecorded; the trust gate blocks payouts either way, but doing it in order keeps allocations attributed to the right events. The order is machine-checked: `backfillPaymentCapturedNet` refuses with `EXTERNAL_PAYOUT_UNRECORDED` (listing the offending payout ids) while the account has paid payouts the ledger never recorded.
