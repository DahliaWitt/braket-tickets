---
title: Local Recovery
category: Runbooks
order: 9
description: Incident response runbook — local recovery
access: public
---

# Local Environment Recovery

This runbook is for engineers who troubleshoot local development, local E2E, or local seeding. It assumes access to Doppler and the repo scripts in `package.json`. Use it when the local harness points at the wrong environment, local checks fail, or the E2E setup drifts.

Source of truth:

- `docs/environment.md`
- `package.json`
- `frontend/package.json`
- `scripts/dev.ts`
- `scripts/e2e-serve.ts`

Jump to:

- [Restore the local environment](#restore-the-local-environment)
- [Run a raw command with env vars](#run-a-raw-command-with-env-vars)
- [Fix the wrong environment mapping](#fix-the-wrong-environment-mapping)
- [Recover the local E2E harness](#recover-the-local-e2e-harness)
- [Capture a frontend screenshot](#capture-a-frontend-screenshot)
- [Fix local seeding](#fix-local-seeding)
- [Run the smallest failing local check](#run-the-smallest-failing-local-check)

## Golden Rules

- Do not create local `.env` files for this repo.
- Use Doppler `local` by default.
- Raw commands still need an explicit Doppler wrapper.
- `pnpm dev`, `pnpm test:frontend`, and the E2E scripts already inject the expected local environment.

## Restore the local environment

Run these in order and stop as soon as the issue is resolved:

```bash
doppler login
pnpm dev
pnpm dev:fresh
pnpm test:frontend
pnpm lint
pnpm typecheck
```

`pnpm dev:fresh` exists specifically for cases where the normal dev harness state has become suspect.

## Run a raw command with env vars

If a raw command such as `pnpm convex ...` fails because env vars are missing, use the explicit local wrapper:

```bash
doppler run -p braket-tickets -c local -- pnpm convex dev
```

For direct Convex local-deployment work, use Convex's selected local deployment:

```bash
pnpm convex:local:create   # one-time, requires convex login
pnpm convex:local:select
pnpm convex:local:once
```

If `pnpm convex:local:create` fails with "Cannot create a deployment in anonymous mode", run `pnpm convex login` first. Keep using `pnpm dev` / `pnpm dev:fresh` for app development because those commands also manage Doppler, local auth secrets, seed/reset behavior, and Angular runtime URL injection.

Do not wrap commands that already inject Doppler for you, such as `pnpm dev`, `pnpm test:frontend`, `pnpm test:e2e:serve`, or `pnpm validate`.

## Fix the wrong environment mapping

This repo maps environments this way:

- `local`: local development
- `stg`: staging config, GitHub `development` environment, Convex development deployment
- `prd`: production config, GitHub `production` environment, Convex production deployment

Common fixes:

- local work: stay on `local`
- staging/dev deployment sync: `DOPPLER_CONFIG=stg pnpm sync:env:dev`
- production deployment sync: `DOPPLER_CONFIG=prd pnpm sync:env:prod`

If a local command unexpectedly points at staging data, check whether `DOPPLER_CONFIG` is already set in the current shell before changing anything else.

## Recover the local E2E harness

The supported flow is split serve/run:

```bash
pnpm test:e2e:serve
pnpm test:e2e:run --grep "name"
```

Important repo behavior:

- `pnpm test:e2e:serve` starts a local frontend plus a local Convex backend
- the harness uses an ephemeral local backend port
- the active local backend URL is written to `.convex-local/.e2e-convex-url`

If E2E is pointing at the wrong backend, restart `pnpm test:e2e:serve` first instead of editing generated env files by hand.

## Capture a frontend screenshot

Use the screenshot harness when you need a deterministic local PNG for a route:

```bash
pnpm run screenshot:frontend -- / --auth none
pnpm run screenshot:frontend -- /account --auth user
pnpm run screenshot:frontend -- /admin --auth admin
```

Supported auth modes:

- `none`
- `user`
- `admin`

The harness starts the same local backend and frontend stack used for E2E, regenerates Playwright auth state for authenticated captures, and writes the screenshot under `frontend/__screenshots__/` unless `--out` is provided.

## Fix local seeding

Verified seed entrypoints:

```bash
pnpm seed
pnpm seed:fresh
pnpm seed:fixture
pnpm seed:dev
pnpm seed:dev:clear
pnpm seed:dev:fresh
pnpm seed:sandbox:fixture
```

For local E2E work, `pnpm seed:fresh` auto-detects the backend from `.convex-local/.e2e-convex-url`. If it appears to seed the wrong place:

1. restart `pnpm test:e2e:serve`
2. confirm the new harness is ready
3. rerun `pnpm seed:fresh`

Do not manually set `CONVEX_URL` in Doppler just to make local E2E seeding work.

## Run the smallest failing local check

Use the smallest failing check:

```bash
pnpm test:frontend
pnpm test:convex
pnpm lint
pnpm typecheck
```

If the issue only appears in the frontend build path, reproduce with the exact frontend script:

```bash
cd frontend
pnpm build
```

## Escalate to the matching runbook

Escalate out of local recovery and into the matching operational runbook when the problem is no longer local:

- GitHub Actions or deploy issue: [Deployment & CI](./deployment-ci.md)
- auth/login issue that reproduces outside your machine: [Auth Incidents](./auth-incidents.md)
- payment or payout issue: [Payment Incidents](./payments.md) or [Stripe Connect Ops](./stripe-connect-ops.md)
- Convex deployment or data issue: [Convex Backend](./convex-backend.md)
