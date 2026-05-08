import {v} from 'convex/values';
import {communityPublicationStatusValidator} from '../../lib/validators/communities';
import {onboardingStatusValidator} from '../../lib/validators/stripe_connect';

export const VETTING_QUESTION_TYPES = [
  'text',
  'long_text',
  'boolean',
  'select',
  'checkbox',
] as const;
export type VettingQuestionType = (typeof VETTING_QUESTION_TYPES)[number];

export const vettingQuestionTypeValidator = v.union(
  v.literal(VETTING_QUESTION_TYPES[0]),
  v.literal(VETTING_QUESTION_TYPES[1]),
  v.literal(VETTING_QUESTION_TYPES[2]),
  v.literal(VETTING_QUESTION_TYPES[3]),
  v.literal(VETTING_QUESTION_TYPES[4]),
);

export const vettingQuestionFields = {
  id: v.string(),
  question: v.string(),
  type: vettingQuestionTypeValidator,
  required: v.boolean(),
  options: v.optional(v.array(v.string())),
};

export const vettingQuestionValidator = v.object(vettingQuestionFields);

export const communityViewerFields = {
  name: v.string(),
  email: v.optional(v.string()),
  contactInfo: v.optional(v.string()),
  vettingQuestions: v.optional(v.array(vettingQuestionValidator)),
  isPlatformOrganizer: v.optional(v.boolean()),
  description: v.optional(v.string()),
  website: v.optional(v.string()),
  logoStorageId: v.optional(v.union(v.id('_storage'), v.null())),
  isPublicDirectory: v.boolean(),
  slug: v.optional(v.string()),
  status: communityPublicationStatusValidator,
  codeOfConduct: v.optional(v.string()),
};

export const communityAdminStripeFields = {
  stripeConnectedAccountId: v.optional(v.string()),
  /** V2 onboarding lifecycle. Source of truth for new code. */
  stripeOnboardingStatus: v.optional(onboardingStatusValidator),
  /** Cached Stripe V2 capability state for checkout gating. */
  stripeChargesEnabled: v.optional(v.boolean()),
  /** Cached Stripe V2 capability state for payout gating. */
  stripePayoutsEnabled: v.optional(v.boolean()),
  /**
   * `requirements.entries[].description` values from Stripe where
   * `awaiting_action_from === 'user'`, cached from the most recent status
   * refresh so promoter dashboards can render them without a round trip.
   */
  stripeCurrentlyDue: v.optional(v.array(v.string())),
};

export const communityViewerDocValidator = v.object({
  _id: v.id('organizers'),
  _creationTime: v.number(),
  ...communityViewerFields,
  logoUrl: v.optional(v.string()),
});

/**
 * Raw `organizers` table doc — matches the on-disk shape returned by
 * `ctx.db.get('organizers', id)` (no derived `logoUrl`/payment-readiness flags).
 */
export const organizerDocFields = {
  _id: v.id('organizers'),
  _creationTime: v.number(),
  ...communityViewerFields,
  ...communityAdminStripeFields,
};

export const organizerDocValidator = v.object(organizerDocFields);

export const communityAdminDocValidator = v.object({
  _id: v.id('organizers'),
  _creationTime: v.number(),
  ...communityViewerFields,
  ...communityAdminStripeFields,
  logoUrl: v.optional(v.string()),
  organizerPaymentReady: v.optional(v.boolean()),
  organizerPayoutReady: v.optional(v.boolean()),
});
