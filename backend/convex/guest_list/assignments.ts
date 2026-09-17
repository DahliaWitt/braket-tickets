import {paginationOptsValidator} from 'convex/server';
import {v} from 'convex/values';
import {mutation, query} from '../_generated/server';
import {requireEventForManage} from '../lib/access';
import {throwAppError} from '../lib/errors';
import {
  guestListAssignmentPageValidator,
  guestListAssignmentViewValidator,
  guestListEventOverviewValidator,
  guestListInviteStateValidator,
  guestListRoleValidator,
  sourcedGuestPageValidator,
} from '../lib/guest_list/validators';
import {importBatchResultValidator} from '../lib/imports/validators';
import {findExistingImportBatch, insertImportBatch} from '../lib/imports/bulk';
import {internal} from '../_generated/api';
import {rateLimiter} from '../lib/rate_limits';
import {
  appendRecentResendIdempotencyKey,
  assertValidGuestListIdempotencyKey,
  assignmentView,
  createAssignment,
  createAssignmentWithContext,
  insertAudit,
  requireGuestListFeatureEnabled,
  resolveGuestListAssignmentContext,
  revokeAssignment,
  sourcedGuestView,
  validateAssignmentInput,
  validateGuestListSlots,
} from '../lib/guest_list/core';
import {requireGuestListEventActive} from '../lib/guest_list/lifecycle';
import {
  getOrCreateGuestListEventStats,
  updateGuestListEventStats,
} from '../lib/guest_list/event_stats';
import {deriveIdempotencyKey} from '../lib/idempotency';

const unavailable = (): never =>
  throwAppError('UNAVAILABLE', 'Self-service guest lists are unavailable');

/** Conservative cap because each valid row creates assignment/audit/admission work. */
export const MAX_GUEST_LIST_STAFF_IMPORT_ROWS = 50;

function assertStaffImportBatchSize(rowCount: number): void {
  if (rowCount === 0) {
    throwAppError('IMPORT_EMPTY', 'No rows to import');
  }
  if (rowCount > MAX_GUEST_LIST_STAFF_IMPORT_ROWS) {
    throwAppError(
      'BATCH_TOO_LARGE',
      `Staff import exceeds the maximum of ${MAX_GUEST_LIST_STAFF_IMPORT_ROWS} rows per batch`,
      {rowCount, maxBatchSize: MAX_GUEST_LIST_STAFF_IMPORT_ROWS},
    );
  }
}

export const getEventOverview = query({
  args: {eventId: v.id('events')},
  returns: guestListEventOverviewValidator,
  handler: async (ctx, args) => {
    await requireEventForManage(ctx, args.eventId);
    const stats = await ctx.db
      .query('guestListEventStats')
      .withIndex('by_eventId', (q) => q.eq('eventId', args.eventId))
      .unique();
    if (!stats) {
      return {
        selfServiceGuestCount: 0,
        activeGrantedSlots: 0,
        activeArtistGuestCount: 0,
        activeStaffGuestCount: 0,
        activeAssignmentCount: 0,
        totalGuestAdmissionCount: 0,
      };
    }
    return {
      selfServiceGuestCount: stats.selfServiceGuestCount,
      activeGrantedSlots: stats.activeGrantedSlots,
      activeArtistGuestCount: stats.activeArtistGuestCount,
      activeStaffGuestCount: stats.activeStaffGuestCount,
      activeAssignmentCount: stats.activeAssignmentCount,
      totalGuestAdmissionCount: stats.totalGuestAdmissionCount,
    };
  },
});

export const listByEvent = query({
  args: {eventId: v.id('events'), paginationOpts: paginationOptsValidator},
  returns: guestListAssignmentPageValidator,
  handler: async (ctx, args) => {
    await requireEventForManage(ctx, args.eventId);
    // Paginate on `by_eventId_and_createdAt`, not `by_eventId_and_status`.
    // With only `eventId` pinned on the status index the residual descending
    // sort key is `status` first, and `'revoked' > 'active'`, so an event with
    // more revoked than active assignments would hand the organizer a first
    // page of nothing but revoked rows. Ordering by `createdAt` gives a
    // newest-first page regardless of status.
    const page = await ctx.db
      .query('guestListAssignments')
      .withIndex('by_eventId_and_createdAt', (q) =>
        q.eq('eventId', args.eventId),
      )
      .order('desc')
      .paginate(args.paginationOpts);
    return {
      ...page,
      page: page.page.map((assignment) => ({
        assignmentId: assignment._id,
        eventId: assignment.eventId,
        role: assignment.role,
        displayName: assignment.displayName,
        email: assignment.email,
        grantedSlots: assignment.grantedSlots,
        usedSlots: assignment.usedSlots,
        status: assignment.status,
        inviteState: assignment.inviteState,
        admissionGuestId: assignment.admissionGuestId,
        createdAt: assignment.createdAt,
        lastInviteAcceptedAt: assignment.lastInviteAcceptedAt,
        revokedAt: assignment.revokedAt,
      })),
    };
  },
});

export const listGuests = query({
  args: {
    assignmentId: v.id('guestListAssignments'),
    paginationOpts: paginationOptsValidator,
  },
  returns: sourcedGuestPageValidator,
  handler: async (ctx, args) => {
    const assignment = await ctx.db.get(
      'guestListAssignments',
      args.assignmentId,
    );
    if (!assignment) return unavailable();
    await requireEventForManage(ctx, assignment.eventId);
    const page = await ctx.db
      .query('guests')
      .withIndex('by_sourceAssignmentId_and_sourceKind', (q) =>
        q
          .eq('sourceAssignmentId', args.assignmentId)
          .eq('sourceKind', 'self_service'),
      )
      .paginate(args.paginationOpts);
    return {...page, page: page.page.map(sourcedGuestView)};
  },
});

export const create = mutation({
  args: {
    eventId: v.id('events'),
    role: guestListRoleValidator,
    displayName: v.string(),
    email: v.string(),
    userId: v.optional(v.id('users')),
    grantedSlots: v.optional(v.number()),
    idempotencyKey: v.string(),
  },
  returns: guestListAssignmentViewValidator,
  handler: createAssignment,
});

export const bulkCreateStaff = mutation({
  args: {
    eventId: v.id('events'),
    batchKey: v.string(),
    rows: v.array(
      v.object({
        name: v.string(),
        email: v.string(),
        slotOverride: v.optional(v.number()),
      }),
    ),
  },
  returns: importBatchResultValidator,
  handler: async (ctx, args) => {
    assertValidGuestListIdempotencyKey(args.batchKey, 'Batch key');
    // Authorization, feature state, event lifecycle, and the organizer document
    // are resolved exactly once for the whole batch. Calling `createAssignment`
    // per row re-ran all four — including an authorization component round-trip
    // — up to 50 times inside a single transaction. Authorization is unchanged:
    // it is still enforced, just not re-enforced per row.
    const context = await resolveGuestListAssignmentContext(ctx, args.eventId);
    const user = context.actor;
    const existing = await findExistingImportBatch(
      ctx,
      args.eventId,
      args.batchKey,
      'assignmentStaff',
    );
    if (existing) return existing.result;
    await rateLimiter.limit(ctx, 'guestListAssignmentBulkCreate', {
      key: user._id,
      throws: true,
    });
    assertStaffImportBatchSize(args.rows.length);
    const outcomes: Array<{
      rowIndex: number;
      status: 'inserted' | 'skipped' | 'invalid';
      reason?: string;
    }> = [];
    let insertedCount = 0;
    let skippedCount = 0;
    const seen = new Set<string>();
    for (let rowIndex = 0; rowIndex < args.rows.length; rowIndex += 1) {
      const row = args.rows[rowIndex];
      let emailKey: string;
      try {
        emailKey = validateAssignmentInput(
          row.name,
          row.email,
          row.slotOverride,
        ).emailKey;
      } catch {
        outcomes.push({
          rowIndex,
          status: 'invalid',
          reason: 'invalid assignment row',
        });
        continue;
      }
      if (seen.has(emailKey)) {
        skippedCount += 1;
        outcomes.push({rowIndex, status: 'skipped', reason: 'duplicate email'});
        continue;
      }
      seen.add(emailKey);
      const duplicate = await ctx.db
        .query('guestListAssignments')
        .withIndex('by_eventId_and_emailKey_and_status', (q) =>
          q
            .eq('eventId', args.eventId)
            .eq('emailKey', emailKey)
            .eq('status', 'active'),
        )
        .first();
      if (duplicate) {
        skippedCount += 1;
        outcomes.push({
          rowIndex,
          status: 'skipped',
          reason: 'active assignment exists',
        });
        continue;
      }
      const assignmentIdempotencyKey = await deriveIdempotencyKey(
        'guest-list-staff-assignment',
        [args.eventId, args.batchKey, String(rowIndex)],
      );
      await createAssignmentWithContext(ctx, context, {
        role: 'staff',
        displayName: row.name,
        email: row.email,
        grantedSlots: row.slotOverride,
        idempotencyKey: assignmentIdempotencyKey,
        skipRateLimit: true,
      });
      insertedCount += 1;
      outcomes.push({rowIndex, status: 'inserted'});
    }
    const result = {insertedCount, skippedCount, outcomes};
    await insertImportBatch(ctx, {
      eventId: args.eventId,
      batchKey: args.batchKey,
      target: 'assignmentStaff',
      result,
    });
    return result;
  },
});

export const updateGrant = mutation({
  args: {assignmentId: v.id('guestListAssignments'), grantedSlots: v.number()},
  returns: v.object({
    assignment: guestListAssignmentViewValidator,
    previousGrantedSlots: v.number(),
    belowUsage: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const assignment = await ctx.db.get(
      'guestListAssignments',
      args.assignmentId,
    );
    if (!assignment) return unavailable();
    const {user, event} = await requireEventForManage(ctx, assignment.eventId);
    await requireGuestListFeatureEnabled(ctx);
    if (assignment.status === 'revoked') {
      throwAppError(
        'INVALID_STATE',
        'A revoked assignment cannot have its grant changed',
      );
    }
    // Same lifecycle gate as create/resend/revoke: guest-list mutations stop at
    // `hasEventEnded`, so a grant edit must not slip through after the event.
    requireGuestListEventActive(event);
    validateGuestListSlots(args.grantedSlots);
    const previousGrantedSlots = assignment.grantedSlots;
    if (previousGrantedSlots !== args.grantedSlots) {
      const stats = await getOrCreateGuestListEventStats(
        ctx,
        assignment.eventId,
      );
      await ctx.db.patch('guestListAssignments', assignment._id, {
        grantedSlots: args.grantedSlots,
      });
      await updateGuestListEventStats(ctx, stats, (current) => ({
        activeGrantedSlots:
          current.activeGrantedSlots + args.grantedSlots - previousGrantedSlots,
      }));
      await insertAudit(ctx, {
        eventId: assignment.eventId,
        assignmentId: assignment._id,
        actorKind: 'organizer',
        actorUserId: user._id,
        action: 'assignment.grant_change',
        beforeValue: previousGrantedSlots,
        afterValue: args.grantedSlots,
      });
    }
    const updated = await ctx.db.get('guestListAssignments', assignment._id);
    if (!updated) return unavailable();
    return {
      assignment: assignmentView(updated),
      previousGrantedSlots,
      belowUsage: args.grantedSlots < assignment.usedSlots,
    };
  },
});

export const revoke = mutation({
  args: {assignmentId: v.id('guestListAssignments')},
  returns: v.object({
    assignmentId: v.id('guestListAssignments'),
    status: v.literal('revoked'),
    retainedGuestCount: v.number(),
  }),
  handler: async (ctx, args) => revokeAssignment(ctx, args.assignmentId),
});

export const resendInvite = mutation({
  args: {
    assignmentId: v.id('guestListAssignments'),
    idempotencyKey: v.string(),
  },
  returns: v.object({
    assignmentId: v.id('guestListAssignments'),
    inviteState: guestListInviteStateValidator,
  }),
  handler: async (ctx, args) => {
    assertValidGuestListIdempotencyKey(args.idempotencyKey);
    const assignment = await ctx.db.get(
      'guestListAssignments',
      args.assignmentId,
    );
    if (!assignment) return unavailable();
    const {user, event} = await requireEventForManage(ctx, assignment.eventId);
    await requireGuestListFeatureEnabled(ctx);
    if (assignment.status === 'revoked') {
      throwAppError('INVALID_STATE', 'A revoked assignment cannot be resent');
    }
    requireGuestListEventActive(event);
    // Compare against a bounded history, not just the most recent key. With a
    // single stored key, replaying key A after key B had been used was not
    // recognised as a duplicate and minted a third credential plus a third
    // email.
    if (
      (assignment.recentResendIdempotencyKeys ?? []).includes(
        args.idempotencyKey,
      )
    ) {
      return {
        assignmentId: assignment._id,
        inviteState: assignment.inviteState,
      };
    }
    await rateLimiter.limit(ctx, 'guestListInviteResend', {
      key: user._id,
      throws: true,
    });
    await ctx.db.patch('guestListAssignments', assignment._id, {
      inviteState: 'pending',
      inviteAttemptId: args.idempotencyKey,
      inviteFailureCode: undefined,
      recentResendIdempotencyKeys: appendRecentResendIdempotencyKey(
        assignment.recentResendIdempotencyKeys,
        args.idempotencyKey,
      ),
    });
    await insertAudit(ctx, {
      eventId: assignment.eventId,
      assignmentId: assignment._id,
      actorKind: 'organizer',
      actorUserId: user._id,
      action: 'assignment.resend',
    });
    await ctx.scheduler.runAfter(
      0,
      internal.guest_list.invites.sendInviteAttempt,
      {
        assignmentId: assignment._id,
        attemptId: args.idempotencyKey,
      },
    );
    return {assignmentId: assignment._id, inviteState: 'pending' as const};
  },
});
