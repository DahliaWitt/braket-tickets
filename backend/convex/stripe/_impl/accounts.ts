'use node';

import type Stripe from 'stripe';
// eslint-disable-next-line @convex-dev/import-wrong-runtime -- importer is 'use node'; plugin heuristic misses that. Same pattern as stripe/actions.ts.
import {getStripeClient} from '../../lib/stripe_node';
import type {OnboardingStatus} from '../../lib/validators/stripe_connect';
import {STRIPE_V2_ACCOUNT_CONFIG} from './constants';

/**
 * Stripe Accounts V2 domain helpers.
 *
 * This module is pure Stripe-SDK glue — no Convex ctx, no `ctx.db`. Actions
 * in `stripe/actions.ts` orchestrate: they resolve the organizer via
 * `ctx.runQuery`, call these helpers to hit Stripe, then persist the result
 * via `ctx.runMutation`. Keeping the domain layer ctx-free lets us unit-test
 * it with a plain mocked Stripe client.
 *
 * The shape of a V2 Stripe account differs from v1:
 * - Capabilities live under `configuration.merchant.capabilities.*.status`.
 * - Requirements live under `requirements.entries[]`, not
 *   `requirements.currently_due`.
 * - `payouts.schedule` is no longer accepted inline at account creation —
 *   it must be set via `balanceSettings.update(...)` after the account
 *   exists.
 */

export interface CreateV2ConnectedAccountArgs {
  /** Our internal organizer id — threaded into the idempotency key. */
  organizerId: string;
  contactEmail: string;
  displayName: string;
  /** ISO 3166-1 alpha-2 country code. Defaults to `'us'`. */
  country?: string;
}

export interface CreateV2ConnectedAccountResult {
  accountId: string;
}

/**
 * Create a Stripe V2 connected account using the shared
 * {@link STRIPE_V2_ACCOUNT_CONFIG} SSOT for dashboard + responsibilities +
 * merchant configuration.
 *
 * Idempotent: the key is `braket-v2-account-${organizerId}`, so repeated
 * calls with the same organizer reuse the same Stripe account record.
 *
 * CRITICAL: `defaults.responsibilities` locks immutably once the merchant
 * configuration is applied. Do not attempt to change
 * fees_collector/losses_collector after the first charge lands — Stripe
 * will reject the request.
 */
export async function createV2ConnectedAccount(
  args: CreateV2ConnectedAccountArgs,
): Promise<CreateV2ConnectedAccountResult> {
  const stripe = getStripeClient();
  const idempotencyKey = `braket-v2-account-${args.organizerId}`;

  const account = await stripe.v2.core.accounts.create(
    {
      contact_email: args.contactEmail,
      display_name: args.displayName,
      ...STRIPE_V2_ACCOUNT_CONFIG,
      identity: {
        country: args.country ?? 'us',
      },
    },
    {idempotencyKey},
  );

  return {accountId: account.id};
}

export interface EnsureManualPayoutSettingsResult {
  payoutScheduleVerified: boolean;
}

/**
 * Set the connected account's payout schedule to `manual`, then read back
 * the BalanceSettings to confirm the change landed.
 *
 * Required before the organizer can sell: our settlement ledger assumes
 * payouts happen only when we explicitly call `stripe.payouts.create`. An
 * account on the default daily/weekly schedule would release funds before
 * the event date, defeating the reserve math.
 */
export async function ensureManualPayoutSettings(
  connectedAccountId: string,
): Promise<EnsureManualPayoutSettingsResult> {
  const stripe = getStripeClient();

  await stripe.balanceSettings.update(
    {
      payments: {
        payouts: {
          schedule: {interval: 'manual'},
        },
      },
    },
    {stripeAccount: connectedAccountId},
  );

  const balanceSettings = await stripe.balanceSettings.retrieve(undefined, {
    stripeAccount: connectedAccountId,
  });

  return {
    payoutScheduleVerified:
      balanceSettings.payments.payouts?.schedule?.interval === 'manual',
  };
}

/**
 * Subset of embedded Connect components this platform ever enables. Each
 * boolean flips on the corresponding Stripe component in the session;
 * undefined/false leaves the component disabled.
 *
 * Shape mirrors the Stripe AccountSession create params but is expressed in
 * camelCase because that's the external-facing vocabulary of our actions.
 */
export interface AccountSessionComponents {
  accountOnboarding?: boolean;
  accountManagement?: boolean;
  notificationBanner?: boolean;
  payments?: boolean;
  balances?: boolean;
  documents?: boolean;
}

export interface CreateAccountSessionArgs {
  connectedAccountId: string;
  components: AccountSessionComponents;
}

export interface CreateAccountSessionResult {
  clientSecret: string;
}

/**
 * Create a Stripe Account Session for embedded Connect components.
 *
 * The returned `client_secret` is passed to `@stripe/connect-js` on the
 * frontend to initialize the StripeConnectInstance. The secret is
 * short-lived; components handle refresh internally via the
 * `fetchClientSecret` callback.
 *
 * Feature flags are intentionally conservative:
 * - `account_onboarding` exposes external account collection so promoters
 *   can link a bank account.
 * - `balances` disables `instant_payouts`, `standard_payouts`, and
 *   `edit_payout_schedule` because our platform owns the payout cadence
 *   (manual via our cron). Without this, promoters could trigger payouts
 *   that break the settlement ledger.
 * - `payments` enables `dispute_management` so promoters can respond to
 *   disputes directly from their dashboard-in-app.
 */
export async function createAccountSession(
  args: CreateAccountSessionArgs,
): Promise<CreateAccountSessionResult> {
  const stripe = getStripeClient();

  const {components} = args;
  const session = await stripe.accountSessions.create({
    account: args.connectedAccountId,
    components: {
      ...(components.accountOnboarding && {
        account_onboarding: {
          enabled: true,
          features: {external_account_collection: true},
        },
      }),
      ...(components.accountManagement && {
        account_management: {enabled: true},
      }),
      ...(components.notificationBanner && {
        notification_banner: {enabled: true},
      }),
      ...(components.payments && {
        payments: {
          enabled: true,
          features: {dispute_management: true},
        },
      }),
      ...(components.balances && {
        balances: {
          enabled: true,
          features: {
            instant_payouts: false,
            standard_payouts: false,
            edit_payout_schedule: false,
            external_account_collection: true,
          },
        },
      }),
      ...(components.documents && {
        documents: {enabled: true},
      }),
    },
  });

  return {clientSecret: session.client_secret};
}

export interface CreateAccountOnboardingLinkArgs {
  connectedAccountId: string;
  /** Stripe redirects here after the user finishes or presses "done". */
  returnUrl: string;
  /** Stripe redirects here if the link expires mid-flow. */
  refreshUrl: string;
}

export interface CreateAccountOnboardingLinkResult {
  /** Short-lived Stripe-hosted onboarding URL. */
  url: string;
}

/**
 * Create a Stripe V2 Account Link for hosted onboarding.
 *
 * The embedded Account Onboarding component only renders fields when
 * `requirements_collector` on the connected account is `"application"`.
 * Our V2 accounts use `losses_collector: "stripe"`, which auto-derives
 * `requirements_collector: "stripe"` — so KYC collection must happen on
 * Stripe's hosted URL, not inline. This helper mints that URL.
 *
 * Other embedded components (account-management, payments, balances,
 * notification-banner) render fine after onboarding completes, so we
 * keep those inline and only the initial KYC flow is redirected.
 */
export async function createV2AccountOnboardingLink(
  args: CreateAccountOnboardingLinkArgs,
): Promise<CreateAccountOnboardingLinkResult> {
  const stripe = getStripeClient();
  const link = await stripe.v2.core.accountLinks.create({
    account: args.connectedAccountId,
    use_case: {
      type: 'account_onboarding',
      account_onboarding: {
        configurations: ['merchant'],
        return_url: args.returnUrl,
        refresh_url: args.refreshUrl,
      },
    },
  });
  return {url: link.url};
}

export interface ConnectedAccountStatus {
  /** True when card_payments capability is active. */
  chargesEnabled: boolean;
  /**
   * Whether Stripe currently allows payouts for the connected account.
   *
   * Sourced from `balanceSettings.payments.payouts.status === 'enabled'`.
   * This is intentionally *not* derived from V2 account requirements.
   */
  payoutsEnabled: boolean;
  /**
   * True when Stripe has no currently-due requirements where
   * `awaiting_action_from === 'user'`.
   *
   * This is *not* a holistic "Stripe has everything" indicator — requirements
   * can still be pending review or awaiting Stripe-side action. Use it only as
   * a narrow UX signal for "the user has no obvious next steps".
   */
  userRequirementsClear: boolean;
  /**
   * `requirements.entries[].description` values where
   * `awaiting_action_from === 'user'`. Surfaced to the promoter UI so they
   * can see exactly which KYC fields are still open.
   */
  currentlyDue: string[];
  /**
   * Derived onboarding lifecycle for the organizer row. Single place that
   * maps the V2 account shape onto our internal enum so feature code never
   * re-implements it.
   */
  onboardingStatus: OnboardingStatus;
}

/**
 * Retrieve the V2 account and balance settings, then project state onto our
 * internal read-model.
 *
 * Called by the onboarding return flow, the V2 event destination webhook
 * handler, and (as a backstop) the v1 Connect snapshot webhook handler.
 */
export async function checkConnectedAccountStatus(
  connectedAccountId: string,
): Promise<ConnectedAccountStatus> {
  const stripe = getStripeClient();
  const [account, balanceSettings] = await Promise.all([
    stripe.v2.core.accounts.retrieve(connectedAccountId, {
      include: [
        'configuration.merchant',
        'requirements',
        'future_requirements',
      ],
    }),
    stripe.balanceSettings.retrieve(undefined, {
      stripeAccount: connectedAccountId,
    }),
  ]);

  return mapV2AccountStatus(account, balanceSettings);
}

/**
 * Pure projection from Stripe objects to our internal read model.
 *
 * Exposed for unit testing — all webhook handlers and admin pollers converge
 * on this mapping so we don't maintain multiple copies.
 */
export function mapV2AccountStatus(
  account: Stripe.V2.Core.Account,
  balanceSettings: Stripe.BalanceSettings,
): ConnectedAccountStatus {
  const cardPaymentsStatus =
    account.configuration?.merchant?.capabilities?.card_payments?.status;
  const chargesEnabled = cardPaymentsStatus === 'active';

  const entries = account.requirements?.entries ?? [];
  const hasOpenRequirements = entries.length > 0;
  const currentlyDue = entries
    .filter((entry) => entry.awaiting_action_from === 'user')
    .map((entry) => entry.description);

  const userRequirementsClear = currentlyDue.length === 0;
  const payoutsEnabled =
    cardPaymentsStatus === undefined
      ? false
      : balanceSettings.payments.payouts?.status === 'enabled';
  const payoutScheduleInterval =
    balanceSettings.payments.payouts?.schedule?.interval ?? null;
  const manualPayoutScheduleVerified = payoutScheduleInterval === 'manual';

  let onboardingStatus: OnboardingStatus;
  if (cardPaymentsStatus === undefined) {
    onboardingStatus = 'not_started';
  } else if (!manualPayoutScheduleVerified) {
    onboardingStatus = 'payout_settings_pending';
  } else if (cardPaymentsStatus === 'active' && !hasOpenRequirements) {
    onboardingStatus = 'complete';
  } else if (cardPaymentsStatus === 'active' && !userRequirementsClear) {
    // Capability is live but Stripe added new requirements — the account is
    // restricted pending follow-up docs.
    onboardingStatus = 'restricted';
  } else {
    onboardingStatus = 'in_progress';
  }

  return {
    chargesEnabled,
    payoutsEnabled,
    userRequirementsClear,
    currentlyDue,
    onboardingStatus,
  };
}

export interface EnsurePaymentMethodDomainResult {
  applePayStatus: 'active' | 'inactive';
  googlePayStatus: 'active' | 'inactive';
}

/**
 * Register the platform's domain as a payment method domain on the connected
 * account so Apple Pay and Google Pay appear in Embedded Checkout for direct
 * charges. Idempotent: lists existing domains first, creates only if missing.
 */
export async function ensurePaymentMethodDomain(
  connectedAccountId: string,
  domainName: string,
): Promise<EnsurePaymentMethodDomainResult> {
  const stripe = getStripeClient();
  const opts: Stripe.RequestOptions = {stripeAccount: connectedAccountId};

  const existing = await stripe.paymentMethodDomains.list(
    {domain_name: domainName, enabled: true},
    opts,
  );

  const domain =
    existing.data[0] ??
    (await stripe.paymentMethodDomains.create({domain_name: domainName}, opts));

  return {
    applePayStatus: domain.apple_pay.status,
    googlePayStatus: domain.google_pay.status,
  };
}

/**
 * Offboard a platform-created V2 connected account.
 *
 * With `losses_collector = 'stripe'`, the platform never owns the liability,
 * so the "delete the account" path is bounded: we close the merchant
 * configuration via the V2 close API. If Stripe rejects the close (balance
 * on hand, open disputes, etc.), the account stays live and the caller is
 * expected to mark the organizer deactivated locally so we simply stop
 * interacting with the account.
 *
 * Returns whether the remote close succeeded. Callers always apply local
 * deactivation regardless.
 */
export async function offboardConnectedAccount(
  connectedAccountId: string,
): Promise<{remoteClosed: boolean}> {
  const stripe = getStripeClient();
  try {
    await stripe.v2.core.accounts.close(connectedAccountId, {
      applied_configurations: ['merchant'],
    });
    return {remoteClosed: true};
  } catch {
    // Balance, capabilities, or Stripe policy may block the close. Local
    // deactivation is the authoritative control — keep the account id for
    // audit history and let ops follow up if Stripe-side cleanup matters.
    return {remoteClosed: false};
  }
}
