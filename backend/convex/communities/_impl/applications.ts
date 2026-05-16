import {type Infer} from 'convex/values';
import type {Id} from '../../_generated/dataModel';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import {guardEmailDedup} from '../../lib/email_dedup';
import {getAuthUserId, requireUser} from '../../lib/auth_identity';
import {
  validateApplicationAnswers,
  validateApplicationAnswersForVettingQuestions,
  validateStringLength,
  MAX_REASON_LENGTH,
} from '../../lib/validation';
import {
  canViewCommunityForVetting,
  isPlatformAdmin,
  requireManageCommunity,
  requirePlatformAdmin,
} from '../../lib/access';
import {
  getUserCommunities,
  addMember,
  isCommunityMember,
} from '../../lib/authz';
import {removeMemberWithAdminCascade} from '../../lib/users/membership';
import {rateLimiter} from '../../lib/rate_limits';
import {enqueueEmailDelivery} from '../../lib/email_delivery_wrapper';
import {
  assertValidApplicationReinstateTransition,
  assertValidApplicationReviewTransition,
  assertValidApplicationRevocationTransition,
  buildApplicationReinstatePatch,
  buildApplicationReviewPatch,
  buildApplicationRevocationPatch,
} from '../../lib/application_transitions';
import {insertAdminAuditLog} from '../../lib/admin_audit_log';
import {loadApplicationSubmissionEmails} from '../../lib/applications/queries';
import {buildApplicationDecisionEmail} from '../../lib/applications/notifications';
import {ensureApprovedMarketingPreference} from '../../lib/marketing_emails/preferences';
import {
  buildApplicationListRows,
  getLatestApplicationForOrganizer,
  listApplicationsAcrossOrganizers,
  listApplicationsForOrganizer,
  mapApplicationsWithOrganizers,
  pickLatestApplicationByCreationTime,
} from '../../lib/applications/read_models';
import {
  applicationsByUserAndOrganizerStatusQuery,
  applicationsByUserQuery,
  applicationsByUserStatusQuery,
} from '../../lib/applications/loaders';
import {
  applicationAnswersValidator,
  type ApplicationStatus,
} from '../../lib/applications/validators';
import {
  recomputeOrganizerDirectoryRow,
  refreshOrganizerDirectoryForMembershipChange,
} from '../../lib/users/organizer_directory';
import {throwConflict, throwNotFound} from '../../lib/errors';

type AuthCtx = Parameters<typeof getAuthUserId>[0];
type ApplicationListDoc = Parameters<
  typeof buildApplicationListRows
>[1][number];

async function requireApplicationAdmin(
  ctx: AuthCtx,
  userId: Id<'users'>,
  organizerId: Id<'organizers'> | undefined,
): Promise<void> {
  if (organizerId) {
    await requireManageCommunity(ctx, userId, organizerId);
    return;
  }

  await requirePlatformAdmin(ctx, userId);
}

async function sendApplicationDecisionEmail(
  ctx: MutationCtx,
  args: {
    applicationId: Id<'applications'>;
    organizerId?: Id<'organizers'>;
    recipientUserId: Id<'users'>;
    status: 'approved' | 'rejected';
    denyReason?: string;
  },
): Promise<void> {
  const [recipientUser, organizer] = await Promise.all([
    ctx.db.get('users', args.recipientUserId),
    args.organizerId ? ctx.db.get('organizers', args.organizerId) : null,
  ]);
  const emailPayload = buildApplicationDecisionEmail({
    status: args.status,
    recipient: recipientUser,
    communityName: organizer?.name,
    communityParam: organizer?.slug ?? args.organizerId,
    denyReason: args.denyReason,
  });
  if (!emailPayload) return;

  await enqueueEmailDelivery(
    ctx,
    {
      to: emailPayload.to,
      subject: emailPayload.subject,
      html: emailPayload.html,
    },
    {
      source: 'application',
      sourceId: args.applicationId as string,
      recipient: emailPayload.to,
    },
  );
}

export async function submitApplication(
  ctx: MutationCtx,
  args: {
    organizerId?: Id<'organizers'>;
    answers: Infer<typeof applicationAnswersValidator>;
  },
): Promise<Id<'applications'>> {
  const {_id: userId} = await requireUser(ctx);

  if (
    args.organizerId &&
    (await isCommunityMember(ctx, userId, args.organizerId))
  ) {
    throwConflict('You are already a member of this community.');
  }

  const organizer = args.organizerId
    ? await ctx.db.get('organizers', args.organizerId)
    : null;
  if (args.organizerId && !organizer) {
    throwNotFound('Community');
  }
  if (organizer) {
    if (!(await canViewCommunityForVetting(ctx, userId, organizer))) {
      throwNotFound('Community');
    }
    validateApplicationAnswersForVettingQuestions(
      args.answers,
      organizer.vettingQuestions ?? [],
    );
  } else {
    validateApplicationAnswers(args.answers);
  }

  await rateLimiter.limit(ctx, 'submitApplication', {
    key: userId,
    throws: true,
  });

  const existing = args.organizerId
    ? await applicationsByUserAndOrganizerStatusQuery(
        ctx.db,
        userId,
        args.organizerId,
        'pending',
      ).first()
    : ((
        await applicationsByUserStatusQuery(ctx.db, userId, 'pending').take(100)
      ).find((application) => application.organizerId === undefined) ?? null);

  if (existing) {
    throwConflict('You already have a pending application for this community.');
  }

  const applicationId = await ctx.db.insert('applications', {
    userId,
    organizerId: args.organizerId,
    status: 'pending',
    answers: args.answers,
  });

  if (args.organizerId) {
    await recomputeOrganizerDirectoryRow(ctx, {
      organizerId: args.organizerId,
      userId,
    });
  }

  if (args.organizerId) {
    const emailPayloads = await loadApplicationSubmissionEmails(ctx, {
      applicantUserId: userId,
      organizerId: args.organizerId,
    });

    await Promise.all(
      emailPayloads.map(async (emailPayload) => {
        const dedupKey = `vetting-notify-${applicationId}-${emailPayload.recipientUserId}`;
        const alreadySent = await guardEmailDedup(ctx, dedupKey);
        if (alreadySent) return;

        await enqueueEmailDelivery(
          ctx,
          {
            to: emailPayload.to,
            subject: emailPayload.subject,
            html: emailPayload.html,
          },
          {
            source: 'application',
            sourceId: applicationId as string,
            recipient: emailPayload.to,
          },
        );
      }),
    );
  }

  return applicationId;
}

export async function getMyApplication(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;

  // TODO(BRA-410): Cursor-paginate this query; avoid all-results reads in queries.
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- Temporary all-results API until pagination is added.
  const apps = await applicationsByUserQuery(ctx.db, userId).collect();
  return pickLatestApplicationByCreationTime(apps);
}

export async function getMyApplicationForOrganizer(
  ctx: QueryCtx,
  args: {organizerId: Id<'organizers'>},
) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;

  const organizerApp = await getLatestApplicationForOrganizer(ctx, {
    userId,
    organizerId: args.organizerId,
  });

  return organizerApp ?? null;
}

export async function getMyApplications(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return [];

  // TODO(BRA-410): Cursor-paginate this list API; avoid all-results reads in queries.
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- Temporary all-results API until pagination is added.
  const rows = await applicationsByUserQuery(ctx.db, userId)
    .order('desc')
    .collect();
  rows.sort((a, b) => b._creationTime - a._creationTime);

  if (rows.length === 0) return [];
  return mapApplicationsWithOrganizers(ctx, rows);
}

export async function reviewApplication(
  ctx: MutationCtx,
  args: {
    applicationId: Id<'applications'>;
    status: 'approved' | 'rejected';
    denyReason?: string;
    reason?: string;
  },
) {
  const {_id: actorId} = await requireUser(ctx);
  const denyReason = args.denyReason ?? args.reason;
  validateStringLength(denyReason, 'Deny reason', MAX_REASON_LENGTH);

  const app = await ctx.db.get('applications', args.applicationId);
  if (!app) throwNotFound('Application');

  await requireApplicationAdmin(ctx, actorId, app.organizerId);

  assertValidApplicationReviewTransition(app.status);

  await ctx.db.patch(
    'applications',
    args.applicationId,
    buildApplicationReviewPatch(args.status, actorId, denyReason),
  );

  if (args.status === 'approved') {
    await ensureApprovedMarketingPreference(ctx.db, {
      userId: app.userId,
      organizerId: app.organizerId,
    });

    if (app.organizerId) {
      await addMember(ctx, app.userId, app.organizerId, {actorId});
      await refreshOrganizerDirectoryForMembershipChange(ctx, {
        organizerId: app.organizerId,
        userId: app.userId,
      });
    }

    await sendApplicationDecisionEmail(ctx, {
      applicationId: args.applicationId,
      organizerId: app.organizerId,
      recipientUserId: app.userId,
      status: 'approved',
    });
  } else if (args.status === 'rejected') {
    if (app.organizerId) {
      await recomputeOrganizerDirectoryRow(ctx, {
        organizerId: app.organizerId,
        userId: app.userId,
      });
    }

    await sendApplicationDecisionEmail(ctx, {
      applicationId: args.applicationId,
      organizerId: app.organizerId,
      recipientUserId: app.userId,
      status: 'rejected',
      denyReason,
    });
  }

  await insertAdminAuditLog(ctx, {
    adminId: actorId,
    action: 'application.review',
    applicationId: args.applicationId,
    organizerId: app.organizerId ?? undefined,
    source: 'admin-ui',
    reason: denyReason,
  });

  return null;
}

export async function revokeApplication(
  ctx: MutationCtx,
  args: {
    applicationId: Id<'applications'>;
    reason?: string;
  },
) {
  const {_id: actorId} = await requireUser(ctx);

  validateStringLength(args.reason, 'Reason', MAX_REASON_LENGTH);

  const app = await ctx.db.get('applications', args.applicationId);
  if (!app) throwNotFound('Application');

  await requireApplicationAdmin(ctx, actorId, app.organizerId);

  assertValidApplicationRevocationTransition(app.status);

  await ctx.db.patch(
    'applications',
    args.applicationId,
    buildApplicationRevocationPatch(actorId, args.reason),
  );

  if (app.organizerId) {
    await removeMemberWithAdminCascade(ctx, {
      userId: app.userId,
      organizerId: app.organizerId,
      actorId,
      auditSource: 'application-revoke-cascade',
    });
    await refreshOrganizerDirectoryForMembershipChange(ctx, {
      organizerId: app.organizerId,
      userId: app.userId,
    });
  }

  await insertAdminAuditLog(ctx, {
    adminId: actorId,
    action: 'application.revoke',
    applicationId: args.applicationId,
    organizerId: app.organizerId ?? undefined,
    source: 'admin-ui',
    reason: args.reason,
  });

  return null;
}

export async function reinstateApplication(
  ctx: MutationCtx,
  args: {
    applicationId: Id<'applications'>;
    force?: boolean;
  },
) {
  const {_id: actorId} = await requireUser(ctx);

  const app = await ctx.db.get('applications', args.applicationId);
  if (!app) throwNotFound('Application');

  await requireApplicationAdmin(ctx, actorId, app.organizerId);

  assertValidApplicationReinstateTransition(app.status);

  if (app.organizerId && !args.force) {
    const latestApp = await getLatestApplicationForOrganizer(ctx, {
      userId: app.userId,
      organizerId: app.organizerId,
    });
    if (latestApp && latestApp._id !== args.applicationId) {
      return {
        conflict: 'newer_application' as const,
        newerStatus: latestApp.status,
      };
    }
  }

  await ctx.db.patch(
    'applications',
    args.applicationId,
    buildApplicationReinstatePatch(actorId),
  );

  if (app.organizerId) {
    await ensureApprovedMarketingPreference(ctx.db, {
      userId: app.userId,
      organizerId: app.organizerId,
    });
    await addMember(ctx, app.userId, app.organizerId, {actorId});
    await refreshOrganizerDirectoryForMembershipChange(ctx, {
      organizerId: app.organizerId,
      userId: app.userId,
    });

    await sendApplicationDecisionEmail(ctx, {
      applicationId: args.applicationId,
      organizerId: app.organizerId,
      recipientUserId: app.userId,
      status: 'approved',
    });
  }

  await insertAdminAuditLog(ctx, {
    adminId: actorId,
    action: 'application.reinstate',
    applicationId: args.applicationId,
    organizerId: app.organizerId ?? undefined,
    source: 'admin-ui',
  });

  return null;
}

export async function listApplications(
  ctx: QueryCtx,
  args: {
    status?: ApplicationStatus;
    organizerId?: Id<'organizers'>;
  },
) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return [];

  let apps: ApplicationListDoc[];

  if (await isPlatformAdmin(ctx, userId)) {
    if (args.organizerId) {
      apps = await listApplicationsForOrganizer(ctx, {
        organizerId: args.organizerId,
        status: args.status,
      });
    } else {
      const q = ctx.db.query('applications');
      if (args.status) {
        apps = await q
          .withIndex('by_status', (qi) => qi.eq('status', args.status!))
          .take(500);
      } else {
        apps = await q.order('desc').take(500);
      }
    }
  } else {
    const communityIds = await getUserCommunities(ctx, userId);
    if (communityIds.length === 0) return [];

    if (args.organizerId) {
      if (!communityIds.includes(args.organizerId)) return [];
      apps = await listApplicationsForOrganizer(ctx, {
        organizerId: args.organizerId,
        status: args.status,
      });
    } else {
      apps = await listApplicationsAcrossOrganizers(ctx, {
        organizerIds: communityIds,
        status: args.status,
      });
    }
  }

  return buildApplicationListRows(ctx, apps);
}
