import type {PaginationOptions} from 'convex/server';
import type {Id} from '../../../_generated/dataModel';
import type {MutationCtx, QueryCtx} from '../../../_generated/server';
import {insertAdminAuditLog} from '../../../lib/admin_audit_log';
import {
  type AdminAuditAction,
  type AdminAuditActionCategory,
} from '../../../lib/admin_audit_actions';
import {requireManageCommunity} from '../../../lib/access';
import {requireUser} from '../../../lib/auth_identity';
import {logTransactionMetrics} from '../../../lib/runtime_metadata';

const AUDIT_LOG_MAXIMUM_ROWS_READ = 2000;

type AuditLogPageRow = {
  _id: Id<'adminAuditLogs'>;
  _creationTime: number;
  action: AdminAuditAction;
  adminName: string;
  eventName?: string;
  deletedEventName?: string;
  applicationUserName?: string;
  targetUserName?: string;
  magicLinkLabel?: string;
  trustLinkLabel?: string;
  reason?: string;
  source?: string;
  eventId?: Id<'events'>;
  applicationId?: Id<'applications'>;
};

type AuditLogPage = {
  page: AuditLogPageRow[];
  isDone: boolean;
  continueCursor: string;
  splitCursor?: string | null;
  pageStatus?: 'SplitRecommended' | 'SplitRequired' | null;
};

type ListAuditLogsArgs = {
  organizerId: Id<'organizers'>;
  actionCategory?: AdminAuditActionCategory;
  sinceTimestamp?: number;
  paginationOpts: PaginationOptions;
};

export async function recordCheckInLog(
  ctx: MutationCtx,
  args: {
    adminId: Id<'users'>;
    action: AdminAuditAction;
    eventId?: Id<'events'>;
    organizerId?: Id<'organizers'>;
    source?: string;
  },
): Promise<null> {
  await insertAdminAuditLog(ctx, {
    adminId: args.adminId,
    action: args.action,
    eventId: args.eventId,
    organizerId: args.organizerId,
    source: args.source,
  });
  return null;
}

export async function logAdminAccess(
  ctx: MutationCtx,
  args: {
    adminId: Id<'users'>;
    action: AdminAuditAction;
    eventId?: Id<'events'>;
    applicationId?: Id<'applications'>;
    targetUserId?: Id<'users'>;
    organizerId?: Id<'organizers'>;
    source?: string;
  },
): Promise<null> {
  let organizerId = args.organizerId;
  if (organizerId === undefined && args.eventId !== undefined) {
    const event = await ctx.db.get('events', args.eventId);
    organizerId = event?.organizerId;
  }
  if (organizerId === undefined && args.applicationId !== undefined) {
    const app = await ctx.db.get('applications', args.applicationId);
    organizerId = app?.organizerId ?? undefined;
  }

  await insertAdminAuditLog(ctx, {
    adminId: args.adminId,
    action: args.action,
    eventId: args.eventId,
    applicationId: args.applicationId,
    targetUserId: args.targetUserId,
    organizerId,
    source: args.source,
  });
  return null;
}

export async function listAuditLogs(
  ctx: QueryCtx,
  args: ListAuditLogsArgs,
): Promise<AuditLogPage> {
  const {_id: userId} = await requireUser(ctx);
  await requireManageCommunity(ctx, userId, args.organizerId);

  const rawPage =
    args.actionCategory === undefined
      ? await ctx.db
          .query('adminAuditLogs')
          .withIndex('by_organizer', (q) => {
            const range = q.eq('organizerId', args.organizerId);
            return args.sinceTimestamp !== undefined
              ? range.gte('_creationTime', args.sinceTimestamp)
              : range;
          })
          .order('desc')
          .paginate({
            ...args.paginationOpts,
            maximumRowsRead:
              args.paginationOpts.maximumRowsRead ??
              AUDIT_LOG_MAXIMUM_ROWS_READ,
          })
      : await ctx.db
          .query('adminAuditLogs')
          .withIndex('by_organizer_and_actionCategory', (q) => {
            const range = q
              .eq('organizerId', args.organizerId)
              .eq('actionCategory', args.actionCategory);
            return args.sinceTimestamp !== undefined
              ? range.gte('_creationTime', args.sinceTimestamp)
              : range;
          })
          .order('desc')
          .paginate({
            ...args.paginationOpts,
            maximumRowsRead:
              args.paginationOpts.maximumRowsRead ??
              AUDIT_LOG_MAXIMUM_ROWS_READ,
          });

  const enriched = await Promise.all(
    rawPage.page.map(async (log) => {
      const admin = await ctx.db.get('users', log.adminId);
      const adminName = admin?.name ?? 'Unknown';

      let eventName: string | undefined;
      let deletedEventName: string | undefined;
      if (log.eventId !== undefined) {
        const event = await ctx.db.get('events', log.eventId);
        if (event !== null) {
          eventName = event.title;
        } else if (log.deletedEventName !== undefined) {
          deletedEventName = log.deletedEventName;
        }
      }

      let applicationUserName: string | undefined;
      if (log.applicationId !== undefined) {
        const app = await ctx.db.get('applications', log.applicationId);
        if (app !== null) {
          const appUser = await ctx.db.get('users', app.userId);
          applicationUserName = appUser?.name;
        }
      }

      let targetUserName: string | undefined;
      if (log.targetUserId !== undefined) {
        const targetUser = await ctx.db.get('users', log.targetUserId);
        targetUserName = targetUser?.name ?? 'Unknown';
      }

      let magicLinkLabel: string | undefined;
      if (log.magicLinkId !== undefined) {
        const link = await ctx.db.get('magic_links', log.magicLinkId);
        magicLinkLabel = link?.label ?? 'Magic Link';
      }

      let trustLinkLabel: string | undefined;
      if (
        log.trustingOrganizerId !== undefined &&
        log.trustedOrganizerId !== undefined
      ) {
        const [trusting, trusted] = await Promise.all([
          ctx.db.get('organizers', log.trustingOrganizerId),
          ctx.db.get('organizers', log.trustedOrganizerId),
        ]);
        trustLinkLabel = `${trusting?.name ?? log.trustingOrganizerId} → ${trusted?.name ?? log.trustedOrganizerId}`;
      }

      return {
        _id: log._id,
        _creationTime: log._creationTime,
        action: log.action as AdminAuditAction,
        adminName,
        eventName,
        deletedEventName,
        applicationUserName,
        targetUserName,
        magicLinkLabel,
        trustLinkLabel,
        reason: log.reason,
        source: log.source,
        eventId: log.eventId,
        applicationId: log.applicationId,
      };
    }),
  );

  await logTransactionMetrics(
    ctx,
    'communities.management.audit.listAuditLogs',
  );
  return {...rawPage, page: enriched};
}
