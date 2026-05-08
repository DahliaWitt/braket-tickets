import {beforeEach, describe, expect, it, vi} from 'vitest';
import {mockDeep} from 'vitest-mock-extended';
import type Stripe from 'stripe';
import {mapV2AccountStatus, ensurePaymentMethodDomain} from './accounts';

const paymentMethodDomainsListMock = vi.hoisted(() => vi.fn());
const paymentMethodDomainsCreateMock = vi.hoisted(() => vi.fn());

vi.mock('../../lib/stripe_node', () => ({
  getStripeClient: () => ({
    paymentMethodDomains: {
      list: paymentMethodDomainsListMock,
      create: paymentMethodDomainsCreateMock,
    },
  }),
}));

/**
 * Pure-function coverage for the V2 account state projector.
 *
 * The live Stripe SDK integration (`createV2ConnectedAccount`,
 * `ensureManualPayoutSettings`, `checkConnectedAccountStatus`,
 * `offboardConnectedAccount`) is exercised by the mocked-Stripe
 * `stripe_connect_actions.test.ts` integration suite in Task 11.
 */

function buildAccount(
  overrides: {
    cardPaymentsStatus?: 'active' | 'pending' | 'restricted' | 'unsupported';
    requirements?: Array<{awaiting: 'user' | 'stripe'; description: string}>;
  } = {},
): Stripe.V2.Core.Account {
  const cardPaymentsStatus = overrides.cardPaymentsStatus;
  const requirements = overrides.requirements ?? [];

  const account = mockDeep<Stripe.V2.Core.Account>();
  account.id = 'acct_test';
  account.object = 'v2.core.account';
  account.configuration = {
    merchant: cardPaymentsStatus
      ? {
          applied: true,
          capabilities: {
            card_payments: {
              status: cardPaymentsStatus,
              status_details: [],
            },
          },
        }
      : undefined,
  } as Stripe.V2.Core.Account['configuration'];
  account.requirements = {
    entries: requirements.map((entry) => ({
      awaiting_action_from: entry.awaiting,
      description: entry.description,
      errors: [],
      impact: {},
      minimum_deadline: {status: 'currently_due'},
      requested_reasons: [],
    })),
  } as Stripe.V2.Core.Account['requirements'];
  return account;
}

function buildBalanceSettings(
  overrides: {
    payoutStatus?: Stripe.BalanceSettings.Payments.Payouts.Status;
    payoutScheduleInterval?: Stripe.BalanceSettings.Payments.Payouts.Schedule.Interval | null;
  } = {},
): Stripe.BalanceSettings {
  const payoutStatus = overrides.payoutStatus ?? 'enabled';
  const payoutScheduleInterval = overrides.payoutScheduleInterval ?? 'manual';

  const settings = mockDeep<Stripe.BalanceSettings>();
  settings.object = 'balance_settings';
  settings.payments = {
    debit_negative_balances: null,
    payouts: {
      minimum_balance_by_currency: null,
      schedule: payoutScheduleInterval
        ? {interval: payoutScheduleInterval}
        : null,
      statement_descriptor: null,
      status: payoutStatus,
    },
    settlement_timing: {delay_days: 2},
  } as Stripe.BalanceSettings.Payments;
  return settings;
}

describe('mapV2AccountStatus', () => {
  it('reports not_started when the merchant configuration is absent', () => {
    const status = mapV2AccountStatus(buildAccount(), buildBalanceSettings());
    expect(status.onboardingStatus).toBe('not_started');
    expect(status.chargesEnabled).toBe(false);
    expect(status.payoutsEnabled).toBe(false);
    expect(status.userRequirementsClear).toBe(true);
    expect(status.currentlyDue).toStrictEqual([]);
  });

  it('reports complete when card_payments is active and no user requirements remain', () => {
    const status = mapV2AccountStatus(
      buildAccount({cardPaymentsStatus: 'active'}),
      buildBalanceSettings(),
    );
    expect(status.onboardingStatus).toBe('complete');
    expect(status.chargesEnabled).toBe(true);
    expect(status.payoutsEnabled).toBe(true);
    expect(status.userRequirementsClear).toBe(true);
  });

  it('reports restricted when card_payments is active but Stripe is waiting on the user', () => {
    const status = mapV2AccountStatus(
      buildAccount({
        cardPaymentsStatus: 'active',
        requirements: [
          {awaiting: 'user', description: 'tos.acceptance'},
          {awaiting: 'stripe', description: 'stripe.internal_review'},
        ],
      }),
      buildBalanceSettings({payoutStatus: 'disabled'}),
    );
    expect(status.onboardingStatus).toBe('restricted');
    expect(status.chargesEnabled).toBe(true);
    expect(status.payoutsEnabled).toBe(false);
    expect(status.currentlyDue).toStrictEqual(['tos.acceptance']);
  });

  it('reports payout_settings_pending when payout schedule is not manual', () => {
    const status = mapV2AccountStatus(
      buildAccount({cardPaymentsStatus: 'active'}),
      buildBalanceSettings({payoutScheduleInterval: 'daily'}),
    );
    expect(status.onboardingStatus).toBe('payout_settings_pending');
    expect(status.chargesEnabled).toBe(true);
    expect(status.payoutsEnabled).toBe(true);
  });

  it('reports in_progress when card_payments is pending or restricted', () => {
    for (const cardPaymentsStatus of ['pending', 'restricted'] as const) {
      const status = mapV2AccountStatus(
        buildAccount({cardPaymentsStatus}),
        buildBalanceSettings({payoutStatus: 'disabled'}),
      );
      expect(status.onboardingStatus).toBe('in_progress');
      expect(status.chargesEnabled).toBe(false);
      expect(status.payoutsEnabled).toBe(false);
    }
  });

  it('only surfaces user-action requirements in currentlyDue', () => {
    const status = mapV2AccountStatus(
      buildAccount({
        cardPaymentsStatus: 'active',
        requirements: [
          {awaiting: 'stripe', description: 'stripe.internal_review'},
        ],
      }),
      buildBalanceSettings(),
    );
    expect(status.currentlyDue).toStrictEqual([]);
    expect(status.userRequirementsClear).toBe(true);
    expect(status.onboardingStatus).toBe('in_progress');
  });
});

function buildPaymentMethodDomain(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pmd_test_123',
    object: 'payment_method_domain' as const,
    domain_name: 'braket.gay',
    enabled: true,
    created: 1700000000,
    livemode: false,
    apple_pay: {status: 'active' as const},
    google_pay: {status: 'active' as const},
    link: {status: 'active' as const},
    amazon_pay: {status: 'inactive' as const},
    klarna: {status: 'inactive' as const},
    paypal: {status: 'inactive' as const},
    ...overrides,
  };
}

describe('ensurePaymentMethodDomain', () => {
  beforeEach(() => {
    paymentMethodDomainsListMock.mockReset();
    paymentMethodDomainsCreateMock.mockReset();
  });

  it('returns existing domain without creating', async () => {
    const existing = buildPaymentMethodDomain();
    paymentMethodDomainsListMock.mockResolvedValue({data: [existing]});

    const result = await ensurePaymentMethodDomain('acct_test', 'braket.gay');

    expect(result).toEqual({
      applePayStatus: 'active',
      googlePayStatus: 'active',
    });
    expect(paymentMethodDomainsCreateMock).not.toHaveBeenCalled();
    expect(paymentMethodDomainsListMock).toHaveBeenCalledWith(
      {domain_name: 'braket.gay', enabled: true},
      {stripeAccount: 'acct_test'},
    );
  });

  it('creates domain when none exists', async () => {
    paymentMethodDomainsListMock.mockResolvedValue({data: []});
    paymentMethodDomainsCreateMock.mockResolvedValue(
      buildPaymentMethodDomain(),
    );

    const result = await ensurePaymentMethodDomain('acct_test', 'braket.gay');

    expect(result).toEqual({
      applePayStatus: 'active',
      googlePayStatus: 'active',
    });
    expect(paymentMethodDomainsCreateMock).toHaveBeenCalledWith(
      {domain_name: 'braket.gay'},
      {stripeAccount: 'acct_test'},
    );
  });

  it('surfaces inactive statuses without throwing', async () => {
    paymentMethodDomainsListMock.mockResolvedValue({data: []});
    paymentMethodDomainsCreateMock.mockResolvedValue(
      buildPaymentMethodDomain({
        apple_pay: {status: 'inactive'},
        google_pay: {status: 'active'},
      }),
    );

    const result = await ensurePaymentMethodDomain('acct_test', 'braket.gay');

    expect(result).toEqual({
      applePayStatus: 'inactive',
      googlePayStatus: 'active',
    });
  });

  it('propagates Stripe errors', async () => {
    paymentMethodDomainsListMock.mockRejectedValue(
      new Error('Stripe rate limit'),
    );

    await expect(
      ensurePaymentMethodDomain('acct_test', 'braket.gay'),
    ).rejects.toThrow('Stripe rate limit');
  });
});
