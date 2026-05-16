import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {convexTest} from '../setup.testing';
import {api} from '../_generated/api';
import {internal} from '../_generated/api';
import type {Id} from '../_generated/dataModel';

// All Stripe V2 SDK calls are mocked. Real traffic is covered by the
// sandbox contract test suite (`stripe/sandbox_contract.test.ts`).
const stripeCtorMock = vi.hoisted(() => vi.fn());
const v2AccountsCreateMock = vi.hoisted(() => vi.fn());
const v2AccountsRetrieveMock = vi.hoisted(() => vi.fn());
const v2AccountsCloseMock = vi.hoisted(() => vi.fn());
const balanceSettingsUpdateMock = vi.hoisted(() => vi.fn());
const balanceSettingsRetrieveMock = vi.hoisted(() => vi.fn());
const accountSessionsCreateMock = vi.hoisted(() => vi.fn());
const v2AccountLinksCreateMock = vi.hoisted(() => vi.fn());

vi.mock('stripe', () => {
  class StripeMock {
    static errors = {
      StripeSignatureVerificationError: class StripeSignatureVerificationError extends Error {},
    };

    v2 = {
      core: {
        accounts: {
          create: v2AccountsCreateMock,
          retrieve: v2AccountsRetrieveMock,
          close: v2AccountsCloseMock,
        },
        accountLinks: {
          create: v2AccountLinksCreateMock,
        },
      },
    };

    balanceSettings = {
      update: balanceSettingsUpdateMock,
      retrieve: balanceSettingsRetrieveMock,
    };

    accountSessions = {
      create: accountSessionsCreateMock,
    };

    // Referenced by other Stripe actions that share this mock module.
    webhooks = {constructEvent: vi.fn()};
    paymentIntents = {create: vi.fn(), retrieve: vi.fn()};
    refunds = {create: vi.fn()};
    balance = {retrieve: vi.fn()};
    payouts = {create: vi.fn()};
    checkout = {sessions: {create: vi.fn(), retrieve: vi.fn()}};

    constructor(secretKey: string) {
      stripeCtorMock(secretKey);
    }
  }

  return {default: StripeMock};
});

function v2MerchantAccount(
  overrides: {
    cardPaymentsStatus?: 'active' | 'pending' | 'restricted';
    requirements?: Array<{awaiting: 'user' | 'stripe'; description: string}>;
  } = {},
): Record<string, unknown> {
  const cardPaymentsStatus = overrides.cardPaymentsStatus ?? 'active';
  const requirements = overrides.requirements ?? [];
  return {
    id: 'acct_mock',
    object: 'v2.core.account',
    configuration: {
      merchant: {
        applied: true,
        capabilities: {
          card_payments: {status: cardPaymentsStatus, status_details: []},
        },
      },
    },
    requirements: {
      entries: requirements.map((entry) => ({
        awaiting_action_from: entry.awaiting,
        description: entry.description,
        errors: [],
        impact: {},
        minimum_deadline: {},
        requested_reasons: [],
      })),
    },
  };
}

describe('stripe_actions V2 connect management', () => {
  const originalStripeKey = process.env['STRIPE_SECRET_KEY'];
  const originalSiteUrl = process.env['SITE_URL'];
  const originalAllowLocalhostCors = process.env['ALLOW_LOCALHOST_CORS'];

  beforeEach(() => {
    vi.clearAllMocks();
    process.env['STRIPE_SECRET_KEY'] = 'sk_test_fake';

    v2AccountsCreateMock.mockResolvedValue({id: 'acct_mock'});
    v2AccountsRetrieveMock.mockResolvedValue(v2MerchantAccount());
    v2AccountsCloseMock.mockResolvedValue({id: 'acct_mock'});
    balanceSettingsUpdateMock.mockResolvedValue({
      payments: {payouts: {schedule: {interval: 'manual'}, status: 'enabled'}},
    });
    balanceSettingsRetrieveMock.mockResolvedValue({
      payments: {payouts: {schedule: {interval: 'manual'}, status: 'enabled'}},
    });
    accountSessionsCreateMock.mockResolvedValue({
      client_secret: 'seccs_test',
    });
    v2AccountLinksCreateMock.mockResolvedValue({
      url: 'https://connect.stripe.test/onboarding-link',
    });
  });

  afterEach(() => {
    if (originalStripeKey === undefined) {
      delete process.env['STRIPE_SECRET_KEY'];
    } else {
      process.env['STRIPE_SECRET_KEY'] = originalStripeKey;
    }
    if (originalSiteUrl === undefined) {
      delete process.env['SITE_URL'];
    } else {
      process.env['SITE_URL'] = originalSiteUrl;
    }
    if (originalAllowLocalhostCors === undefined) {
      delete process.env['ALLOW_LOCALHOST_CORS'];
    } else {
      process.env['ALLOW_LOCALHOST_CORS'] = originalAllowLocalhostCors;
    }
  });

  async function seedCommunityAdmin(
    t: ReturnType<typeof convexTest>,
    opts?: {
      stripeConnectedAccountId?: string;
      stripeOnboardingStatus?:
        | 'not_started'
        | 'in_progress'
        | 'payout_settings_pending'
        | 'complete'
        | 'restricted';
    },
  ): Promise<{userId: Id<'users'>; organizerId: Id<'organizers'>}> {
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Community Admin',
      email: `admin-${crypto.randomUUID().slice(0, 8)}@test.com`,
    })) as Id<'users'>;
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Test Organizer',
        ...(opts?.stripeConnectedAccountId
          ? {stripeConnectedAccountId: opts.stripeConnectedAccountId}
          : {}),
        ...(opts?.stripeOnboardingStatus
          ? {stripeOnboardingStatus: opts.stripeOnboardingStatus}
          : {}),
        status: 'published',
      },
    );
    const granterId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Granter',
      email: `granter-${crypto.randomUUID().slice(0, 8)}@test.com`,
      isRootAdmin: true,
    })) as Id<'users'>;
    await t.mutation(api.testing.communities.seedCommunityAdmin, {
      userId,
      organizerId,
      grantedBy: granterId,
    });
    return {userId, organizerId};
  }

  describe('createConnectedAccount', () => {
    it('creates a V2 account with the SSOT config and verifies manual payouts', async () => {
      const t = convexTest();
      const {userId, organizerId} = await seedCommunityAdmin(t);

      const asUser = t.withIdentity({subject: userId});
      const result = await asUser.action(
        api.stripe.actions.createConnectedAccount,
        {organizerId},
      );

      expect(result).toEqual({
        stripeConnectedAccountId: 'acct_mock',
        alreadyExists: false,
      });
      expect(v2AccountsCreateMock).toHaveBeenCalledTimes(1);

      const [createParams] = v2AccountsCreateMock.mock.calls[0] as [
        Record<string, unknown>,
        Record<string, unknown>,
      ];
      // Immutable responsibilities from STRIPE_V2_ACCOUNT_CONFIG.
      expect(createParams['dashboard']).toBe('none');
      expect(createParams['defaults']).toMatchObject({
        responsibilities: {
          fees_collector: 'stripe',
          losses_collector: 'stripe',
        },
      });
      expect(createParams['configuration']).toMatchObject({
        merchant: {capabilities: {card_payments: {requested: true}}},
      });

      expect(balanceSettingsUpdateMock).toHaveBeenCalledTimes(1);
      const [updateParams, updateOptions] = balanceSettingsUpdateMock.mock
        .calls[0] as [Record<string, unknown>, Record<string, unknown>];
      expect(updateParams).toMatchObject({
        payments: {payouts: {schedule: {interval: 'manual'}}},
      });
      expect(updateOptions).toEqual({stripeAccount: 'acct_mock'});

      const organizer = await t.run(async (ctx) => ctx.db.get(organizerId));
      expect(organizer?.stripeConnectedAccountId).toBe('acct_mock');
      // Payout settings verified ≠ KYC complete. Hosted onboarding (via
      // createAccountOnboardingLink) must confirm charges_enabled before the
      // status advances to 'complete'. See BRA-391.
      expect(organizer?.stripeOnboardingStatus).toBe('in_progress');
    });

    it('re-verifies manual payouts for an existing account without creating a duplicate', async () => {
      const t = convexTest();
      const {userId, organizerId} = await seedCommunityAdmin(t, {
        stripeConnectedAccountId: 'acct_existing',
        stripeOnboardingStatus: 'payout_settings_pending',
      });

      const asUser = t.withIdentity({subject: userId});
      const result = await asUser.action(
        api.stripe.actions.createConnectedAccount,
        {organizerId},
      );

      expect(result).toEqual({
        stripeConnectedAccountId: 'acct_existing',
        alreadyExists: true,
      });
      expect(v2AccountsCreateMock).not.toHaveBeenCalled();
      expect(balanceSettingsUpdateMock).toHaveBeenCalledWith(
        expect.anything(),
        {stripeAccount: 'acct_existing'},
      );

      const organizer = await t.run(async (ctx) => ctx.db.get(organizerId));
      // Re-verify moves account from payout_settings_pending → in_progress.
      // KYC still pending; only checkAccountStatus (post hosted-onboarding)
      // advances to 'complete'. See BRA-391.
      expect(organizer?.stripeOnboardingStatus).toBe('in_progress');
    });

    it('throws when manual payout verification fails', async () => {
      balanceSettingsRetrieveMock.mockResolvedValueOnce({
        payments: {payouts: {schedule: {interval: 'daily'}}},
      });
      const t = convexTest();
      const {userId, organizerId} = await seedCommunityAdmin(t);

      const asUser = t.withIdentity({subject: userId});
      await expect(
        asUser.action(api.stripe.actions.createConnectedAccount, {
          organizerId,
        }),
      ).rejects.toThrow(/STRIPE_PAYOUT_SETTINGS_NOT_VERIFIED/);
    });
  });

  describe('createAccountSession', () => {
    it('returns a client secret and forwards requested components', async () => {
      const t = convexTest();
      const {userId, organizerId} = await seedCommunityAdmin(t, {
        stripeConnectedAccountId: 'acct_existing',
      });

      const asUser = t.withIdentity({subject: userId});
      const result = await asUser.action(
        api.stripe.actions.createAccountSession,
        {
          organizerId,
          components: {
            accountOnboarding: true,
            payments: true,
          },
        },
      );

      expect(result).toEqual({clientSecret: 'seccs_test'});
      expect(accountSessionsCreateMock).toHaveBeenCalledTimes(1);
      const [sessionParams] = accountSessionsCreateMock.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(sessionParams['account']).toBe('acct_existing');
      const components = sessionParams['components'] as Record<string, unknown>;
      expect(components).toMatchObject({
        account_onboarding: {
          enabled: true,
          features: {external_account_collection: true},
        },
        payments: {
          enabled: true,
          features: {dispute_management: true},
        },
      });
      expect(components).not.toHaveProperty('balances');
    });

    it('rejects when the organizer has no connected account', async () => {
      const t = convexTest();
      const {userId, organizerId} = await seedCommunityAdmin(t);

      const asUser = t.withIdentity({subject: userId});
      await expect(
        asUser.action(api.stripe.actions.createAccountSession, {
          organizerId,
          components: {accountOnboarding: true},
        }),
      ).rejects.toThrow(/does not have a Stripe account/);
    });
  });

  describe('checkAccountStatus', () => {
    it('syncs V2 state onto the organizer row', async () => {
      v2AccountsRetrieveMock.mockResolvedValue(
        v2MerchantAccount({
          cardPaymentsStatus: 'active',
          requirements: [{awaiting: 'user', description: 'tos.acceptance'}],
        }),
      );
      balanceSettingsRetrieveMock.mockResolvedValueOnce({
        payments: {
          payouts: {schedule: {interval: 'manual'}, status: 'disabled'},
        },
      });
      const t = convexTest();
      const {userId, organizerId} = await seedCommunityAdmin(t, {
        stripeConnectedAccountId: 'acct_existing',
      });

      const asUser = t.withIdentity({subject: userId});
      const result = await asUser.action(
        api.stripe.actions.checkAccountStatus,
        {organizerId},
      );

      expect(result).toEqual({
        chargesEnabled: true,
        payoutsEnabled: false,
        userRequirementsClear: false,
        onboardingStatus: 'restricted',
        currentlyDue: ['tos.acceptance'],
        chargeReady: true,
        payoutReady: false,
      });

      const organizer = await t.run(async (ctx) => ctx.db.get(organizerId));
      expect(organizer?.stripeOnboardingStatus).toBe('restricted');
      expect(organizer?.stripeChargesEnabled).toBe(true);
      expect(organizer?.stripePayoutsEnabled).toBe(false);
      expect(organizer?.stripeCurrentlyDue).toStrictEqual(['tos.acceptance']);
    });

    it('emits onboarding completion when charges and payouts become enabled', async () => {
      const t = convexTest();
      const organizerId = await t.mutation(
        api.testing.communities.seedOrganizer,
        {
          name: 'Completion Organizer',
          stripeConnectedAccountId: 'acct_existing',
          stripeOnboardingStatus: 'in_progress',
          stripeChargesEnabled: false,
          stripePayoutsEnabled: false,
        },
      );

      await t.mutation(
        internal.stripe.connect.updateOrganizerFromStripeAccount,
        {
          stripeConnectedAccountId: 'acct_existing',
          onboardingStatus: 'complete',
          chargesEnabled: true,
          payoutsEnabled: true,
          currentlyDue: [],
        },
      );

      const organizer = await t.run(async (ctx) => ctx.db.get(organizerId));
      expect(organizer?.stripeOnboardingStatus).toBe('complete');
      expect(organizer?.stripeChargesEnabled).toBe(true);
      expect(organizer?.stripePayoutsEnabled).toBe(true);
    });
  });

  describe('authorization', () => {
    it('uses the caller origin for hosted onboarding return URLs when trusted', async () => {
      const t = convexTest();
      const {userId, organizerId} = await seedCommunityAdmin(t, {
        stripeConnectedAccountId: 'acct_existing',
      });
      const asUser = t.withIdentity({subject: userId});

      await expect(
        asUser.action(api.stripe.actions.createAccountOnboardingLink, {
          organizerId,
          returnOrigin: 'http://localhost:4200',
        }),
      ).resolves.toEqual({url: 'https://connect.stripe.test/onboarding-link'});

      expect(v2AccountLinksCreateMock).toHaveBeenCalledTimes(1);
      const [params] = v2AccountLinksCreateMock.mock.calls[0] as [
        {
          use_case: {
            account_onboarding: {
              return_url: string;
              refresh_url: string;
            };
          };
        },
      ];

      expect(params.use_case.account_onboarding.return_url).toBe(
        `http://localhost:4200/community-admin/settings?community=${organizerId}&stripeOnboardingReturn=1`,
      );
      expect(params.use_case.account_onboarding.refresh_url).toBe(
        `http://localhost:4200/community-admin/settings?community=${organizerId}&stripeOnboardingRefresh=1`,
      );
    });

    it('allows localhost return URLs for local admin testing against dev', async () => {
      process.env['SITE_URL'] = 'https://dev.community.braket.gay';
      process.env['ALLOW_LOCALHOST_CORS'] = 'true';
      const t = convexTest();
      const {userId, organizerId} = await seedCommunityAdmin(t, {
        stripeConnectedAccountId: 'acct_existing',
      });
      const asUser = t.withIdentity({subject: userId});

      await asUser.action(api.stripe.actions.createAccountOnboardingLink, {
        organizerId,
        returnOrigin: 'http://localhost:4200',
      });

      const [params] = v2AccountLinksCreateMock.mock.calls[0] as [
        {
          use_case: {
            account_onboarding: {
              return_url: string;
              refresh_url: string;
            };
          };
        },
      ];

      expect(params.use_case.account_onboarding.return_url).toBe(
        `http://localhost:4200/community-admin/settings?community=${organizerId}&stripeOnboardingReturn=1`,
      );
      expect(params.use_case.account_onboarding.refresh_url).toBe(
        `http://localhost:4200/community-admin/settings?community=${organizerId}&stripeOnboardingRefresh=1`,
      );
    });

    it('falls back to SITE_URL for untrusted hosted onboarding return origins', async () => {
      const t = convexTest();
      const {userId, organizerId} = await seedCommunityAdmin(t, {
        stripeConnectedAccountId: 'acct_existing',
      });
      const asUser = t.withIdentity({subject: userId});

      await asUser.action(api.stripe.actions.createAccountOnboardingLink, {
        organizerId,
        returnOrigin: 'https://evil.example',
      });

      const [params] = v2AccountLinksCreateMock.mock.calls[0] as [
        {
          use_case: {
            account_onboarding: {
              return_url: string;
            };
          };
        },
      ];

      expect(params.use_case.account_onboarding.return_url).toBe(
        `http://localhost:4200/community-admin/settings?community=${organizerId}&stripeOnboardingReturn=1`,
      );
    });

    it('allows same-site HTTPS subdomains for hosted onboarding returns', async () => {
      process.env['SITE_URL'] = 'https://braket.gay';
      const t = convexTest();
      const {userId, organizerId} = await seedCommunityAdmin(t, {
        stripeConnectedAccountId: 'acct_existing',
      });
      const asUser = t.withIdentity({subject: userId});

      await asUser.action(api.stripe.actions.createAccountOnboardingLink, {
        organizerId,
        returnOrigin: 'https://dev.community.braket.gay',
      });

      const [params] = v2AccountLinksCreateMock.mock.calls[0] as [
        {
          use_case: {
            account_onboarding: {
              return_url: string;
            };
          };
        },
      ];

      expect(params.use_case.account_onboarding.return_url).toBe(
        `https://dev.community.braket.gay/community-admin/settings?community=${organizerId}&stripeOnboardingReturn=1`,
      );
    });

    it('rejects non-admin callers for connect management actions', async () => {
      const t = convexTest();
      const organizerId = await t.mutation(
        api.testing.communities.seedOrganizer,
        {
          name: 'Unauthorized Organizer',
          status: 'published',
        },
      );
      const userId = (await t.mutation(api.testing.users.createUserDirectly, {
        name: 'Member',
        email: `member-${crypto.randomUUID().slice(0, 8)}@test.com`,
      })) as Id<'users'>;

      const asUser = t.withIdentity({subject: userId});

      await expect(
        asUser.action(api.stripe.actions.createConnectedAccount, {
          organizerId,
        }),
      ).rejects.toThrow('Unauthorized');
      await expect(
        asUser.action(api.stripe.actions.createAccountSession, {
          organizerId,
          components: {accountOnboarding: true},
        }),
      ).rejects.toThrow('Unauthorized');
      await expect(
        asUser.action(api.stripe.actions.createAccountOnboardingLink, {
          organizerId,
        }),
      ).rejects.toThrow('Unauthorized');
      await expect(
        asUser.action(api.stripe.actions.checkAccountStatus, {
          organizerId,
        }),
      ).rejects.toThrow('Unauthorized');
    });

    it('rejects unauthenticated callers', async () => {
      const t = convexTest();
      const organizerId = await t.mutation(
        api.testing.communities.seedOrganizer,
        {
          name: 'Unauthenticated Organizer',
          status: 'published',
        },
      );

      await expect(
        t.action(api.stripe.actions.createConnectedAccount, {organizerId}),
      ).rejects.toThrow('Unauthenticated');
    });
  });
});
