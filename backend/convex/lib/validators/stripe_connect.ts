import {v, type Infer} from 'convex/values';
import type {AssertEqual} from '../type_utils';

/**
 * Payout state for a connected account's event settlement surface.
 *
 * Derived from the `payout_allocations` ledger — not a mutable flag on
 * `events`. Surfaced by the admin read-models so operators can see per-event
 * payout status without joining tables manually.
 *
 * States:
 *   - `not_eligible` — event date has not passed plus the payout delay yet.
 *   - `eligible` — event settled, ready to be picked up by the next cron run.
 *   - `pending_confirmation` — Stripe `payout.create` returned; awaiting
 *     `payout.paid` / `payout.failed` webhook.
 *   - `paid` — `payout.paid` confirmed; funds are on their way to the bank.
 *   - `failed` — `payout.failed` received. Event stays eligible for the next
 *     cron run because the backing allocation is marked `failed`.
 *   - `skipped` — Zero net revenue, or the organizer has no connected account.
 */
export const PAYOUT_STATES = [
  'not_eligible',
  'eligible',
  'pending_confirmation',
  'paid',
  'failed',
  'skipped',
] as const;
export type PayoutState = (typeof PAYOUT_STATES)[number];

export const payoutStateValidator = v.union(
  v.literal(PAYOUT_STATES[0]),
  v.literal(PAYOUT_STATES[1]),
  v.literal(PAYOUT_STATES[2]),
  v.literal(PAYOUT_STATES[3]),
  v.literal(PAYOUT_STATES[4]),
  v.literal(PAYOUT_STATES[5]),
);

const _payoutStateMatchesType: AssertEqual<
  Infer<typeof payoutStateValidator>,
  PayoutState
> = true;

/**
 * Stripe Accounts V2 onboarding status for a connected organizer.
 *
 * Stored on the organizer row as `stripeOnboardingStatus`, with capability
 * flags cached separately (`stripeChargesEnabled`, `stripePayoutsEnabled`).
 *
 * States:
 *   - `not_started` — Promoter has not begun onboarding. No account exists.
 *   - `in_progress` — Embedded Account Onboarding session active; Stripe is
 *     still collecting KYC, bank details, etc.
 *   - `payout_settings_pending` — V2 account exists but manual payout schedule
 *     has not been verified via Balance Settings yet. Promoter cannot sell.
 *   - `complete` — Manual payout schedule is verified and there are no open
 *     V2 requirements entries. Charge / payout capability state is cached
 *     separately on the organizer (`stripeChargesEnabled`, `stripePayoutsEnabled`).
 *   - `restricted` — Stripe added new KYC requirements after the initial
 *     completion (e.g., extra docs, ownership confirmation). Sales continue
 *     only as long as `stripeChargesEnabled` stays true.
 */
export const ONBOARDING_STATUSES = [
  'not_started',
  'in_progress',
  'payout_settings_pending',
  'complete',
  'restricted',
] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

export const onboardingStatusValidator = v.union(
  v.literal(ONBOARDING_STATUSES[0]),
  v.literal(ONBOARDING_STATUSES[1]),
  v.literal(ONBOARDING_STATUSES[2]),
  v.literal(ONBOARDING_STATUSES[3]),
  v.literal(ONBOARDING_STATUSES[4]),
);

const _onboardingStatusMatchesType: AssertEqual<
  Infer<typeof onboardingStatusValidator>,
  OnboardingStatus
> = true;

export const connectedAccountStatusFields = {
  chargesEnabled: v.boolean(),
  payoutsEnabled: v.boolean(),
  userRequirementsClear: v.boolean(),
  currentlyDue: v.array(v.string()),
  onboardingStatus: onboardingStatusValidator,
} as const;

export const connectedAccountStatusValidator = v.object(
  connectedAccountStatusFields,
);

/**
 * Lifecycle state for a durable `payout_batches` row.
 *
 * Created `pending` before calling Stripe so the idempotency key, amount, and
 * allocations are persisted. Transitions to `submitted` once Stripe returns a
 * payout ID, then `paid` / `failed` when the webhook confirms.
 */
export const PAYOUT_BATCH_STATUSES = [
  'pending',
  'submitted',
  'paid',
  'failed',
] as const;
export type PayoutBatchStatus = (typeof PAYOUT_BATCH_STATUSES)[number];

export const payoutBatchStatusValidator = v.union(
  v.literal(PAYOUT_BATCH_STATUSES[0]),
  v.literal(PAYOUT_BATCH_STATUSES[1]),
  v.literal(PAYOUT_BATCH_STATUSES[2]),
  v.literal(PAYOUT_BATCH_STATUSES[3]),
);

const _payoutBatchStatusMatchesType: AssertEqual<
  Infer<typeof payoutBatchStatusValidator>,
  PayoutBatchStatus
> = true;

/**
 * How a `payout_batches` row came to exist. `cron` batches are created by
 * the scheduled payout pipeline before their Stripe payout is submitted;
 * `external` batches are ingested from a `payout.paid` webhook for a payout
 * created outside the pipeline (Stripe dashboard), already `paid` at insert.
 */
export const PAYOUT_BATCH_ORIGINS = ['cron', 'external'] as const;
export type PayoutBatchOrigin = (typeof PAYOUT_BATCH_ORIGINS)[number];

export const payoutBatchOriginValidator = v.union(
  v.literal(PAYOUT_BATCH_ORIGINS[0]),
  v.literal(PAYOUT_BATCH_ORIGINS[1]),
);

const _payoutBatchOriginMatchesType: AssertEqual<
  Infer<typeof payoutBatchOriginValidator>,
  PayoutBatchOrigin
> = true;

/**
 * Lifecycle state for a `payout_allocations` row.
 *
 * Allocations are created alongside their parent batch and move to `paid` or
 * `failed` when the payout webhook confirms. They have no `pending` row state
 * because they are always created together with a batch that is at least
 * `pending`.
 */
export const PAYOUT_ALLOCATION_STATUSES = [
  'pending_confirmation',
  'paid',
  'failed',
] as const;
export type PayoutAllocationStatus =
  (typeof PAYOUT_ALLOCATION_STATUSES)[number];

export const payoutAllocationStatusValidator = v.union(
  v.literal(PAYOUT_ALLOCATION_STATUSES[0]),
  v.literal(PAYOUT_ALLOCATION_STATUSES[1]),
  v.literal(PAYOUT_ALLOCATION_STATUSES[2]),
);

const _payoutAllocationStatusMatchesType: AssertEqual<
  Infer<typeof payoutAllocationStatusValidator>,
  PayoutAllocationStatus
> = true;
