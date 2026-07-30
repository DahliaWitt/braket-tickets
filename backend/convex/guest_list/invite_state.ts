import {v} from 'convex/values';
import {internalMutation, internalQuery} from '../_generated/server';

export const loadAttempt = internalQuery({
  args: {assignmentId: v.id('guestListAssignments'), attemptId: v.string()},
  returns: v.union(v.null(), v.object({email: v.string(), displayName: v.string(), eventTitle: v.string()})),
  handler: async (ctx, args) => {
    const assignment = await ctx.db.get('guestListAssignments', args.assignmentId);
    if (!assignment || assignment.status !== 'active' || assignment.inviteAttemptId !== args.attemptId || !assignment.pendingTokenDigest) return null;
    const event = await ctx.db.get('events', assignment.eventId);
    return event ? {email: assignment.email, displayName: assignment.displayName, eventTitle: event.title} : null;
  },
});

export const getAssignmentForTicket = internalQuery({
  args: {assignmentId: v.id('guestListAssignments')},
  returns: v.union(v.null(), v.object({eventId: v.id('events')})),
  handler: async (ctx, args) => {
    const assignment = await ctx.db.get('guestListAssignments', args.assignmentId);
    return assignment ? {eventId: assignment.eventId} : null;
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
    const assignment = await ctx.db.get('guestListAssignments', args.assignmentId);
    if (
      !assignment ||
      assignment.status !== 'active' ||
      assignment.inviteAttemptId !== args.attemptId
    ) return false;
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
    const assignment = await ctx.db.get('guestListAssignments', args.assignmentId);
    if (!assignment || assignment.status !== 'active' || assignment.inviteAttemptId !== args.attemptId || !assignment.pendingTokenDigest || !assignment.pendingTokenPrefix) return false;
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

export const failAttempt = internalMutation({
  args: {assignmentId: v.id('guestListAssignments'), attemptId: v.string(), failureCode: v.string()},
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const assignment = await ctx.db.get('guestListAssignments', args.assignmentId);
    if (!assignment || assignment.inviteAttemptId !== args.attemptId) return false;
    await ctx.db.patch('guestListAssignments', assignment._id, {
      pendingTokenDigest: undefined,
      pendingTokenPrefix: undefined,
      inviteState: 'failed',
      inviteFailureCode: args.failureCode.slice(0, 64),
    });
    return true;
  },
});
