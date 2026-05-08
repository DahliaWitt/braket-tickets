/**
 * Stripe Accounts V2 shared constants.
 *
 * Single source of truth for the V2 account configuration object and
 * statement-descriptor helpers. Imported by `stripe/_impl/accounts.ts`
 * at account creation and by `stripe/_impl/checkout.ts` when building
 * PaymentIntent params.
 *
 * Pure module — no SDK imports, no Node built-ins — so it can be shared
 * between Node actions and the Convex runtime if needed.
 */

/**
 * Stripe Accounts V2 account-creation configuration.
 *
 * Passed to `stripe.v2.core.accounts.create(...)` as the base config:
 * - `dashboard: 'none'` — promoters never see a Stripe Dashboard; all
 *   account management happens in-app via embedded Connect components.
 * - `defaults.responsibilities.fees_collector: 'stripe'` — Stripe deducts
 *   processing fees from the connected account directly (not the platform).
 * - `defaults.responsibilities.losses_collector: 'stripe'` — Stripe is
 *   responsible for connected-account negative balances; the platform still
 *   owns negative balances on the platform account.
 * - `configuration.merchant` — declares the account as a merchant of record
 *   with card_payments capability requested.
 *
 * CRITICAL: `defaults.responsibilities` is IMMUTABLE once merchant
 * configuration is active. These values lock at account creation.
 */
/**
 * Shape constraint for {@link STRIPE_V2_ACCOUNT_CONFIG} — matches the
 * subset of `Stripe.V2.Core.AccountCreateParams` we populate, declared
 * locally so this module stays free of Stripe SDK imports.
 *
 * `locales` is typed as a mutable array of the `'en-US'` literal so the
 * value spreads cleanly into the Stripe param (which expects a mutable
 * `Array<Locale>` and rejects `readonly` arrays produced by a top-level
 * `as const`).
 */
interface StripeV2AccountConfig {
  dashboard: 'none';
  defaults: {
    currency: 'usd';
    responsibilities: {
      fees_collector: 'stripe';
      losses_collector: 'stripe';
    };
    locales: Array<'en-US'>;
  };
  configuration: {
    merchant: {
      capabilities: {
        card_payments: {requested: true};
      };
    };
  };
}

export const STRIPE_V2_ACCOUNT_CONFIG: StripeV2AccountConfig = {
  dashboard: 'none',
  defaults: {
    currency: 'usd',
    responsibilities: {
      fees_collector: 'stripe',
      losses_collector: 'stripe',
    },
    locales: ['en-US'],
  },
  configuration: {
    merchant: {
      capabilities: {
        card_payments: {requested: true},
      },
    },
  },
};

/**
 * Max chars Stripe allows for `statement_descriptor_suffix` on a
 * PaymentIntent. Longer suffixes are rejected at API time.
 */
export const STATEMENT_DESCRIPTOR_MAX_LENGTH = 22;

/**
 * Sanitize an event name for use as a Stripe
 * `statement_descriptor_suffix`.
 *
 * Stripe allows a restricted punctuation set per
 * https://stripe.com/docs/statement-descriptors — alphanumeric, spaces,
 * and `.,;#@!-`. Anything else is stripped. Special characters that
 * Stripe rejects (`< > "` `*` `$` etc.) are filtered; `'` and `(` / `)`
 * are not on Stripe's allow list. Result is trimmed and truncated to
 * {@link STATEMENT_DESCRIPTOR_MAX_LENGTH}.
 *
 * Returns an empty string if the input has no usable characters. Callers
 * should omit the field rather than passing an empty string.
 */
export function sanitizeStatementDescriptor(eventName: string): string {
  return eventName
    .replace(/[^a-zA-Z0-9 .,;#@!-]/g, '')
    .trim()
    .slice(0, STATEMENT_DESCRIPTOR_MAX_LENGTH);
}
