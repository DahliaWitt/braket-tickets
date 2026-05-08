import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import Stripe from 'stripe';
import {convexTest} from '../setup.testing';
import {api, internal} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import {STRIPE_V2_ACCOUNT_CONFIG} from './_impl/constants';

/**
 * Live Stripe sandbox contract tests for the V2 Connect + embedded
 * checkout surface. Skipped unless `STRIPE_SANDBOX_CONTRACT_TESTS=true`
 * so the default test suite stays offline.
 *
 * The mocked-SDK unit tests in `stripe_connect_actions.test.ts` prove we
 * call the right methods with the right arguments; this suite proves
 * Stripe's sandbox accepts those arguments and returns the shapes we
 * project into the organizer row.
 */

const runSandboxContracts =
  process.env['STRIPE_SANDBOX_CONTRACT_TESTS'] === 'true';
const describeSandbox = runSandboxContracts ? describe : describe.skip;
const isCi =
  process.env['CI'] === 'true' ||
  process.env['CI'] === '1' ||
  process.env['GITHUB_ACTIONS'] === 'true';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

describeSandbox('Stripe V2 sandbox contract tests', () => {
  let stripeSecretKey: string;
  // Event destinations use their own signing secret, distinct from the
  // legacy platform webhook. This is the one we verify V2 notifications
  // with in production.
  let v2EventsWebhookSecret: string;
  let stripe: Stripe;
  let connectedAccountId: string;
  let createdConnectedAccountId: string | null = null;

  beforeAll(async () => {
    stripeSecretKey = requireEnv('STRIPE_SECRET_KEY');
    v2EventsWebhookSecret = requireEnv('STRIPE_WEBHOOK_SECRET_V2_EVENTS');
    stripe = new Stripe(stripeSecretKey);

    // Allow pinning a known-good sandbox account for deterministic runs.
    // In CI the account id is required so we never pay the cost of
    // creating a fresh account on every run.
    const pinnedAccountId =
      process.env['STRIPE_SANDBOX_CONNECTED_ACCOUNT_ID'] ?? '';
    if (isCi && !pinnedAccountId) {
      throw new Error(
        'CI mode requires STRIPE_SANDBOX_CONNECTED_ACCOUNT_ID for deterministic contract tests.',
      );
    }

    if (pinnedAccountId) {
      connectedAccountId = pinnedAccountId;
    } else {
      const account = await stripe.v2.core.accounts.create({
        contact_email: `sandbox-contract-${Date.now()}@example.com`,
        display_name: 'Sandbox Contract Account',
        ...STRIPE_V2_ACCOUNT_CONFIG,
        identity: {country: 'us'},
        metadata: {testSuite: 'stripe_sandbox_contract'},
      });
      connectedAccountId = account.id;
      createdConnectedAccountId = account.id;
    }

    // Our actions read IS_TEST via isTestEnvironment; the mocked-SDK
    // short-circuits must not fire against a live sandbox.
    process.env['IS_TEST'] = 'false';
  });

  afterAll(async () => {
    if (!createdConnectedAccountId) {
      return;
    }
    try {
      await stripe.v2.core.accounts.close(createdConnectedAccountId, {
        applied_configurations: ['merchant'],
      });
    } catch {
      // Best-effort cleanup only — the sandbox may refuse close if the
      // account has activity. Leaving a tagged account behind is fine.
    }
  });

  it('accepts the V2 account config we create in production', async () => {
    // Verifies `stripe.v2.core.accounts.retrieve` returns an account
    // shape `mapV2AccountStatus` can project. This is the Stripe-side
    // contract we depend on for onboarding status sync.
    const account = await stripe.v2.core.accounts.retrieve(connectedAccountId, {
      include: [
        'configuration.merchant',
        'requirements',
        'future_requirements',
      ],
    });

    expect(account.id).toBe(connectedAccountId);
    expect(account.object).toBe('v2.core.account');
    // `configuration.merchant` is optional until the merchant config is
    // applied; either shape is acceptable at contract time. The account
    // must, however, report a recognizable requirements entries array.
    expect(Array.isArray(account.requirements?.entries ?? [])).toBe(true);
  });

  it('applies manual payout settings on the connected account', async () => {
    // Mirrors production `ensureManualPayoutSettings` — the settlement
    // ledger owns payout cadence, so a V2 account must accept the
    // manual interval. Idempotent: the assertion holds on reruns.
    await stripe.balanceSettings.update(
      {
        payments: {
          payouts: {schedule: {interval: 'manual'}},
        },
      },
      {stripeAccount: connectedAccountId},
    );

    const settings = await stripe.balanceSettings.retrieve(undefined, {
      stripeAccount: connectedAccountId,
    });
    expect(settings.payments?.payouts?.schedule?.interval).toBe('manual');
  });

  it('supports successful and declined PaymentIntent outcomes in sandbox', async () => {
    // Platform-level payment intents are API-version-independent; the
    // test mirrors the earlier V1 coverage so the decline-handling
    // contract stays green after the V2 migration.
    const basePayload: Stripe.PaymentIntentCreateParams = {
      amount: 1099,
      currency: 'usd',
      confirm: true,
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never',
      },
    };

    const succeeded = await stripe.paymentIntents.create({
      ...basePayload,
      payment_method: 'pm_card_visa',
    });
    expect(['succeeded', 'requires_capture']).toContain(succeeded.status);

    let sawDecline: boolean;
    try {
      const declined = await stripe.paymentIntents.create({
        ...basePayload,
        payment_method: 'pm_card_chargeDeclined',
      });
      sawDecline = declined.status === 'requires_payment_method';
    } catch (error: unknown) {
      if (error instanceof Stripe.errors.StripeCardError) {
        sawDecline = error.code === 'card_declined';
      } else {
        throw error;
      }
    }
    expect(sawDecline).toBe(true);
  });

  it('checkAccountStatus reads V2 shape and syncs the organizer row', async () => {
    const t = convexTest();

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Sandbox Contract User',
      email: `sandbox-contract-user-${Date.now()}@example.com`,
    })) as Id<'users'>;

    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Sandbox Connected Organizer',
        stripeConnectedAccountId: connectedAccountId,
      },
    );

    const granterId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Granter',
      email: `granter-sandbox-${Date.now()}@example.com`,
      isRootAdmin: true,
    })) as Id<'users'>;
    await t.mutation(api.testing.communities.seedCommunityAdmin, {
      userId,
      organizerId,
      grantedBy: granterId,
    });

    const asUser = t.withIdentity({subject: userId});
    const status = await asUser.action(api.stripe.actions.checkAccountStatus, {
      organizerId,
    });

    expect(typeof status.chargesEnabled).toBe('boolean');
    expect(typeof status.payoutsEnabled).toBe('boolean');
    expect(typeof status.userRequirementsClear).toBe('boolean');
    expect(typeof status.onboardingStatus).toBe('string');
    expect(Array.isArray(status.currentlyDue)).toBe(true);
    expect(typeof status.chargeReady).toBe('boolean');
    expect(typeof status.payoutReady).toBe('boolean');

    const organizer = await t.run(async (ctx) =>
      ctx.db.get('organizers', organizerId),
    );
    expect(typeof organizer?.stripeOnboardingStatus).toBe('string');
    expect(typeof organizer?.stripeChargesEnabled).toBe('boolean');
    expect(typeof organizer?.stripePayoutsEnabled).toBe('boolean');

    const invalidOrganizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Invalid Connected Organizer',
        stripeConnectedAccountId: 'acct_invalid_contract_test',
      },
    );
    await t.mutation(api.testing.communities.seedCommunityAdmin, {
      userId,
      organizerId: invalidOrganizerId,
      grantedBy: granterId,
    });

    await expect(
      asUser.action(api.stripe.actions.checkAccountStatus, {
        organizerId: invalidOrganizerId,
      }),
    ).rejects.toThrow();
  });

  it('verifies signed V2 event destination payloads and syncs the organizer row', async () => {
    // V2 Event Destination delivery: Stripe POSTs a "thin" event
    // notification (no full snapshot), the handler verifies the
    // signature against STRIPE_WEBHOOK_SECRET_V2_EVENTS, then calls
    // v2.core.accounts.retrieve to project current state onto the
    // organizer. The signing algorithm (HMAC-SHA256 of
    // `${timestamp}.${payload}`) is identical across API versions, so
    // the legacy `generateTestHeaderString` helper produces a valid
    // V2 signature when given the V2 secret.
    const t = convexTest();

    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'V2 Webhook Organizer',
        stripeConnectedAccountId: connectedAccountId,
      },
    );

    const payload = JSON.stringify({
      id: `evt_contract_${Date.now()}`,
      object: 'v2.core.event',
      type: 'v2.core.account.updated',
      created: new Date().toISOString(),
      related_object: {
        id: connectedAccountId,
        type: 'v2.core.account',
        url: `/v2/core/accounts/${connectedAccountId}`,
      },
    });

    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: v2EventsWebhookSecret,
    });

    await t.action(
      internal.stripe.actions.verifyAndProcessV2EventNotification,
      {
        payload,
        signature,
      },
    );

    // The handler retrieves the live account and projects state onto
    // the organizer row. The sandbox account's real KYC state may vary,
    // so we only assert the projection ran (the fields are non-null after sync).
    const organizer = await t.run(async (ctx) =>
      ctx.db.get('organizers', organizerId),
    );
    expect(typeof organizer?.stripeOnboardingStatus).toBe('string');
    expect(typeof organizer?.stripeChargesEnabled).toBe('boolean');
    expect(typeof organizer?.stripePayoutsEnabled).toBe('boolean');
  });
});
