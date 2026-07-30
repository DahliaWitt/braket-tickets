import {paginationOptsValidator} from 'convex/server';
import {v} from 'convex/values';
import {action, internalMutation, mutation} from '../_generated/server';
import {requireUser} from '../lib/auth_identity';
import {throwAppError} from '../lib/errors';
import {resolveGuestListAssignmentAccess} from '../lib/access';
import {
  guestListDelegateAccessValidator,
  guestListDelegateViewValidator,
  guestListMinePageValidator,
  sourcedGuestViewValidator,
} from '../lib/guest_list/validators';
import {
  addDelegateGuest,
  assignmentView,
  requireGuestListFeatureEnabled,
  sourcedGuestView,
  removeDelegateGuest,
  updateDelegateGuest,
  linkVerifiedAssignmentIfNeeded,
  linkGuestListAssignmentToVerifiedUser,
} from '../lib/guest_list/core';
import {normalizeEmailOrNull} from '../lib/validation';
import {hasEventEnded} from '../lib/timezone';
import {internal} from '../_generated/api';
import {rateLimiter} from '../lib/rate_limits';
import {tokenPrefix} from '../lib/token_digests';
import {isValidBearerTokenShape} from '../lib/token_digests';
import {ongoingEventStartLowerBound} from '../lib/timezone';
import {isGuestTicketSendInFlight} from '../lib/guest_ticket_delivery';

const unavailable = (): never =>
  throwAppError('UNAVAILABLE', 'Self-service guest lists are unavailable');

const neutralStatusValidator = v.object({
  status: v.union(v.literal('available'), v.literal('unavailable')),
});

// A bounded server-side lookahead prevents a page of cancelled/ended events
// from hiding a later current assignment. The returned cursor still advances
// after the final inspected database page, so clients can continue if all five
// pages were filtered out.
const MAX_LIST_MINE_FILTERED_PAGES = 5;

export const authorizeToken = mutation({
  args: {token: v.string()},
  returns: neutralStatusValidator,
  handler: async (ctx, args) => {
    try {
      const rate = await rateLimiter.limit(ctx, 'guestListTokenResolve', {
        key: tokenPrefix(args.token),
        throws: false,
      });
      if (!rate.ok) return {status: 'unavailable' as const};
      if (!isValidBearerTokenShape(args.token)) {
        return {status: 'unavailable' as const};
      }
      await requireGuestListFeatureEnabled(ctx);
      const resolved = await resolveGuestListAssignmentAccess(ctx, {
        kind: 'token',
        token: args.token,
      });
      return {
        status: resolved ? ('available' as const) : ('unavailable' as const),
      };
    } catch {
      return {status: 'unavailable' as const};
    }
  },
});

export const claimSignedIn = mutation({
  args: {assignmentId: v.id('guestListAssignments')},
  returns: neutralStatusValidator,
  handler: async (ctx, args) => {
    try {
      await requireGuestListFeatureEnabled(ctx);
      const resolved = await resolveGuestListAssignmentAccess(ctx, {
        kind: 'signedIn',
        assignmentId: args.assignmentId,
      });
      if (!resolved) return {status: 'unavailable' as const};
      await linkVerifiedAssignmentIfNeeded(ctx, resolved);
      return {status: 'available' as const};
    } catch {
      return {status: 'unavailable' as const};
    }
  },
});

export const listMine = mutation({
  args: {paginationOpts: paginationOptsValidator},
  returns: guestListMinePageValidator,
  handler: async (ctx, args) => {
    await requireGuestListFeatureEnabled(ctx);
    const user = await requireUser(ctx);
    const lowerBound = ongoingEventStartLowerBound();
    const emailKey = user.authEmailVerified
      ? normalizeEmailOrNull(user.email)
      : null;
    if (emailKey) {
      const unlinked = await ctx.db
        .query('guestListAssignments')
        .withIndex('by_emailKey_and_status_and_userId_and_eventDate', (q) =>
          q
            .eq('emailKey', emailKey)
            .eq('status', 'active')
            .eq('userId', undefined)
            .gte('eventDate', lowerBound),
        )
        .take(100);
      for (const assignment of unlinked) {
        await linkGuestListAssignmentToVerifiedUser(ctx, assignment, user._id);
      }
    }
    const numItems = Math.min(args.paginationOpts.numItems, 50);
    let cursor = args.paginationOpts.cursor;
    for (
      let inspectedPages = 0;
      inspectedPages < MAX_LIST_MINE_FILTERED_PAGES;
      inspectedPages += 1
    ) {
      const page = await ctx.db
        .query('guestListAssignments')
        .withIndex('by_userId_and_status_and_eventDate', (q) =>
          q
            .eq('userId', user._id)
            .eq('status', 'active')
            .gte('eventDate', lowerBound),
        )
        .paginate({numItems, cursor});
      const events = await Promise.all(
        page.page.map((assignment) => ctx.db.get('events', assignment.eventId)),
      );
      const items = page.page.flatMap((assignment, index) => {
        const event = events[index];
        if (!event || event.status === 'cancelled' || hasEventEnded(event))
          return [];
        return [
          {
            assignmentId: assignment._id,
            eventId: assignment.eventId,
            eventTitle: event.title,
            eventDate: event.date,
            eventEndDate: event.endDate,
            role: assignment.role,
            grantedSlots: assignment.grantedSlots,
            usedSlots: assignment.usedSlots,
          },
        ];
      });
      if (items.length > 0 || page.isDone) {
        return {
          page: items,
          isDone: page.isDone,
          continueCursor: page.continueCursor,
        };
      }
      cursor = page.continueCursor;
    }
    return {page: [], isDone: false, continueCursor: cursor ?? ''};
  },
});

export const getViewInternal = internalMutation({
  args: {
    access: guestListDelegateAccessValidator,
    paginationOpts: paginationOptsValidator,
  },
  returns: guestListDelegateViewValidator,
  handler: async (ctx, args) => {
    try {
      if (args.access.kind === 'token') {
        const rate = await rateLimiter.limit(ctx, 'guestListTokenResolve', {
          key: tokenPrefix(args.access.token),
          throws: false,
        });
        if (!rate.ok) return {status: 'unavailable' as const};
        if (!isValidBearerTokenShape(args.access.token)) {
          return {status: 'unavailable' as const};
        }
      }
      await requireGuestListFeatureEnabled(ctx);
      const resolved = await resolveGuestListAssignmentAccess(ctx, args.access);
      if (!resolved) return {status: 'unavailable' as const};
      const page = await ctx.db
        .query('guests')
        .withIndex('by_sourceAssignmentId_and_sourceKind', (q) =>
          q
            .eq('sourceAssignmentId', resolved.assignment._id)
            .eq('sourceKind', 'self_service'),
        )
        .paginate(args.paginationOpts);
      return {
        status: 'available' as const,
        assignment: assignmentView(resolved.assignment),
        event: {
          title: resolved.event.title,
          date: resolved.event.date,
          endDate: resolved.event.endDate,
          location: resolved.event.location,
        },
        guests: {...page, page: page.page.map(sourcedGuestView)},
      };
    } catch {
      return {status: 'unavailable' as const};
    }
  },
});

export const getView = action({
  args: {
    access: guestListDelegateAccessValidator,
    paginationOpts: paginationOptsValidator,
  },
  returns: guestListDelegateViewValidator,
  handler: async (ctx, args) =>
    await ctx.runMutation(internal.guest_list.delegate.getViewInternal, args),
});

export const addGuest = mutation({
  args: {
    access: guestListDelegateAccessValidator,
    name: v.string(),
    email: v.string(),
    idempotencyKey: v.string(),
  },
  returns: v.object({
    guest: sourcedGuestViewValidator,
    usedSlots: v.number(),
    grantedSlots: v.number(),
  }),
  handler: addDelegateGuest,
});

export const updateGuest = mutation({
  args: {
    access: guestListDelegateAccessValidator,
    guestId: v.id('guests'),
    name: v.string(),
    email: v.string(),
  },
  returns: v.object({
    guest: sourcedGuestViewValidator,
    usedSlots: v.number(),
    grantedSlots: v.number(),
  }),
  handler: updateDelegateGuest,
});

export const removeGuest = mutation({
  args: {
    access: guestListDelegateAccessValidator,
    guestId: v.id('guests'),
  },
  returns: v.object({removed: v.boolean(), usedSlots: v.number()}),
  handler: removeDelegateGuest,
});

export const retryTicket = mutation({
  args: {
    access: guestListDelegateAccessValidator,
    guestId: v.id('guests'),
  },
  returns: v.object({
    status: v.union(
      v.literal('queued'),
      v.literal('alreadySent'),
      v.literal('inFlight'),
    ),
  }),
  handler: async (ctx, args) => {
    await requireGuestListFeatureEnabled(ctx);
    const resolved = await resolveGuestListAssignmentAccess(ctx, args.access);
    if (!resolved) return unavailable();
    await linkVerifiedAssignmentIfNeeded(ctx, resolved);
    await rateLimiter.limit(ctx, 'guestListDelegateRetry', {
      key:
        resolved.actorUserId ??
        resolved.assignment.tokenPrefix ??
        resolved.assignment._id,
      throws: true,
    });
    const guest = await ctx.db.get('guests', args.guestId);
    if (
      !guest ||
      guest.sourceAssignmentId !== resolved.assignment._id ||
      guest.sourceKind !== 'self_service'
    )
      return unavailable();
    if (guest.emailedAt !== undefined) return {status: 'alreadySent' as const};
    if (isGuestTicketSendInFlight(guest.emailSendLockedAt))
      return {status: 'inFlight' as const};
    await ctx.db.patch('guests', guest._id, {ticketDeliveryState: 'queued'});
    await ctx.scheduler.runAfter(
      0,
      internal.events.guest_actions.sendAutomaticTicket,
      {guestId: guest._id},
    );
    return {status: 'queued' as const};
  },
});
