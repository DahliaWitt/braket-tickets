import {v} from 'convex/values';
import type {Doc, Id} from '../_generated/dataModel';
import type {MutationCtx} from '../_generated/server';
import {addMember, addTrustLink, authz, organizerScope} from '../lib/authz';
import {ensureApprovedMarketingPreference} from '../lib/marketing_emails/preferences';
import {
  refreshOrganizerDirectoryForMembershipChange,
  refreshOrganizerDirectoryForTrustedMembers,
} from '../lib/users/organizer_directory';
import {
  prepareCommunityCreateData,
  resolveCommunitySlugForCreate,
  validatePublishedCommunityRequirements,
} from '../lib/communities/writes';
import {vettingQuestionValidator} from '../lib/communities/validators';
import {communityPublicationStatusValidator} from '../lib/validators/communities';
import {
  onboardingStatusValidator,
  type OnboardingStatus,
} from '../lib/validators/stripe_connect';
import type {CommunityPublicationStatus} from '@shared/domain/community-publication-status';
import {testingMutation} from './wrappers';

interface InsertSeedOrganizerArgs {
  name: string;
  slug?: string;
  email?: string;
  contactInfo?: string;
  description?: string;
  website?: string;
  codeOfConduct?: string;
  logoStorageId?: Id<'_storage'> | null;
  isPlatformOrganizer?: boolean;
  stripeConnectedAccountId?: string;
  /**
   * V2 onboarding status. When not provided but `stripeConnectedAccountId`
   * is set, defaults to `'complete'` so existing seeds that only set the
   * legacy account id still produce a usable organizer.
   */
  stripeOnboardingStatus?: OnboardingStatus;
  stripeChargesEnabled?: boolean;
  stripePayoutsEnabled?: boolean;
  stripeCurrentlyDue?: string[];
  isPublicDirectory?: boolean;
  status?: CommunityPublicationStatus;
  vettingQuestions?: Doc<'organizers'>['vettingQuestions'];
}

/* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- Calls prepareCommunityCreateData for
 * validation SSOT but inserts directly to avoid a convex-test@0.0.36 module-resolution
 * bug with nested ctx.runMutation after component interactions. The insert mirrors the
 * public community create validation/defaults, minus the publish-transition payment gate
 * that seed/test callers intentionally bypass. */
export async function insertSeedOrganizer(
  ctx: MutationCtx,
  args: InsertSeedOrganizerArgs,
): Promise<Id<'organizers'>> {
  const status = args.status ?? 'published';
  // Auto-provide a default vetting question for published organizers that don't
  // specify one, so existing tests work without change.
  const vettingQuestions =
    args.vettingQuestions ??
    (status === 'published'
      ? [
          {
            id: 'seed-default',
            question: 'Default seed question',
            type: 'text' as const,
            required: true,
          },
        ]
      : undefined);

  // Same validation + slug generation as the public create flow — field length,
  // published requirements — without the publish-transition payment gate.
  const createData = await prepareCommunityCreateData(ctx.db, {
    ...args,
    vettingQuestions,
    status: 'draft', // skip publish-transition payment check
  });
  validatePublishedCommunityRequirements(status, vettingQuestions);

  // When a seed caller supplies a connected account without explicit V2
  // fields, default to a fully-onboarded Stripe state so existing tests keep
  // producing sellable organizers. Callers that need partial onboarding pass
  // the fields explicitly.
  const hasConnectedAccount = args.stripeConnectedAccountId !== undefined;
  const defaultedOnboardingStatus: OnboardingStatus | undefined =
    args.stripeOnboardingStatus ??
    (hasConnectedAccount ? 'complete' : undefined);
  const defaultedChargesEnabled =
    args.stripeChargesEnabled ?? (hasConnectedAccount ? true : undefined);
  const defaultedPayoutsEnabled =
    args.stripePayoutsEnabled ?? (hasConnectedAccount ? true : undefined);

  const organizerDoc = {
    ...createData,
    status,
    isPublicDirectory: args.isPublicDirectory ?? true,
    ...(args.website !== undefined ? {website: args.website} : {}),
    ...(args.logoStorageId !== undefined
      ? {logoStorageId: args.logoStorageId}
      : {}),
    ...(args.isPlatformOrganizer !== undefined
      ? {isPlatformOrganizer: args.isPlatformOrganizer}
      : {}),
    ...(hasConnectedAccount
      ? {stripeConnectedAccountId: args.stripeConnectedAccountId}
      : {}),
    ...(defaultedOnboardingStatus !== undefined
      ? {stripeOnboardingStatus: defaultedOnboardingStatus}
      : {}),
    ...(defaultedChargesEnabled !== undefined
      ? {stripeChargesEnabled: defaultedChargesEnabled}
      : {}),
    ...(defaultedPayoutsEnabled !== undefined
      ? {stripePayoutsEnabled: defaultedPayoutsEnabled}
      : {}),
    ...(args.stripeCurrentlyDue !== undefined
      ? {stripeCurrentlyDue: args.stripeCurrentlyDue}
      : {}),
  };

  return await ctx.db.insert('organizers', organizerDoc);
}
/* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

export async function addSeedMembership(
  ctx: MutationCtx,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
): Promise<void> {
  await addMember(ctx, userId, organizerId);
  await ensureApprovedMarketingPreference(ctx.db, {userId, organizerId});
  await refreshOrganizerDirectoryForMembershipChange(ctx, {
    organizerId,
    userId,
  });
}

export async function addSeedTrustLink(
  ctx: MutationCtx,
  trustingOrganizerId: Id<'organizers'>,
  trustedOrganizerId: Id<'organizers'>,
): Promise<void> {
  await addTrustLink(ctx, trustingOrganizerId, trustedOrganizerId);
  await refreshOrganizerDirectoryForTrustedMembers(ctx, {
    organizerId: trustingOrganizerId,
    trustedOrganizerId,
  });
}

/**
 * Seeds a community directly into the database, bypassing RLS and admin checks.
 * PROTECTED: Only callable when IS_TEST env var is set.
 */
export const seedOrganizer = testingMutation({
  args: {
    name: v.string(),
    email: v.optional(v.string()),
    contactInfo: v.optional(v.string()),
    slug: v.optional(v.string()),
    isPlatformOrganizer: v.optional(v.boolean()),
    stripeConnectedAccountId: v.optional(v.string()),
    stripeOnboardingStatus: v.optional(onboardingStatusValidator),
    stripeChargesEnabled: v.optional(v.boolean()),
    stripePayoutsEnabled: v.optional(v.boolean()),
    isPublicDirectory: v.optional(v.boolean()),
    vettingQuestions: v.optional(v.array(vettingQuestionValidator)),
    status: communityPublicationStatusValidator,
    description: v.optional(v.string()),
    website: v.optional(v.string()),
    codeOfConduct: v.optional(v.string()),
    logoStorageId: v.optional(v.union(v.id('_storage'), v.null())),
  },
  returns: v.id('organizers'),
  handler: async (ctx, args) => {
    return insertSeedOrganizer(ctx, args);
  },
});

/**
 * Seeds a published organizer without vetting questions. This represents a state that
 * production mutations prohibit (published orgs require at least one vetting question), but
 * which tests for access-control edge cases must exercise. The organizer is published so
 * that published events can be seeded under it.
 * PROTECTED: Only callable when IS_TEST env var is set.
 */
export const seedOrganizerNoVetting = testingMutation({
  args: {name: v.string()},
  returns: v.id('organizers'),
  handler: async ({db}, {name}) => {
    const slug = await resolveCommunitySlugForCreate(db, {name});
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Intentionally invalid state: published org without vetting questions
    return db.insert('organizers', {
      name,
      slug,
      status: 'published',
      isPublicDirectory: true,
    });
  },
});

/**
 * Seeds a community admin junction row directly into the database, bypassing RLS.
 * PROTECTED: Only callable when IS_TEST env var is set.
 */
export const seedCommunityAdmin = testingMutation({
  args: {
    userId: v.id('users'),
    organizerId: v.id('organizers'),
    grantedBy: v.id('users'),
  },
  returns: v.null(),
  handler: async (ctx, {userId, organizerId}) => {
    await authz.assignRole(ctx, userId, 'community_admin', {
      type: 'organizer',
      id: organizerId as string,
    });
    await addSeedMembership(ctx, userId, organizerId);
    return null;
  },
});

/**
 * Seeds `count` synthetic `member` role assignments on an organizer via the authz
 * component, so a test can drive an organizer to (or past) `AUTHZ_RELATION_QUERY_CAP`
 * without inserting that many real user documents. The subjects are throwaway id
 * strings (`cap-user-<organizerId>-<index>`), never real `users` rows — these
 * assignments only exist to exercise the member-cap threshold in enumeration/count
 * helpers.
 *
 * Role assignment is reserved for dedicated seed helpers (see
 * `backend/convex/testing/AGENTS.md`), so bulk member-cap seeding lives here rather
 * than inline in test files.
 * PROTECTED: Only callable when IS_TEST env var is set.
 */
export const seedOrganizerMemberRolesAtScale = testingMutation({
  args: {
    organizerId: v.id('organizers'),
    count: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, {organizerId, count}) => {
    for (let index = 0; index < count; index += 1) {
      await authz.assignRole(
        ctx,
        `cap-user-${organizerId}-${index}`,
        'member',
        organizerScope(organizerId),
      );
    }
    return null;
  },
});

/**
 * Seeds a community scanner junction row directly into the database, bypassing RLS.
 * PROTECTED: Only callable when IS_TEST env var is set.
 */
export const seedCommunityScanner = testingMutation({
  args: {
    userId: v.id('users'),
    organizerId: v.id('organizers'),
    grantedBy: v.id('users'),
  },
  returns: v.null(),
  handler: async (ctx, {userId, organizerId}) => {
    await authz.assignRole(ctx, userId, 'community_scanner', {
      type: 'organizer',
      id: organizerId as string,
    });
    await addSeedMembership(ctx, userId, organizerId);
    return null;
  },
});
