import {v} from 'convex/values';
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from '../_generated/server';
import type {Id} from '../_generated/dataModel';
import {isGuestListEventActive} from '../lib/guest_list/lifecycle';
import {normalizeEmailOrNull} from '../lib/validation';

const automaticTicketSourceKindValidator = v.union(
  v.literal('assignment_admission'),
  v.literal('self_service'),
);

export const loadAttempt = internalQuery({
  args: {assignmentId: v.id('guestListAssignments'), attemptId: v.string()},
  returns: v.union(
    v.null(),
    v.object({
      email: v.string(),
      displayName: v.string(),
      eventTitle: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const assignment = await ctx.db.get(
      'guestListAssignments',
      args.assignmentId,
    );
    if (
      !assignment ||
      assignment.status !== 'active' ||
      assignment.inviteAttemptId !== args.attemptId ||
      !assignment.pendingTokenDigest
    )
      return null;
    const event = await ctx.db.get('events', assignment.eventId);
    return event && isGuestListEventActive(event)
      ? {
          email: assignment.email,
          displayName: assignment.displayName,
          eventTitle: event.title,
        }
      : null;
  },
});

export const getAssignmentForTicket = internalQuery({
  args: {assignmentId: v.id('guestListAssignments')},
  returns: v.union(v.null(), v.object({eventId: v.id('events')})),
  handler: async (ctx, args) => {
    const assignment = await ctx.db.get(
      'guestListAssignments',
      args.assignmentId,
    );
    if (!assignment || assignment.status !== 'active') return null;
    const event = await ctx.db.get('events', assignment.eventId);
    return event && isGuestListEventActive(event)
      ? {eventId: assignment.eventId}
      : null;
  },
});

export const canDeliverAutomaticTicket = internalQuery({
  args: {
    guestId: v.id('guests'),
    assignmentId: v.id('guestListAssignments'),
    eventId: v.id('events'),
    recipient: v.string(),
    sourceKind: automaticTicketSourceKindValidator,
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const guest = await ctx.db.get('guests', args.guestId);
    if (
      !guest ||
      guest.eventId !== args.eventId ||
      guest.sourceAssignmentId !== args.assignmentId ||
      guest.sourceKind !== args.sourceKind ||
      normalizeEmailOrNull(guest.email) !== normalizeEmailOrNull(args.recipient)
    ) {
      return false;
    }

    const assignment = await ctx.db.get(
      'guestListAssignments',
      args.assignmentId,
    );
    if (
      !assignment ||
      assignment.status !== 'active' ||
      assignment.eventId !== args.eventId
    ) {
      return false;
    }
    if (
      args.sourceKind === 'assignment_admission' &&
      assignment.admissionGuestId !== guest._id
    ) {
      return false;
    }

    const event = await ctx.db.get('events', args.eventId);
    return event !== null && isGuestListEventActive(event);
  },
});

export const prepareAttempt = internalMutation({
  args: {
    assignmentId: v.id('guestListAssignments'),
    attemptId: v.string(),
    tokenDigest: v.string(),
    tokenPrefix: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const assignment = await ctx.db.get(
      'guestListAssignments',
      args.assignmentId,
    );
    if (
      !assignment ||
      assignment.status !== 'active' ||
      assignment.inviteAttemptId !== args.attemptId
    )
      return false;
    const event = await ctx.db.get('events', assignment.eventId);
    if (!event || !isGuestListEventActive(event)) return false;
    await ctx.db.patch('guestListAssignments', assignment._id, {
      pendingTokenDigest: args.tokenDigest,
      pendingTokenPrefix: args.tokenPrefix,
      inviteState: 'pending',
      inviteFailureCode: undefined,
    });
    return true;
  },
});

export const promoteAttempt = internalMutation({
  args: {assignmentId: v.id('guestListAssignments'), attemptId: v.string()},
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const assignment = await ctx.db.get(
      'guestListAssignments',
      args.assignmentId,
    );
    if (
      !assignment ||
      assignment.status !== 'active' ||
      assignment.inviteAttemptId !== args.attemptId ||
      !assignment.pendingTokenDigest ||
      !assignment.pendingTokenPrefix
    )
      return false;
    const event = await ctx.db.get('events', assignment.eventId);
    if (!event || !isGuestListEventActive(event)) return false;
    const now = Date.now();
    await ctx.db.patch('guestListAssignments', assignment._id, {
      tokenDigest: assignment.pendingTokenDigest,
      tokenPrefix: assignment.pendingTokenPrefix,
      pendingTokenDigest: undefined,
      pendingTokenPrefix: undefined,
      inviteState: 'accepted',
      inviteFailureCode: undefined,
      lastInviteAcceptedAt: now,
      lastInviteSentAt: now,
    });
    return true;
  },
});

const attemptFailureArgs = {
  assignmentId: v.id('guestListAssignments'),
  attemptId: v.string(),
  failureCode: v.string(),
};

type AttemptFailureArgs = {
  assignmentId: Id<'guestListAssignments'>;
  attemptId: string;
  failureCode: string;
};

async function failCurrentAttempt(
  ctx: MutationCtx,
  args: AttemptFailureArgs,
): Promise<boolean> {
  const assignment = await ctx.db.get(
    'guestListAssignments',
    args.assignmentId,
  );
  if (
    !assignment ||
    assignment.status !== 'active' ||
    assignment.inviteAttemptId !== args.attemptId ||
    !assignment.pendingTokenDigest ||
    !assignment.pendingTokenPrefix
  ) {
    return false;
  }
  await ctx.db.patch('guestListAssignments', assignment._id, {
    pendingTokenDigest: undefined,
    pendingTokenPrefix: undefined,
    inviteState: 'failed',
    inviteFailureCode: args.failureCode.slice(0, 64),
  });
  return true;
}

export const failAttempt = internalMutation({
  args: attemptFailureArgs,
  returns: v.boolean(),
  handler: failCurrentAttempt,
});

export const abortAttempt = internalMutation({
  args: attemptFailureArgs,
  returns: v.boolean(),
  handler: failCurrentAttempt,
});
