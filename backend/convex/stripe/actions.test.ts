import {convexTest} from '../setup.testing';
import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {api, internal} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import {
  ORDER_HOLD_EXPIRATION_MS,
  STRIPE_CHECKOUT_EXPIRY_BUFFER_MS,
} from '../lib/constants';

const {
  MockStripeSignatureVerificationError,
  stripeCtorMock,
  checkoutSessionsCreateMock,
  checkoutSessionsRetrieveMock,
  v2AccountsRetrieveMock,
  balanceSettingsRetrieveMock,
  webhooksConstructEventMock,
} = vi.hoisted(() => {
  class MockStripeSignatureVerificationError extends Error {}

  return {
    MockStripeSignatureVerificationError,
    stripeCtorMock: vi.fn(),
    checkoutSessionsCreateMock: vi.fn(),
    checkoutSessionsRetrieveMock: vi.fn(),
    v2AccountsRetrieveMock: vi.fn(),
    balanceSettingsRetrieveMock: vi.fn(),
    webhooksConstructEventMock: vi.fn(),
  };
});

vi.mock('stripe', () => ({
  default: class StripeMock {
    static errors = {
      StripeSignatureVerificationError:
        MockStripeSignatureVerificationError as typeof MockStripeSignatureVerificationError,
    };

    checkout = {
      sessions: {
        create: checkoutSessionsCreateMock,
        retrieve: checkoutSessionsRetrieveMock,
      },
    };

    v2 = {
      core: {
        accounts: {
          retrieve: v2AccountsRetrieveMock,
        },
      },
    };

    balanceSettings = {
      retrieve: balanceSettingsRetrieveMock,
    };

    webhooks = {
      constructEvent: webhooksConstructEventMock,
    };

    constructor(_secretKey: string) {
      stripeCtorMock(_secretKey);
    }
  },
}));

beforeEach(() => {
  webhooksConstructEventMock.mockImplementation(() => {
    throw new MockStripeSignatureVerificationError('invalid signature');
  });
});

// =============================================================================
// processScheduledPayouts — V2 account-level batching
// =============================================================================
// Comprehensive account-level coverage lives in `stripe_connect_actions.test.ts`
// and `lib/stripe/payouts.test.ts`. These are the scenarios exercised here:
// - Platform-organizer eligible events are retired locally (no Stripe call).

describe('processScheduledPayouts', () => {
  it('retires platform-organizer past events without a Stripe call', async () => {
    const t = convexTest();
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Platform Organizer',
        isPlatformOrganizer: true,
      },
    );

    const eventIds: Id<'events'>[] = [];
    for (let day = 1; day <= 3; day += 1) {
      eventIds.push(
        await t.mutation(api.testing.events.seedEvent, {
          title: `Platform Event ${day}`,
          price: 2500,
          totalTickets: 100,
          date: new Date(Date.UTC(2020, 0, day)).toISOString(),
          status: 'published',
          visibility: 'public',
          organizerId,
        }),
      );
    }

    await t.action(internal.stripe.actions.processScheduledPayouts, {});

    for (const eventId of eventIds) {
      const event = await t.run(async (ctx) => ctx.db.get(eventId));
      expect(event?.paidOutAt).toBeTypeOf('number');
    }
  });
});

// =============================================================================
// verifyAndProcessWebhook — single-secret signature verification
// =============================================================================

describe('verifyAndProcessWebhook', () => {
  const originalSecret = process.env['STRIPE_WEBHOOK_SECRET'];
  const originalStripeKey = process.env['STRIPE_SECRET_KEY'];

  beforeEach(() => {
    process.env['STRIPE_SECRET_KEY'] = 'sk_test_fake';
    process.env['STRIPE_WEBHOOK_SECRET'] = 'whsec_platform_fake';
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env['STRIPE_WEBHOOK_SECRET'];
    } else {
      process.env['STRIPE_WEBHOOK_SECRET'] = originalSecret;
    }
    if (originalStripeKey === undefined) {
      delete process.env['STRIPE_SECRET_KEY'];
    } else {
      process.env['STRIPE_SECRET_KEY'] = originalStripeKey;
    }
  });

  it('rejects payloads when the signature does not verify', async () => {
    const t = convexTest();

    await expect(
      t.action(internal.stripe.actions.verifyAndProcessWebhook, {
        payload: '{"type":"account.updated","data":{"object":{}}}',
        signature: 't=0,v1=invalidsig',
      }),
    ).rejects.toThrow('Webhook signature verification failed');
  });
});

// =============================================================================
// startTicketOrderCheckoutSession — safe expiresAt (BRA-315)
// =============================================================================

/**
 * Helpers shared across BRA-315 tests.
 */
async function createEventForCheckout(
  t: ReturnType<typeof convexTest>,
): Promise<{eventId: Id<'events'>}> {
  const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
    name: 'Checkout Organizer',
    isPlatformOrganizer: true,
  });

  const eventId = await t.mutation(api.testing.events.seedEvent, {
    title: 'BRA-315 Test Event',
    price: 2500,
    totalTickets: 10,
    date: '2030-12-15',
    visibility: 'public',
    organizerId,
  });

  return {eventId};
}

async function createUser(
  t: ReturnType<typeof convexTest>,
  name: string,
  email: string,
): Promise<Id<'users'>> {
  return await t.mutation(api.testing.users.createUserDirectly, {
    name,
    email,
  });
}

describe('startTicketOrderCheckoutSession — safe expiresAt (BRA-315)', () => {
  const originalIsTest = process.env['IS_TEST'];

  beforeEach(() => {
    process.env['IS_TEST'] = 'true';
  });

  afterEach(() => {
    if (originalIsTest === undefined) {
      delete process.env['IS_TEST'];
    } else {
      process.env['IS_TEST'] = originalIsTest;
    }
  });

  it('returns expiresAt that satisfies the Stripe 30-minute minimum for a freshly created order', async () => {
    const t = convexTest();
    const userId = await createUser(
      t,
      'Checkout User',
      'bra315-fresh@example.com',
    );
    const {eventId} = await createEventForCheckout(t);

    const asUser = t.withIdentity({subject: userId});
    const order = await asUser.mutation(api.orders.core.open, {
      eventId,
      quantity: 1,
      tier: 'regular',
      totalAmount: 2500,
    });

    const minSafeExpiresAt =
      Date.now() + ORDER_HOLD_EXPIRATION_MS + STRIPE_CHECKOUT_EXPIRY_BUFFER_MS;

    const result = await asUser.action(api.orders.core.startCheckout, {
      orderId: order.orderId,
    });

    // Allow 5 s of test execution overhead.
    expect(result.expiresAt).toBeGreaterThanOrEqual(minSafeExpiresAt - 5_000);
  });

  it('clamps expiresAt to the safe minimum when the order was opened near the 30-minute boundary', async () => {
    const t = convexTest();
    const userId = await createUser(
      t,
      'Boundary User',
      'bra315-boundary@example.com',
    );
    const {eventId} = await createEventForCheckout(t);

    const asUser = t.withIdentity({subject: userId});
    const order = await asUser.mutation(api.orders.core.open, {
      eventId,
      quantity: 1,
      tier: 'regular',
      totalAmount: 2500,
    });

    // Simulate the order having only ~25 minutes left — below Stripe's 30-min minimum.
    const simulatedExpiresAt = Date.now() + 25 * 60 * 1000;
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Intentionally invalid state: stale expiresAt to test boundary clamping
      await ctx.db.patch('ticket_orders', order.orderId, {
        expiresAt: simulatedExpiresAt,
      });
    });

    const callTime = Date.now();
    const result = await asUser.action(api.orders.core.startCheckout, {
      orderId: order.orderId,
    });

    // The fix must override the stale order.expiresAt and return at least
    // Date.now() + ORDER_HOLD_EXPIRATION_MS + STRIPE_CHECKOUT_EXPIRY_BUFFER_MS.
    const expectedMinimum =
      callTime + ORDER_HOLD_EXPIRATION_MS + STRIPE_CHECKOUT_EXPIRY_BUFFER_MS;

    // Allow 5 s of test execution overhead.
    expect(result.expiresAt).toBeGreaterThanOrEqual(expectedMinimum - 5_000);
    // The returned value must be strictly greater than the stale order.expiresAt
    // (25 min), confirming the clamping logic fired.
    expect(result.expiresAt).toBeGreaterThan(simulatedExpiresAt);
  });
});

describe('syncTicketOrderCheckoutSession — webhook-first completion', () => {
  const originalIsTest = process.env['IS_TEST'];

  afterEach(() => {
    if (originalIsTest === undefined) {
      delete process.env['IS_TEST'];
    } else {
      process.env['IS_TEST'] = originalIsTest;
    }
    vi.clearAllMocks();
  });

  it('returns completed status without re-settling when the webhook already completed a Connect order', async () => {
    const t = convexTest();
    const userId = await createUser(
      t,
      'Webhook First Connect Buyer',
      'webhook-first-connect@example.com',
    );
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Webhook First Connect Organizer',
        isPlatformOrganizer: false,
        stripeConnectedAccountId: 'acct_webhook_first',
      },
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Webhook First Connect Event',
      price: 2500,
      totalTickets: 10,
      date: '2030-12-15',
      visibility: 'public',
      organizerId,
    });
    const asUser = t.withIdentity({subject: userId});

    const order = await asUser.mutation(api.orders.core.open, {
      eventId,
      quantity: 1,
      tier: 'regular',
      totalAmount: 2500,
    });
    await t.mutation(internal.orders.core.bindCheckoutSession, {
      orderId: order.orderId,
      stripeCheckoutSessionId: 'cs_webhook_first_connect',
    });
    await t.action(internal.orders.core.settlePaidOrderFromStripe, {
      orderId: order.orderId,
      stripePaymentIntentId: 'pi_webhook_first_connect',
      stripeChargeId: 'ch_webhook_first_connect',
      note: 'webhook_first_connect',
    });

    process.env['IS_TEST'] = 'false';
    checkoutSessionsRetrieveMock.mockRejectedValue(
      new Error('should not retrieve an already completed order'),
    );

    const status = await asUser.action(api.orders.core.syncCheckoutSession, {
      checkoutSessionId: 'cs_webhook_first_connect',
    });

    expect(status.state).toBe('completed');
    expect(status.orderId).toBe(order.orderId);
    expect(checkoutSessionsRetrieveMock).not.toHaveBeenCalled();
  });

  it('rejects completed checkout sync for a different caller before the fast path returns', async () => {
    const t = convexTest();
    const userId = await createUser(
      t,
      'Completed Checkout Owner',
      'completed-owner@example.com',
    );
    const otherUserId = await createUser(
      t,
      'Completed Checkout Stranger',
      'completed-stranger@example.com',
    );
    const {eventId} = await createEventForCheckout(t);
    const asUser = t.withIdentity({subject: userId});
    const asOtherUser = t.withIdentity({subject: otherUserId});

    const order = await asUser.mutation(api.orders.core.open, {
      eventId,
      quantity: 1,
      tier: 'regular',
      totalAmount: 2500,
    });
    await t.mutation(internal.orders.core.bindCheckoutSession, {
      orderId: order.orderId,
      stripeCheckoutSessionId: 'cs_completed_owner_only',
    });
    await t.action(internal.orders.core.settlePaidOrderFromStripe, {
      orderId: order.orderId,
      stripePaymentIntentId: 'pi_completed_owner_only',
      stripeChargeId: 'ch_completed_owner_only',
      note: 'webhook_first_owner_assertion',
    });

    process.env['IS_TEST'] = 'false';
    checkoutSessionsRetrieveMock.mockRejectedValue(
      new Error('should not retrieve an already completed order'),
    );

    await expect(
      asOtherUser.action(api.orders.core.syncCheckoutSession, {
        checkoutSessionId: 'cs_completed_owner_only',
      }),
    ).rejects.toThrow('Unauthorized');
    expect(checkoutSessionsRetrieveMock).not.toHaveBeenCalled();
  });
});

describe('startTicketOrderCheckoutSession — checkout line item pricing', () => {
  const originalIsTest = process.env['IS_TEST'];
  const originalStripeKey = process.env['STRIPE_SECRET_KEY'];

  beforeEach(() => {
    process.env['IS_TEST'] = 'false';
    process.env['STRIPE_SECRET_KEY'] = 'sk_test_fake';
    vi.clearAllMocks();
    v2AccountsRetrieveMock.mockResolvedValue({
      configuration: {
        merchant: {capabilities: {card_payments: {status: 'active'}}},
      },
      requirements: {entries: []},
    });
    balanceSettingsRetrieveMock.mockResolvedValue({
      payments: {payouts: {status: 'enabled', schedule: {interval: 'manual'}}},
    });
    checkoutSessionsCreateMock.mockResolvedValue({
      id: 'cs_test_checkout_123',
      client_secret: 'cs_secret_checkout_123',
      status: 'open',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
    webhooksConstructEventMock.mockImplementation(() => {
      throw new MockStripeSignatureVerificationError('invalid signature');
    });
  });

  afterEach(() => {
    if (originalStripeKey === undefined) {
      delete process.env['STRIPE_SECRET_KEY'];
    } else {
      process.env['STRIPE_SECRET_KEY'] = originalStripeKey;
    }

    if (originalIsTest === undefined) {
      delete process.env['IS_TEST'];
    } else {
      process.env['IS_TEST'] = originalIsTest;
    }
  });

  it('itemizes checkout line item quantity while preserving the canonical order total', async () => {
    const t = convexTest();
    const userId = await createUser(
      t,
      'Ticket Buyer',
      'checkout-lineitem@example.com',
    );
    const {eventId} = await createEventForCheckout(t);
    const asUser = t.withIdentity({subject: userId});

    const order = await asUser.mutation(api.orders.core.open, {
      eventId,
      quantity: 2,
      tier: 'regular',
      totalAmount: 5000,
    });

    await asUser.action(api.orders.core.startCheckout, {
      orderId: order.orderId,
    });

    expect(checkoutSessionsCreateMock).toHaveBeenCalledTimes(1);
    const [params] = checkoutSessionsCreateMock.mock.calls[0] ?? [];
    expect(params?.line_items?.[0]?.quantity).toBe(2);
    expect(params?.line_items?.[0]?.price_data?.unit_amount).toBe(2500);
    expect(params?.line_items?.[0]?.price_data?.product_data?.description).toBe(
      'regular ticket',
    );
  });

  it('rejects stale direct-charge orders after an organizer becomes platform-backed', async () => {
    const t = convexTest();
    const userId = await createUser(
      t,
      'Stale Account Buyer',
      'stale-account-buyer@example.com',
    );
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Organizer Route Changed',
        isPlatformOrganizer: false,
        stripeConnectedAccountId: 'acct_ROUTE_CHANGED',
      },
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Route Changed Event',
      price: 2500,
      totalTickets: 10,
      date: '2030-12-15',
      visibility: 'public',
      organizerId,
    });
    const asUser = t.withIdentity({subject: userId});

    const order = await asUser.mutation(api.orders.core.open, {
      eventId,
      quantity: 1,
      tier: 'regular',
      totalAmount: 2500,
    });

    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Simulates a root-admin payment-route toggle between order open and checkout session creation.
      await ctx.db.patch('organizers', organizerId, {
        isPlatformOrganizer: true,
      });
    });

    await expect(
      asUser.action(api.orders.core.startCheckout, {
        orderId: order.orderId,
      }),
    ).rejects.toThrow('Please restart checkout');
    expect(checkoutSessionsCreateMock).not.toHaveBeenCalled();
  });

  it('refreshes direct-charge readiness and releases stale holds before creating Checkout', async () => {
    const t = convexTest();
    const userId = await createUser(
      t,
      'Disabled Charges Buyer',
      'disabled-charges-buyer@example.com',
    );
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Disabled Charges Organizer',
        isPlatformOrganizer: false,
        stripeConnectedAccountId: 'acct_DISABLED_CHARGES',
        stripeOnboardingStatus: 'complete',
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
      },
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Disabled Charges Event',
      price: 2500,
      totalTickets: 10,
      date: '2030-12-15',
      visibility: 'public',
      organizerId,
    });
    const asUser = t.withIdentity({subject: userId});

    const order = await asUser.mutation(api.orders.core.open, {
      eventId,
      quantity: 1,
      tier: 'regular',
      totalAmount: 2500,
    });

    v2AccountsRetrieveMock.mockResolvedValueOnce({
      configuration: {
        merchant: {capabilities: {card_payments: {status: 'inactive'}}},
      },
      requirements: {entries: []},
    });
    balanceSettingsRetrieveMock.mockResolvedValueOnce({
      payments: {
        payouts: {status: 'disabled', schedule: {interval: 'manual'}},
      },
    });

    await expect(
      asUser.action(api.orders.core.startCheckout, {
        orderId: order.orderId,
      }),
    ).rejects.toThrow('not enabled for charges');

    expect(checkoutSessionsCreateMock).not.toHaveBeenCalled();

    await t.run(async (ctx) => {
      const releasedOrder = await ctx.db.get(order.orderId);
      expect(releasedOrder?.state).toBe('released');
      expect(releasedOrder?.releaseReason).toBe('payment_failed');

      const organizer = await ctx.db.get(organizerId);
      expect(organizer?.stripeChargesEnabled).toBe(false);
      expect(organizer?.stripeOnboardingStatus).toBe('in_progress');
    });
  });
});
