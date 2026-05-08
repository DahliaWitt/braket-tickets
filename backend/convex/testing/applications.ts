import {v} from 'convex/values';
import type {Id} from '../_generated/dataModel';
import type {MutationCtx} from '../_generated/server';
import {addMember} from '../lib/authz';
import {
  refreshOrganizerDirectoryForMembershipChange,
  recomputeOrganizerDirectoryRow,
} from '../lib/users/organizer_directory';
import {ensureApprovedMarketingPreference} from '../lib/marketing_emails/preferences';
import {
  applicationsByUserAndOrganizerStatusQuery,
  applicationsByUserStatusQuery,
} from '../lib/applications/loaders';
import {validateApplicationAnswers} from '../lib/validation';
import {
  applicationAnswersValidator,
  applicationStatusValidator,
} from '../lib/validators/applications';
import type {ApplicationStatus} from '@shared/domain/application-status';
import {testingMutation} from './wrappers';

interface InsertSeedApplicationArgs {
  userId: Id<'users'>;
  organizerId?: Id<'organizers'>;
  status: ApplicationStatus;
  answers?: Record<string, string | string[] | boolean | number>;
  processedBy?: Id<'users'>;
  reason?: string;
  denyReason?: string;
}

export async function insertSeedApplication(
  ctx: MutationCtx,
  args: InsertSeedApplicationArgs,
): Promise<Id<'applications'>> {
  const status = args.status ?? 'pending';

  validateApplicationAnswers(args.answers ?? {source: 'seed'});

  if (status === 'pending') {
    const existing = args.organizerId
      ? await applicationsByUserAndOrganizerStatusQuery(
          ctx.db,
          args.userId,
          args.organizerId,
          'pending',
        ).first()
      : ((
          await applicationsByUserStatusQuery(
            ctx.db,
            args.userId,
            'pending',
          ).take(100)
        ).find((app) => app.organizerId === undefined) ?? null);

    if (existing) {
      throw new Error(
        'You already have a pending application for this community.',
      );
    }
  }

  // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Test seed helper with direct application state control.
  const applicationId = await ctx.db.insert('applications', {
    userId: args.userId,
    organizerId: args.organizerId,
    status,
    answers: args.answers ?? {source: 'seed'},
    processedBy: args.processedBy,
    reason: args.reason,
    denyReason: args.denyReason,
  });

  if (status === 'approved' && args.organizerId) {
    await addMember(ctx, args.userId, args.organizerId);
    await refreshOrganizerDirectoryForMembershipChange(ctx, {
      organizerId: args.organizerId,
      userId: args.userId,
    });
    await ensureApprovedMarketingPreference(ctx.db, {
      userId: args.userId,
      organizerId: args.organizerId,
    });
  } else if (args.organizerId) {
    await recomputeOrganizerDirectoryRow(ctx, {
      organizerId: args.organizerId,
      userId: args.userId,
    });
  }

  return applicationId;
}

/**
 * Seeds an application for a user, bypassing normal vetting flow.
 * PROTECTED: Only callable when IS_TEST env var is set.
 */
export const seedApplication = testingMutation({
  args: {
    userId: v.id('users'),
    status: applicationStatusValidator,
    organizerId: v.optional(v.id('organizers')),
    answers: v.optional(applicationAnswersValidator),
    processedBy: v.optional(v.id('users')),
    reason: v.optional(v.string()),
    denyReason: v.optional(v.string()),
  },
  returns: v.id('applications'),
  handler: async (ctx, args) => {
    return insertSeedApplication(ctx, args);
  },
});

/**
 * Seeds an approved application for a user with a specific community.
 * Used to set up shared vetting test scenarios.
 * PROTECTED: Only callable when IS_TEST env var is set.
 */
export const seedApprovedApplication = testingMutation({
  args: {
    userId: v.id('users'),
    organizerId: v.id('organizers'),
  },
  returns: v.id('applications'),
  handler: async (ctx, {userId, organizerId}) => {
    return await insertSeedApplication(ctx, {
      userId,
      organizerId,
      status: 'approved',
      answers: {whyJoin: 'E2E test setup — auto-approved'},
    });
  },
});
