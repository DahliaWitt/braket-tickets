import { api } from '@convex/_generated/api';
import type { ConvexHelper } from '../helpers/test-setup';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function makeNonce(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

/**
 * Creates a Stripe-ready organizer for E2E purchase tests.
 *
 * Organizer readiness is modeled the same way production does:
 * connected account ID + charge-ready status.
 */
export async function seedStripeReadyOrganizer(
  convexHelper: ConvexHelper,
  label: string,
): Promise<string> {
  const nonce = makeNonce();
  const slugBase = slugify(label) || 'e2e-org';
  const organizerSlug = `${slugBase}-${nonce}`;
  const organizerName = `${label} ${nonce}`;

  return convexHelper.mutation(api.testing.communities.seedOrganizer, {
    name: organizerName,
    slug: organizerSlug,
    email: `${organizerSlug}@example.test`,
    stripeConnectedAccountId: `acct_e2e_${nonce.replace('-', '')}`,
    stripeOnboardingStatus: 'complete',
    stripeChargesEnabled: true,
    stripePayoutsEnabled: true,
    isPlatformOrganizer: false,
  });
}
