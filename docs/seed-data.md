---
title: Seed Data
category: Development
categoryOrder: 2
order: 1
description: What the seed system creates, how to run it, and how to extend it
access: public
---

# Seed data

What the seed data system creates, how to run it, and how to extend it.

**Audience:** Developers working on braket-tickets locally or against the staging deployment. Assumes you know TypeScript and have a basic understanding of Convex (tables, mutations, queries).

**Scope:** Local and staging seed data only. Does not cover production data, E2E test fixtures (which use the same shared helpers but with different orchestration), or the Stripe sandbox onboarding flow in detail (see `docs/runbooks/stripe-sandbox-testing.md` for that).

## How it works

Two files do most of the work:

- `backend/scripts/seed.ts` -- the CLI entry point. Handles argument parsing, URL resolution, user creation, image uploads, Stripe account setup, and calls the seed facade.
- `backend/convex/seed/` -- the token-gated public seed facade used by scripts. It delegates to shared helpers under `backend/convex/testing/`.

The split exists because Convex mutations run server-side and can't do things like upload images over HTTP or call the Stripe API. `backend/scripts/seed.ts` handles the client-side work, then passes IDs into the seed facade for everything else.

Remote/local seed calls are gated by a short-lived token. The seed script temporarily sets `DEV_SEED=true`, `DEV_SEED_TOKEN`, and `DEV_SEED_EXPIRES_AT`, passes the token to `backend/convex/seed/`, then removes all three values when finished. `DEV_SEED` records deployment intent only; it does not authorize the public `api.testing.*` namespace.

Remote seed commands are limited to the known staging Convex deployment. If a future dev/staging deployment needs seed access, add it to the script and backend seed-authorization allowlists together.

Remote seed env setup and cleanup use the deployment-scoped `CONVEX_DEPLOY_KEY` from Doppler. Before changing any `DEV_SEED` env var, the script requires an exact HTTPS Convex cloud RPC URL and the current `dev:<deployment-name>|<token>` key form, verifies that the key's deployment matches the `CONVEX_URL` hostname, and verifies that deployment against the staging allowlist. Production, preview, project-scoped, legacy, malformed, missing, or mismatched keys and non-HTTPS or decorated remote URLs fail closed without printing the token. The script deliberately omits `--deployment` from those Convex CLI calls and from any manual cleanup commands it prints. Local cleanup continues to use an explicit local URL and admin key.

## Seed a local or dev deployment

All commands run from the repo root.

| Command                     | What it does                                                             |
| --------------------------- | ------------------------------------------------------------------------ |
| `pnpm seed`                 | Seed the local backend. Idempotent -- skips if seed data already exists. |
| `pnpm seed:fresh`           | Clear all data, then reseed the local backend.                           |
| `pnpm seed:dev`             | Seed the remote dev/staging deployment (uses `DOPPLER_CONFIG=stg`).      |
| `pnpm seed:dev:fresh`       | Clear + reseed the remote dev deployment.                                |
| `pnpm seed:dev:clear`       | Clear the remote dev deployment without reseeding.                       |
| `pnpm seed:fixture`         | Create a Stripe sandbox purchase fixture on the local backend.           |
| `pnpm seed:sandbox:fixture` | Sandbox purchase fixture, targeting the remote dev deployment.           |

`pnpm seed` and `pnpm seed:fresh` are the two you'll use most. The fixture commands are for Stripe payment testing specifically.

### Prerequisites

- Local Convex backend running (`pnpm dev` or `pnpm dev:fresh`)
- For Stripe account setup: `STRIPE_SECRET_KEY` set to a test key (`sk_test_...`) in Doppler
- For remote seed commands (`seed:dev`, `seed:dev:fresh`, `seed:dev:clear`, `seed:sandbox:fixture`): Doppler `stg` config accessible and `CONVEX_URL` resolvable

## Demo users

The seed creates 7 users. Passwords are randomly generated on each run and printed to the console. They are not stored anywhere -- run `pnpm seed:fresh` to get new ones.

| User           | Email               | Role                                    | What they demonstrate                                                                                                      |
| -------------- | ------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Dale Cooper    | cooper@example.com  | Root admin                              | Platform-wide admin access, audit log entries                                                                              |
| Kim Wexler     | kim@example.com     | Community admin (Anfangszeit)           | Event management, magic links, application review, resale cancellation                                                     |
| Nomi Marks     | nomi@example.com    | Community admin (Sister City) + scanner | Multi-role user, cross-community trust, approved Anfangszeit application                                                   |
| Barney Calhoun | barney@example.com  | Scanner (Anfangszeit)                   | Check-in operations, shared-trust purchase (Night Market via Anfangszeit), active resale listing                           |
| Charlie Kelly  | charlie@example.com | Vetted buyer                            | Multiple tickets across communities, supporter tier, NOTAFLOF tier, refunded ticket, pending checkout, revoked application |
| Tobias Funke   | tobias@example.com  | New user (unverified)                   | Free ticket (Backyard Sessions), pending application, rejected application, marketing opt-out                              |
| Cheryl Tunt    | cheryl@example.com  | Community admin (Deep End Collective)   | Draft community, expired ticket                                                                                            |

## Demo communities

| Community                          | Status    | Stripe                                                                               | Vetting questions                                   | Other details                                                         |
| ---------------------------------- | --------- | ------------------------------------------------------------------------------------ | --------------------------------------------------- | --------------------------------------------------------------------- |
| Anfangszeit                        | Published | Connected account only when Stripe sandbox setup succeeds and reports checkout-ready | text + select + long_text (3 questions)             | Code of conduct, public directory, logo, trust target for Sister City |
| Sister City                        | Published | Optional connected account; checkout-ready only when Stripe sandbox setup reports it | text + long_text + boolean + checkbox (4 questions) | Trusts Anfangszeit (enables shared-trust purchases), logo             |
| Midnight Sound (no stripe connect) | Published | Platform payment setup                                                               | text + long_text + boolean (3 questions)            | Public paid Rooftop Listening checkout, logo, resale-enabled event    |
| Deep End Collective                | Draft     | None                                                                                 | None                                                | Not yet launched; use for Stripe onboarding setup checks              |

## Shared internal functions

The helper modules under `backend/convex/testing/` define the plain `async` functions (not registered Convex functions) that are the single source of truth for creating seed entities. The token-gated seed facade, `seedDemoData`, and the exported E2E helpers (`seedEvent`, `seedTicket`, etc.) call into them.

These functions enforce validation that matches production behavior. A few examples:

- `insertSeedEvent` rejects published events under non-published organizers
- `insertSeedResaleListing` rejects listings for non-valid tickets or events with resale disabled
- `insertSeedOrder` resolves trust source based on event visibility and vetting config
- `insertSeedTicket` updates inventory counts and roster projections

All 11 functions:

| Function                        | Table(s) written                                         |
| ------------------------------- | -------------------------------------------------------- |
| `insertSeedOrganizer`           | `organizers`                                             |
| `insertSeedEvent`               | `events`, `event_inventory`                              |
| `insertSeedOrder`               | `ticket_orders`, `order_financial_events`                |
| `insertSeedTicket`              | `tickets`, updates `events` and `event_inventory` counts |
| `insertSeedApplication`         | `applications`, syncs derived membership state           |
| `insertSeedGuest`               | `guests`                                                 |
| `insertSeedGuestSession`        | `guest_sessions`                                         |
| `insertSeedMagicLink`           | `magic_links`                                            |
| `insertSeedMagicLinkRedemption` | `magic_link_redemption_log`, syncs derived state         |
| `insertSeedResaleListing`       | `resale_listings`                                        |
| `insertSeedAuditLog`            | `adminAuditLogs`                                         |

The exported `api.testing.*` helpers (e.g., `seedEvent`, `seedTicket`) are for tests and local E2E only. If you need to change how an entity is created, change the shared function -- not the wrapper. If remote seed scripts need a new operation, add it to the curated `backend/convex/seed/` facade instead of authorizing broader `api.testing.*` access.

## Add new seed data

1. Check if a shared `insertSeed*` function already exists for the table you need. If not, add one following the pattern: define an interface for the args, write a plain `async function` that takes `db` (or `ctx`) and the args, insert the document, and handle any side effects (inventory updates, derived state, etc.).

2. Call your new function from `seedDemoData` with realistic demo values that show the feature in a meaningful state.

3. If E2E tests need to create this entity, add an exported `testingMutation` wrapper that accepts validator args and delegates to the shared function. If remote seed scripts need it, also expose only the narrow operation through `backend/convex/seed/`.

4. Run `pnpm typecheck:convex && pnpm test:convex` to verify.

## Update seed data after schema changes

| Change type                          | What to do                                                                                                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| New required field on existing table | Update the corresponding `insertSeed*` function's interface and `db.insert()` call. Pick a sensible default. Update `seedDemoData` calls if the default isn't appropriate for all demo entities. |
| New optional field                   | Add it as an optional property on the `insertSeed*` interface. No default needed.                                                                                                                |
| New enum value                       | Update the `insertSeed*` arg types to accept the new value. Existing seed data is unaffected.                                                                                                    |
| New table                            | Add a new `insertSeed*` function, call it from `seedDemoData`, and add an exported wrapper if E2E tests need it.                                                                                 |
| Removed field or table               | Remove from `insertSeed*` functions and `seedDemoData`. Run `pnpm typecheck:convex` to catch remaining references.                                                                               |

After any seed change, run:

```bash
pnpm typecheck:convex && pnpm test:convex
```

Then verify the seed works end to end:

```bash
pnpm seed:fresh
```

## State coverage

Gaps are intentional. The "not covered" table explains why.

### Covered

| State                                     | Where                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| Published event with active sales         | Concrete & Wax (Anfangszeit)                                                   |
| Published event with ended sales + payout | Low Frequency (Anfangszeit)                                                    |
| Published event with paused sales         | Untitled March Show (Anfangszeit)                                              |
| Free public event                         | Backyard Sessions (Sister City)                                                |
| Cancelled event                           | Spring Fundraiser (Sister City)                                                |
| Draft event                               | TBD (Midnight Sound)                                                           |
| Valid ticket                              | Charlie on Concrete & Wax                                                      |
| Used/checked-in ticket                    | Charlie, Cooper, Nomi, Kim on Low Frequency                                    |
| Refunded ticket                           | Charlie on Spring Fundraiser                                                   |
| Expired ticket                            | Cheryl on Rooftop Listening                                                    |
| NOTAFLOF tier ticket                      | Charlie on Concrete & Wax                                                      |
| Supporter tier ticket                     | Charlie on Night Market                                                        |
| Open order (mid-checkout)                 | Charlie on Concrete & Wax                                                      |
| Completed paid order                      | Multiple users across events                                                   |
| Refunded order                            | Charlie on Spring Fundraiser                                                   |
| Shared-trust purchase                     | Barney on Night Market (via Anfangszeit trust)                                 |
| Guest checkout (no account)               | guest1@example.com on Backyard Sessions                                        |
| Active resale listing                     | Barney on Low Frequency                                                        |
| Cancelled resale listing                  | Kim on Rooftop Listening                                                       |
| Approved application                      | Charlie (Sister City), Nomi (Anfangszeit)                                      |
| Pending application                       | Tobias (Sister City)                                                           |
| Rejected application                      | Tobias (Anfangszeit)                                                           |
| Revoked application                       | Charlie (Midnight Sound)                                                       |
| Active magic link                         | "Friends of Anfangszeit"                                                       |
| Paused magic link                         | "Spring Invite" (Sister City)                                                  |
| Disabled/expired magic link               | "Old Link" (Anfangszeit)                                                       |
| Magic link redemptions                    | Logged user (Charlie) + guest sessions                                         |
| Guest list entries                        | guest, artist guest, staff types                                               |
| Admin audit log entries                   | Event update, application review, check-in, magic link redemption, admin grant |
| Admin invites                             | Pending, redeemed, cancelled                                                   |
| Trust link between communities            | Sister City trusts Anfangszeit                                                 |
| Sliding scale pricing                     | Concrete & Wax (min 1500, max 4000)                                            |
| Max tickets per user                      | Backyard Sessions (limit 2)                                                    |
| Event with resale enabled                 | Concrete & Wax, Low Frequency, Rooftop Listening                               |
| Notification prefs (digest + all)         | Kim digest on Anfangszeit, Nomi all on Sister City                             |
| Marketing opt-out                         | Tobias (globalMarketingOptOut)                                                 |
| Scheduled marketing email                 | Concrete & Wax announcement                                                    |
| Event broadcast                           | Concrete & Wax update from Kim                                                 |

### Not covered (and why)

| State                                    | Reason                                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Completed resale (buyer receives ticket) | Resale completion involves Stripe refund flows that can't run without a live payment. Covered in E2E tests with mocked Stripe. |
| Multiple communities per admin           | Would add complexity without testing a distinct code path. Nomi already shows multi-role (admin + scanner).                    |
| Released orders / release reasons        | Millisecond-lived transitional states created by timeout or cancellation flows. Not meaningful in a static demo.               |
| Processing/failed Stripe states          | Transient error-recovery states driven by Stripe webhooks.                                                                     |
| Dispute financial events                 | Stripe webhook-driven. Covered in `backend/convex/orders/core.test.ts`.                                                        |
