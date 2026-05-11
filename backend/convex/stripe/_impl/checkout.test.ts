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
    expect(params?.metadata?.['checkoutBrandingVersion']).toBe(
      `${CHECKOUT_BRANDING_VERSION}:light`,
    );
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
    expect(params?.payment_intent_data?.metadata).toMatchObject({
      checkoutBrandingVersion: `${CHECKOUT_BRANDING_VERSION}:dark`,
    });
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
