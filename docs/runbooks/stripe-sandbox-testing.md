---
title: Stripe Sandbox Testing
category: Runbooks
order: 15
description: Incident response runbook — stripe sandbox testing
access: public
---

# Stripe Sandbox Testing

This runbook is for engineers who maintain the automated Stripe sandbox lane. It assumes access to Doppler, the shared sandbox connected account, and GitHub Actions. Use it when you need to reseed the fixture, rerun the contract lane, or recover the sandbox account after rotation.

Source of truth:

- `.github/workflows/stripe-sandbox-verify.yml`
- `package.json`
- `backend/scripts/seed.ts`

Jump to:

- [Check the environment contract](#check-the-environment-contract)
- [Reseed the fixture](#reseed-the-fixture)
- [Recover after account rotation](#recover-after-account-rotation)
- [Run the contract lane](#run-the-contract-lane)
- [Check scheduled verification](#check-scheduled-verification)
- [Fix common failures](#fix-common-failures)

## Check the environment contract

- `local`: use a **dedicated Stripe sandbox connected account** for local checkout fixture setup.
- `stg`: use the **shared CI sandbox connected account** (`STRIPE_SANDBOX_CONNECTED_ACCOUNT_ID`) for contract tests and reseeding.
- `prd`: do **not** use sandbox variables in production; PRD is not required for the sandbox lane because CI is pinned to `development` for this job.

Store these in Doppler for the listed configs:

- `STRIPE_PUBLISHABLE_KEY`
- `STRIPE_SECRET_KEY` (test-mode key for `local` and `stg`)
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_WEBHOOK_SECRET_CONNECT`
- `STRIPE_WEBHOOK_SECRET_V2_EVENTS`
- `STRIPE_SANDBOX_CONNECTED_ACCOUNT_ID` (`stg` required; set to a dedicated local account in `local`)
- `CONVEX_URL` (for reseed commands run outside local wrappers)

## Reseed the fixture

Use reseed only in `local` or `stg` where `STRIPE_SECRET_KEY` is test mode.

```bash
# Local (dedicated local fixture account)
pnpm seed:fixture

# Staging/development (shared fixture account for CI)
pnpm seed:sandbox:fixture
```

The seeded test event is owned by the connected account resolved for each env (`STRIPE_SANDBOX_CONNECTED_ACCOUNT_ID`), so QA/dev events can always complete checkout without weakening payment readiness logic.

## Recover after account rotation

- Keep one dedicated account for local dev for predictable UX while iterating.
- Keep one shared staging sandbox account for CI stability and team consistency.
- If either account rotates or is recreated, update `STRIPE_SANDBOX_CONNECTED_ACCOUNT_ID` and rerun the reseed command in that environment immediately.
- If reseed succeeds but events still fail checkout gating, verify organizer ownership and onboarding status in Stripe before escalating.

## Run the contract lane

```bash
pnpm test:convex:sandbox
```

This lane validates:

- Checkout Session creation for embedded checkout flows
- order-backed completion/release behavior in Stripe sandbox
- Connect account status handling via `checkAccountStatus`
- webhook signature verification + onboarding status sync updates

## Check scheduled verification

- GitHub workflow: `.github/workflows/stripe-sandbox-verify.yml`
- Trigger modes:
  - Daily schedule
  - Manual `workflow_dispatch`
- Alerting: workflow failures surface in GitHub Actions and notify subscribed maintainers.

## Fix common failures

| Symptom                                                    | Likely Cause                                                       | Resolution                                                                                                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reseed fails with account/owner errors                     | Wrong or stale sandbox account ID                                  | Confirm `STRIPE_SANDBOX_CONNECTED_ACCOUNT_ID` for `local`/`stg`, update if rotated, then reseed                                                                          |
| Contract tests fail with missing env vars                  | Incomplete Doppler/CI secret sync                                  | Add missing variables and rerun                                                                                                                                          |
| Checkout unavailable in fixture flow                       | Fixture not owned by expected sandbox account or not onboarded     | Re-seed with the correct connected account and verify `stripeConnectedAccountId`, `stripeOnboardingStatus`, and `stripeChargesEnabled`                                   |
| Embedded Checkout shows "can't process payments right now" | Organizer readiness in Convex drifted from the real Stripe account | Run `pnpm seed:fixture` or refresh the organizer's Stripe status; checkout creation now rechecks Stripe and releases the hold instead of continuing with stale readiness |
