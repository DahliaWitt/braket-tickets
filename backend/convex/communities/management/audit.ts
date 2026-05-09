import {v} from 'convex/values';
import {paginationOptsValidator} from 'convex/server';
import {internal} from '../../_generated/api';
import {internalMutation, query} from '../../_generated/server';
import {
  adminAuditActionCategoryValidator,
  adminAuditActionValidator,
  adminAuditCheckInActionValidator,
} from '../../lib/admin_audit_actions';
import {cleanupOldAuditLogsState} from './_impl/cleanup';
import {
  listAuditLogs as listAuditLogsImpl,
  logAdminAccess as logAdminAccessImpl,
  recordCheckInLog as recordCheckInLogImpl,
} from './_impl/audit';

/**
 * Records a check-in audit log entry.
 *
 * Separated from the primary check-in path so it can be scheduled as a
 * background task (ctx.scheduler.runAfter), keeping the critical ticket-patch
 * write on the hot path and deferring the audit insert.
 *
 * @internal
 */
export const recordCheckIn = internalMutation({
  args: {
    adminId: v.id('users'),
    action: adminAuditCheckInActionValidator,
    eventId: v.optional(v.id('events')),
    organizerId: v.optional(v.id('organizers')),
    source: v.optional(v.string()),
  },
  returns: v.null(),
  handler: recordCheckInLogImpl,
});

/**
 * Records an admin action in the audit log.
 *
 * Creates an immutable audit trail entry for administrative operations.
 * Called by other internal functions when admins perform sensitive actions
 * like approving applications, modifying events, or accessing user data.
 *
 * @param adminId - The user ID of the admin performing the action
 * @param action - An allowlisted audit action (for example "application.review")
 * @param eventId - Optional event ID if the action relates to an event
 * @param applicationId - Optional application ID if the action relates to a vetting application
 * @param source - Optional source identifier (e.g., "admin_dashboard", "support_tool")
 * @returns null
 *
 * @example
 * await ctx.runMutation(internal.communities.management.audit.logAdminAccess, {
 *   adminId: userId,
 *   action: "application.review",
 *   applicationId: appId,
 *   source: "admin_dashboard"
 * });
 *
 * @internal This is an internal mutation - not callable from the client
 */
export const logAdminAccess = internalMutation({
  args: {
    adminId: v.id('users'),
    action: adminAuditActionValidator,
    eventId: v.optional(v.id('events')),
    applicationId: v.optional(v.id('applications')),
    targetUserId: v.optional(v.id('users')),
    organizerId: v.optional(v.id('organizers')),
    source: v.optional(v.string()),
  },
  returns: v.null(),
  handler: logAdminAccessImpl,
});

export const cleanupOldAuditLogs = internalMutation({
  args: {
    cutoffTimestamp: v.optional(v.number()),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const result = await cleanupOldAuditLogsState(ctx, args.cutoffTimestamp);
    if (result.shouldContinue) {
      await ctx.scheduler.runAfter(
        0,
        internal.communities.management.audit.cleanupOldAuditLogs,
        {},
      );
    }
    return result.deletedCount;
  },
});

/**
 * Returns a paginated list of audit log entries for a given organizer.
 *
 * Results are ordered newest-first. Supports optional filtering by action category
 * and/or a minimum timestamp. Each entry is enriched with denormalized display names
 * (admin name, event title, applicant name, magic link label, trust link summary).
 *
 * @param organizerId - Scopes the result to a specific community.
 * @param actionCategory - Optional category key backed by the audit-action allowlist.
 * @param sinceTimestamp - Optional lower bound on _creationTime (inclusive).
 * @param paginationOpts - Convex pagination cursor + page size.
 */
export const listAuditLogs = query({
  args: {
    organizerId: v.id('organizers'),
    actionCategory: v.optional(adminAuditActionCategoryValidator),
    sinceTimestamp: v.optional(v.number()),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(
      v.object({
        _id: v.id('adminAuditLogs'),
        _creationTime: v.number(),
        action: adminAuditActionValidator,
        adminName: v.string(),
        eventName: v.optional(v.string()),
        deletedEventName: v.optional(v.string()),
        applicationUserName: v.optional(v.string()),
        targetUserName: v.optional(v.string()),
        magicLinkLabel: v.optional(v.string()),
        trustLinkLabel: v.optional(v.string()),
        reason: v.optional(v.string()),
        source: v.optional(v.string()),
        eventId: v.optional(v.id('events')),
        applicationId: v.optional(v.id('applications')),
      }),
    ),
    isDone: v.boolean(),
    continueCursor: v.string(),
    splitCursor: v.optional(v.union(v.string(), v.null())),
    pageStatus: v.optional(
      v.union(
        v.literal('SplitRecommended'),
        v.literal('SplitRequired'),
        v.null(),
      ),
    ),
  }),
  handler: listAuditLogsImpl,
});
