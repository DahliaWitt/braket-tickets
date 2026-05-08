---
title: Stripe Sandbox Setup
category: Development
order: 3
description: How to set up real Stripe Connect test accounts for local development and manual payment testing
access: public
---

# Stripe Sandbox Setup

How seed data connects to real Stripe test accounts so you can manually test the full payment flow, embedded Connect components, and payouts without fake account IDs.

## Prerequisites

- **Doppler** configured for the `braket-tickets` / `local` config (provides `STRIPE_SECRET_KEY`)
- `STRIPE_SECRET_KEY` must be a test key (`sk_test_...`) — the script refuses to run with a live key

If you don't have Stripe configured, seeding still works. Connected-account checkout stays disabled for Anfangszeit and Sister City instead of using fake account IDs.

## First-Time Setup

The first time you run `pnpm seed --fresh` with a Stripe test key, the script:

1. Creates two V2 connected accounts via the Stripe API
2. Tags them with `metadata.braket_seed`
3. Configures manual payouts
4. Prints the new account IDs and tells you to complete onboarding from the app

```
======================================================================
  New V2 Stripe accounts created.
  V2 accounts use embedded Connect components for post-onboarding account
  management. Some first-time KYC steps still open a Stripe-hosted
  onboarding redirect from the Stripe settings page.
======================================================================

    lot45: acct_1abc...
    sister-city: acct_2def...
======================================================================
```

**What to do:**

1. Log in as the community admin for Anfangszeit or Sister City
2. Open that community's Stripe settings
3. Complete the initial Stripe onboarding/KYC step from the settings page
4. Re-run `pnpm seed --fresh` to sync the live readiness fields

This is a **one-time step**. You only need to do it once per Stripe test account.

## Subsequent Runs

After the initial onboarding, every `pnpm seed --fresh` run:

1. Searches your Stripe test account for existing accounts tagged with `metadata.braket_seed`
2. Finds the previously onboarded accounts and reuses them — no new accounts created
3. Reads Stripe's current onboarding and charge capability state
4. Stores the real `acct_...` IDs plus the live readiness fields on the seed organizers

```
Setting up Stripe sandbox accounts...
  Reusing existing Stripe account for lot45: acct_1abc...
  Reusing existing Stripe account for sister-city: acct_2def...
```

Zero manual steps. Zero account accumulation.

## Seed Organizers

| Organizer               | Stripe Status                                                  | Use Case                                                                 |
| ----------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Anfangszeit**         | Connected only when the real sandbox account is checkout-ready | Test payments, embedded Connect management, payouts                      |
| **Sister City**         | Connected only when the real sandbox account is checkout-ready | Test multi-organizer payment routing                                     |
| **Midnight Sound**      | Platform payment setup                                         | Test public paid checkout on Rooftop Listening without a Connect account |
| **Deep End Collective** | Not connected                                                  | Test the "connect Stripe" onboarding flow                                |

## What You Can Test

With the connected accounts, you can:

- **Create paid events** for Anfangszeit or Sister City using Stripe
- **Purchase Rooftop Listening tickets** through the platform-backed seed checkout
- **Purchase tickets** using Stripe test cards (`4242 4242 4242 4242`)
- **View embedded Connect management** via the community Stripe settings page
- **Trigger payouts** via the daily payout cron
- **Test the onboarding flow** by going to Deep End Collective's admin settings and clicking "Connect with Stripe"

## How It Works

The seed script tags each account with `metadata.braket_seed` set to the organizer role (`lot45` or `sister-city`). On subsequent runs, it searches for accounts with this metadata and reuses them.

If an account exists but is not checkout-ready, the script keeps the account ID but records Stripe's live readiness fields. The app will show payment setup as incomplete for that organizer until onboarding is finished.

### Stripe Test Values

Use Stripe's current test-mode prompts and test data when completing the initial onboarding/KYC step. The seed script no longer pre-fills KYC fields.

## Troubleshooting

### "No STRIPE_SECRET_KEY found"

Doppler isn't injecting the key. Verify:

```bash
doppler secrets get STRIPE_SECRET_KEY --project braket-tickets --config local
```

### Accounts keep requiring onboarding

The `details_submitted` flag is only set after Stripe's required onboarding/KYC step completes. If you skip this step, the script will delete the incomplete account and create a new one each run. Complete the one-time onboarding to fix this.

### "ERROR: STRIPE_SECRET_KEY is a live key"

You have a production Stripe key (`sk_live_...`) in your environment. The seed script only works with test keys. Check your Doppler config.

### Multiple developers sharing the same Stripe test account

This works correctly. All developers find and reuse the same two tagged accounts. No conflicts, no duplication.

### Accounts accumulating in the Stripe Dashboard

This shouldn't happen with the reuse logic. If it does, you can clean up stale test accounts from the [Stripe Dashboard](https://dashboard.stripe.com/test/connect/accounts/overview) under Connect > Connected accounts.
