import {beforeEach, describe, expect, it, vi} from 'vitest';
import type Stripe from 'stripe';
import {
  CHECKOUT_BRANDING_SETTINGS,
  CHECKOUT_BRANDING_VERSION,
  createDirectChargeCheckoutSession,
  createPlatformCheckoutSession,
  hasCurrentCheckoutBranding,
  resolveCheckoutBranding,
} from './checkout';

const checkoutSessionsCreateMock = vi.hoisted(() => vi.fn());
type CheckoutSessionBrandingSettings = NonNullable<
  Stripe.Checkout.Session['branding_settings']
>;

vi.mock('../../lib/stripe_node', () => ({
  getStripeClient: () => ({
    checkout: {
      sessions: {
        create: checkoutSessionsCreateMock,
      },
    },
  }),
}));

const baseMetadata = {
  orderId: 'order_test_123',
  kind: 'primary',
  eventId: 'event_test_123',
};

function mockCheckoutSession(): Stripe.Checkout.Session {
  return {
    id: 'cs_test_branded',
    object: 'checkout.session',
    client_secret: 'cs_secret_branded',
    expires_at: 1893456000,
  } as Stripe.Checkout.Session;
}

describe('Stripe Checkout session branding', () => {
  beforeEach(() => {
    checkoutSessionsCreateMock.mockReset();
    checkoutSessionsCreateMock.mockResolvedValue(mockCheckoutSession());
  });

  it('applies light embedded Checkout branding to platform sessions', async () => {
    await createPlatformCheckoutSession({
      orderId: baseMetadata.orderId,
      amountCents: 2500,
      quantity: 1,
      checkoutTheme: 'light',
      eventName: 'Concrete & Wax',
      ticketDescription: 'regular ticket',
      expiresAtMs: 1893456000000,
      metadata: baseMetadata,
    });

    const [params] = checkoutSessionsCreateMock.mock.calls[0] ?? [];
    expect(params?.branding_settings).toEqual(CHECKOUT_BRANDING_SETTINGS.light);
    expect(params?.payment_intent_data?.capture_method).toBe('automatic');
    expect(params?.metadata?.['checkoutBrandingVersion']).toBe(
      `${CHECKOUT_BRANDING_VERSION}:light`,
    );
  });

  it('falls back to order-total itemization when amount does not divide by quantity', async () => {
    await createPlatformCheckoutSession({
      orderId: baseMetadata.orderId,
      amountCents: 2501,
      quantity: 2,
      checkoutTheme: 'light',
      eventName: 'Concrete & Wax',
      ticketDescription: 'regular ticket',
      expiresAtMs: 1893456000000,
      metadata: baseMetadata,
    });

    const [params] = checkoutSessionsCreateMock.mock.calls[0] ?? [];
    expect(params?.line_items?.[0]?.quantity).toBe(1);
    expect(params?.line_items?.[0]?.price_data?.unit_amount).toBe(2501);
  });

  it('rejects non-integer checkout line item quantities', async () => {
    await expect(
      createPlatformCheckoutSession({
        orderId: baseMetadata.orderId,
        amountCents: 2500,
        quantity: 1.5,
        checkoutTheme: 'light',
        eventName: 'Concrete & Wax',
        ticketDescription: 'regular ticket',
        expiresAtMs: 1893456000000,
        metadata: baseMetadata,
      }),
    ).rejects.toThrow('Checkout line item quantity must be a positive integer');
    expect(checkoutSessionsCreateMock).not.toHaveBeenCalled();
  });

  it('rejects non-positive checkout line item quantities', async () => {
    await expect(
      createPlatformCheckoutSession({
        orderId: baseMetadata.orderId,
        amountCents: 2500,
        quantity: 0,
        checkoutTheme: 'light',
        eventName: 'Concrete & Wax',
        ticketDescription: 'regular ticket',
        expiresAtMs: 1893456000000,
        metadata: baseMetadata,
      }),
    ).rejects.toThrow('Checkout line item quantity must be a positive integer');
    expect(checkoutSessionsCreateMock).not.toHaveBeenCalled();
  });

  it('applies dark embedded Checkout branding to direct-charge sessions', async () => {
    await createDirectChargeCheckoutSession({
      connectedAccountId: 'acct_direct_branding',
      orderId: baseMetadata.orderId,
      amountCents: 2500,
      quantity: 1,
      checkoutTheme: 'dark',
      eventName: 'Concrete & Wax',
      ticketDescription: 'regular ticket',
      expiresAtMs: 1893456000000,
      metadata: baseMetadata,
    });

    const [params] = checkoutSessionsCreateMock.mock.calls[0] ?? [];
    expect(params?.branding_settings).toEqual(CHECKOUT_BRANDING_SETTINGS.dark);
    expect(params?.metadata?.['checkoutBrandingVersion']).toBe(
      `${CHECKOUT_BRANDING_VERSION}:dark`,
    );
    expect(params?.payment_intent_data?.capture_method).toBe('automatic');
    expect(params?.payment_intent_data?.metadata).toMatchObject({
      checkoutBrandingVersion: `${CHECKOUT_BRANDING_VERSION}:dark`,
    });
  });

  it('reuses one idempotency key across byte-identical retries so a lost response never double-creates', async () => {
    const args = {
      connectedAccountId: 'acct_direct_idem',
      orderId: baseMetadata.orderId,
      amountCents: 2500,
      quantity: 1,
      checkoutTheme: 'light' as const,
      eventName: 'Concrete & Wax',
      ticketDescription: 'regular ticket',
      expiresAtMs: 1893456000000,
      metadata: baseMetadata,
    };

    await createDirectChargeCheckoutSession(args);
    await createDirectChargeCheckoutSession(args);

    const firstKey =
      checkoutSessionsCreateMock.mock.calls[0]?.[1]?.idempotencyKey;
    const secondKey =
      checkoutSessionsCreateMock.mock.calls[1]?.[1]?.idempotencyKey;
    expect(firstKey).toMatch(/^braket-checkout-order_test_123-[0-9a-f]{32}$/);
    expect(secondKey).toBe(firstKey);
  });

  it('mints a distinct idempotency key when the checkout theme flips mid-order', async () => {
    // Regression: a re-created session for the same open order changes
    // branding_settings + metadata; a fixed `braket-checkout-${orderId}` key
    // would replay with different params and Stripe returns idempotency_error,
    // wedging the restart.
    const base = {
      connectedAccountId: 'acct_direct_idem',
      orderId: baseMetadata.orderId,
      amountCents: 2500,
      quantity: 1,
      eventName: 'Concrete & Wax',
      ticketDescription: 'regular ticket',
      expiresAtMs: 1893456000000,
      metadata: baseMetadata,
    };

    await createDirectChargeCheckoutSession({...base, checkoutTheme: 'light'});
    await createDirectChargeCheckoutSession({...base, checkoutTheme: 'dark'});

    const lightKey =
      checkoutSessionsCreateMock.mock.calls[0]?.[1]?.idempotencyKey;
    const darkKey =
      checkoutSessionsCreateMock.mock.calls[1]?.[1]?.idempotencyKey;
    expect(lightKey).toBeDefined();
    expect(darkKey).toBeDefined();
    expect(darkKey).not.toBe(lightKey);
  });

  it('mints a distinct idempotency key when the hold is extended (expires_at advances)', async () => {
    // Regression: the secondary wedge — reverting to the original theme still
    // fails under a fixed key because safeExpiresAtMs advances with the wall
    // clock, so expires_at (second granularity) differs across re-creates.
    const base = {
      connectedAccountId: 'acct_direct_idem',
      orderId: baseMetadata.orderId,
      amountCents: 2500,
      quantity: 1,
      checkoutTheme: 'light' as const,
      eventName: 'Concrete & Wax',
      ticketDescription: 'regular ticket',
      metadata: baseMetadata,
    };

    await createDirectChargeCheckoutSession({
      ...base,
      expiresAtMs: 1893456000000,
    });
    await createDirectChargeCheckoutSession({
      ...base,
      expiresAtMs: 1893456060000,
    });

    const firstKey =
      checkoutSessionsCreateMock.mock.calls[0]?.[1]?.idempotencyKey;
    const secondKey =
      checkoutSessionsCreateMock.mock.calls[1]?.[1]?.idempotencyKey;
    expect(secondKey).not.toBe(firstKey);
  });

  it('separates platform and direct-charge sessions by connected-account routing', async () => {
    const shared = {
      orderId: baseMetadata.orderId,
      amountCents: 2500,
      quantity: 1,
      checkoutTheme: 'light' as const,
      eventName: 'Concrete & Wax',
      ticketDescription: 'regular ticket',
      expiresAtMs: 1893456000000,
      metadata: baseMetadata,
    };

    await createPlatformCheckoutSession(shared);
    await createDirectChargeCheckoutSession({
      ...shared,
      connectedAccountId: 'acct_direct_idem',
    });

    const platformKey =
      checkoutSessionsCreateMock.mock.calls[0]?.[1]?.idempotencyKey;
    const directKey =
      checkoutSessionsCreateMock.mock.calls[1]?.[1]?.idempotencyKey;
    // Both are for order_test_123 but route to different Stripe accounts;
    // folding stripeAccount into the fingerprint keeps them distinct.
    expect(platformKey).not.toBe(directKey);
  });

  it('recognizes only sessions with the current requested branding theme', () => {
    const darkBranding = resolveCheckoutBranding('dark');

    expect(
      hasCurrentCheckoutBranding(
        {
          metadata: {checkoutBrandingVersion: darkBranding.brandingVersion},
          branding_settings: {
            background_color: darkBranding.brandingSettings.background_color,
            button_color: darkBranding.brandingSettings.button_color,
            border_style: darkBranding.brandingSettings.border_style,
            font_family: darkBranding.brandingSettings.font_family,
          } as CheckoutSessionBrandingSettings,
        },
        'dark',
      ),
    ).toBe(true);

    expect(
      hasCurrentCheckoutBranding(
        {
          metadata: {},
          branding_settings: {
            background_color: '#ffffff',
            button_color: '#00d66f',
            border_style: 'rounded',
            font_family: 'default',
          } as CheckoutSessionBrandingSettings,
        },
        'dark',
      ),
    ).toBe(false);

    expect(
      hasCurrentCheckoutBranding(
        {
          metadata: {
            checkoutBrandingVersion: `${CHECKOUT_BRANDING_VERSION}:light`,
          },
          branding_settings:
            CHECKOUT_BRANDING_SETTINGS.light as CheckoutSessionBrandingSettings,
        },
        'dark',
      ),
    ).toBe(false);
  });
});
