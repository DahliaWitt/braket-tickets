import type {Doc} from '../_generated/dataModel';
import type {OnboardingStatus} from './validators/stripe_connect';
import type {PaymentErrorCode} from '@shared/contracts/payment-error-codes';

export type OrganizerStripeConnectState = Pick<
  Doc<'organizers'>,
  | 'isPlatformOrganizer'
  | 'stripeConnectedAccountId'
  | 'stripeOnboardingStatus'
  | 'stripeChargesEnabled'
  | 'stripePayoutsEnabled'
>;

export type OrganizerChargeReadiness =
  | {ok: true}
  | {
      ok: false;
      code: Extract<
        PaymentErrorCode,
        | 'ORGANIZER_STRIPE_NOT_CONNECTED'
        | 'ORGANIZER_STRIPE_CHARGES_DISABLED'
        | 'ORGANIZER_STRIPE_ONBOARDING_INCOMPLETE'
      >;
    };

function hasConnectedAccount(
  organizer: OrganizerStripeConnectState | null | undefined,
): organizer is OrganizerStripeConnectState & {
  stripeConnectedAccountId: string;
} {
  return Boolean(organizer?.stripeConnectedAccountId);
}

function hasOnboardingStatus(
  organizer: OrganizerStripeConnectState | null | undefined,
): organizer is OrganizerStripeConnectState & {
  stripeOnboardingStatus: OnboardingStatus;
} {
  return organizer?.stripeOnboardingStatus !== undefined;
}

export function getOrganizerChargeReadiness(
  organizer: OrganizerStripeConnectState | null | undefined,
): OrganizerChargeReadiness {
  if (organizer?.isPlatformOrganizer === true) return {ok: true};
  if (!hasConnectedAccount(organizer)) {
    return {ok: false, code: 'ORGANIZER_STRIPE_NOT_CONNECTED'};
  }
  if (organizer.stripeChargesEnabled !== true) {
    return {ok: false, code: 'ORGANIZER_STRIPE_CHARGES_DISABLED'};
  }
  // Onboarding status is the single durable gate. In particular, we rely on
  // `payout_settings_pending` being projected when the payout schedule is not
  // `manual` so that sales cannot proceed before our reserve-ledger invariant
  // holds.
  if (!hasOnboardingStatus(organizer)) {
    return {ok: false, code: 'ORGANIZER_STRIPE_ONBOARDING_INCOMPLETE'};
  }
  if (
    organizer.stripeOnboardingStatus === 'complete' ||
    organizer.stripeOnboardingStatus === 'restricted'
  ) {
    return {ok: true};
  }
  return {ok: false, code: 'ORGANIZER_STRIPE_ONBOARDING_INCOMPLETE'};
}

export function isOrganizerChargeReady(
  organizer: OrganizerStripeConnectState | null | undefined,
): boolean {
  return getOrganizerChargeReadiness(organizer).ok;
}

export function isOrganizerPayoutReady(
  organizer: OrganizerStripeConnectState | null | undefined,
): boolean {
  if (organizer?.isPlatformOrganizer === true) return true;
  if (!hasConnectedAccount(organizer)) return false;
  if (!hasOnboardingStatus(organizer)) return false;
  if (organizer.stripePayoutsEnabled !== true) return false;
  return organizer.stripeOnboardingStatus === 'complete';
}
