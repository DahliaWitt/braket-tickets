import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import {
  requireEventForManage,
  resolveGuestListAssignmentAccess,
} from '../access';
import {throwAppError, throwConflict, throwInvalidInput} from '../errors';
import {
  MAX_GUEST_EMAIL_LENGTH,
  MAX_GUEST_NAME_LENGTH,
  normalizeEmailOrNull,
  validateEmail,
  validateRequiredString,
  validateStringLength,
} from '../validation';
import type {GuestListDelegateAccess} from '../access';
import type {GuestListAssignmentAccess} from '../access';
import {MAX_GUEST_LIST_SLOTS} from '../../communities/management/guest_list_settings';
import {internal} from '../../_generated/api';
import {rateLimiter} from '../rate_limits';

type ReadCtx = Pick<QueryCtx, 'db' | 'auth'>;

export function assignmentView(assignment: Doc<'guestListAssignments'>) {
  return {
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
  };
}

export function sourcedGuestView(guest: Doc<'guests'>) {
  if (!guest.email) {
    throw new Error('Self-service guest is missing its required email');
  }
  const deliveryState: 'not_sent' | 'queued' | 'sent' | 'failed' =
    guest.emailedAt ? 'sent' : (guest.ticketDeliveryState ?? 'not_sent');
  return {
    guestId: guest._id,
    name: guest.name,
    email: guest.email,
    emailedAt: guest.emailedAt,
    deliveryState,
  };
}

export function validateGuestListSlots(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_GUEST_LIST_SLOTS) {
    throwInvalidInput(
      `Guest-list slots must be a whole number between 0 and ${MAX_GUEST_LIST_SLOTS}`,
    );
  }
}

export async function linkVerifiedAssignmentIfNeeded(
  ctx: MutationCtx,
  resolved: GuestListAssignmentAccess,
): Promise<void> {
  if (
    resolved.actorKind !== 'signed_in_delegate' ||
    !resolved.actorUserId ||
    resolved.assignment.userId !== undefined
  )
    return;
  await ctx.db.patch('guestListAssignments', resolved.assignment._id, {
    userId: resolved.actorUserId,
    redeemedAt: resolved.assignment.redeemedAt ?? Date.now(),
  });
  await insertAudit(ctx, {
    eventId: resolved.assignment.eventId,
    assignmentId: resolved.assignment._id,
    actorKind: 'signed_in_delegate',
    actorUserId: resolved.actorUserId,
    action: 'assignment.user_link',
  });
}

export function validateAssignmentInput(
  displayName: string,
  email: string,
  grantedSlots?: number,
) {
  const name = displayName.trim();
  const storedEmail = email.trim();
  validateRequiredString(name, 'Name');
  validateStringLength(name, 'Name', MAX_GUEST_NAME_LENGTH);
  validateStringLength(storedEmail, 'Email', MAX_GUEST_EMAIL_LENGTH);
  validateEmail(storedEmail, 'Email');
  const emailKey = normalizeEmailOrNull(storedEmail);
  if (!emailKey) throwInvalidInput('Email is required');
  if (grantedSlots !== undefined) validateGuestListSlots(grantedSlots);
  return {name, storedEmail, emailKey};
}

export async function requireGuestListFeatureEnabled(
  ctx: ReadCtx,
): Promise<void> {
  const state = await ctx.db
    .query('guestListFeatureState')
    .withIndex('by_key', (q) => q.eq('key', 'singleton'))
    .unique();
  if (
    !state?.emailKeyBackfillComplete ||
    !state.guestCountBackfillComplete ||
    state.enabledAt === undefined
  ) {
    throwAppError('UNAVAILABLE', 'Self-service guest lists are unavailable');
  }
}

async function getOrCreateStats(
  ctx: MutationCtx,
  eventId: Id<'events'>,
): Promise<Doc<'guestListEventStats'>> {
  const existing = await ctx.db
    .query('guestListEventStats')
    .withIndex('by_eventId', (q) => q.eq('eventId', eventId))
    .unique();
  if (existing) return existing;
  const existingGuests = await ctx.db
    .query('guests')
    .withIndex('by_event', (q) => q.eq('eventId', eventId))
    .take(5001);
  if (existingGuests.length > 5000) {
    throw new Error(
      'Guest-list event stats initialization exceeds the supported per-event limit of 5000 guests',
    );
  }
  const id = await ctx.db.insert('guestListEventStats', {
    eventId,
    selfServiceGuestCount: 0,
    activeGrantedSlots: 0,
    activeArtistGuestCount: 0,
    activeStaffGuestCount: 0,
    activeAssignmentCount: 0,
    totalGuestAdmissionCount: existingGuests.length,
  });
  const created = await ctx.db.get('guestListEventStats', id);
  if (!created) throw new Error('Failed to create guest-list event stats');
  return created;
}

async function insertAudit(
  ctx: MutationCtx,
  args: Omit<
    Doc<'guestListAuditEvents'>,
    '_id' | '_creationTime' | 'createdAt'
  >,
): Promise<void> {
  await ctx.db.insert('guestListAuditEvents', {...args, createdAt: Date.now()});
}

async function hasValidTicketForAssignment(
  ctx: MutationCtx,
  eventId: Id<'events'>,
  emailKey: string,
  userId?: Id<'users'>,
): Promise<boolean> {
  if (userId) {
    const userTickets = await ctx.db
      .query('tickets')
      .withIndex('by_user_event', (q) =>
        q.eq('userId', userId).eq('eventId', eventId),
      )
      .take(20);
    if (
      userTickets.some(
        (ticket) => ticket.status === 'valid' || ticket.status === 'used',
      )
    ) {
      return true;
    }
  }
  for (const status of ['valid', 'used'] as const) {
    const ticket = await ctx.db
      .query('tickets')
      .withIndex('by_event_and_rosterEmailLower_and_status', (q) =>
        q
          .eq('eventId', eventId)
          .eq('rosterEmailLower', emailKey)
          .eq('status', status),
      )
      .first();
    if (ticket) return true;
  }
  return false;
}

export async function createAssignment(
  ctx: MutationCtx,
  args: {
    eventId: Id<'events'>;
    role: 'artist' | 'staff';
    displayName: string;
    email: string;
    userId?: Id<'users'>;
    grantedSlots?: number;
    idempotencyKey: string;
    skipRateLimit?: boolean;
  },
) {
  const {user: actor, event} = await requireEventForManage(ctx, args.eventId);
  await requireGuestListFeatureEnabled(ctx);
  const replay = await ctx.db
    .query('guestListAssignments')
    .withIndex('by_eventId_and_idempotencyKey', (q) =>
      q.eq('eventId', args.eventId).eq('idempotencyKey', args.idempotencyKey),
    )
    .unique();
  if (replay) return assignmentView(replay);
  if (!args.skipRateLimit) {
    await rateLimiter.limit(ctx, 'guestListAssignmentCreate', {
      key: actor._id,
      throws: true,
    });
  }

  const {name, storedEmail, emailKey} = validateAssignmentInput(
    args.displayName,
    args.email,
    args.grantedSlots,
  );
  const organizer = await ctx.db.get('organizers', event.organizerId);
  if (!organizer)
    throwAppError('UNAVAILABLE', 'Self-service guest lists are unavailable');

  if (args.userId) {
    const selectedUser = await ctx.db.get('users', args.userId);
    if (
      !selectedUser ||
      !selectedUser.authEmailVerified ||
      normalizeEmailOrNull(selectedUser.email) !== emailKey
    ) {
      throwInvalidInput('Selected member does not match the verified email');
    }
  }

  const duplicate = await ctx.db
    .query('guestListAssignments')
    .withIndex('by_eventId_and_emailKey_and_status', (q) =>
      q
        .eq('eventId', args.eventId)
        .eq('emailKey', emailKey)
        .eq('status', 'active'),
    )
    .unique();
  if (duplicate)
    throwConflict('An active assignment already exists for this email');

  const grantedSlots =
    args.grantedSlots ??
    (args.role === 'artist'
      ? (organizer.defaultArtistGuestSlots ?? 2)
      : (organizer.defaultStaffGuestSlots ?? 2));
  validateGuestListSlots(grantedSlots);
  const now = Date.now();
  const assignmentId = await ctx.db.insert('guestListAssignments', {
    eventId: args.eventId,
    organizerId: event.organizerId,
    role: args.role,
    displayName: name,
    email: storedEmail,
    emailKey,
    eventDate: event.date,
    userId: args.userId,
    grantedSlots,
    usedSlots: 0,
    status: 'active',
    inviteState: 'pending',
    inviteAttemptId: args.idempotencyKey,
    createdBy: actor._id,
    createdAt: now,
    invitedAt: now,
    idempotencyKey: args.idempotencyKey,
  });

  let admissionGuestId: Id<'guests'> | undefined;
  const [validTicket, existingGuest] = await Promise.all([
    hasValidTicketForAssignment(ctx, args.eventId, emailKey, args.userId),
    ctx.db
      .query('guests')
      .withIndex('by_event_and_emailKey', (q) =>
        q.eq('eventId', args.eventId).eq('emailKey', emailKey),
      )
      .first(),
  ]);
  // Initialize the event snapshot before inserting the admission. Otherwise a
  // first assignment's admission is included in the lazy snapshot and then
  // incremented again below, double-counting the dashboard total.
  const stats = await getOrCreateStats(ctx, args.eventId);
  if (!validTicket && !existingGuest) {
    admissionGuestId = await ctx.db.insert('guests', {
      eventId: args.eventId,
      name,
      email: storedEmail,
      emailKey,
      type: args.role === 'artist' ? 'artist guest' : 'staff',
      sourceAssignmentId: assignmentId,
      sourceKind: 'assignment_admission',
      sourceRole: args.role,
      sourceDisplayName: name,
      ticketDeliveryState: 'queued',
    });
    await ctx.db.patch('guestListAssignments', assignmentId, {
      admissionGuestId,
    });
  }

  await ctx.db.patch('guestListEventStats', stats._id, {
    activeGrantedSlots: stats.activeGrantedSlots + grantedSlots,
    activeAssignmentCount: stats.activeAssignmentCount + 1,
    totalGuestAdmissionCount:
      stats.totalGuestAdmissionCount + (admissionGuestId ? 1 : 0),
  });
  await insertAudit(ctx, {
    eventId: args.eventId,
    assignmentId,
    actorKind: 'organizer',
    actorUserId: actor._id,
    action: 'assignment.create',
    afterValue: grantedSlots,
  });
  await ctx.scheduler.runAfter(
    0,
    internal.guest_list.invites.sendInviteAttempt,
    {
      assignmentId,
      attemptId: args.idempotencyKey,
    },
  );
  if (admissionGuestId) {
    await ctx.scheduler.runAfter(
      0,
      internal.events.guest_actions.sendAutomaticTicket,
      {
        guestId: admissionGuestId,
      },
    );
  }
  const assignment = await ctx.db.get('guestListAssignments', assignmentId);
  if (!assignment) throw new Error('Assignment disappeared after creation');
  return assignmentView(assignment);
}

export async function addDelegateGuest(
  ctx: MutationCtx,
  args: {
    access: GuestListDelegateAccess;
    name: string;
    email: string;
    idempotencyKey: string;
  },
) {
  await requireGuestListFeatureEnabled(ctx);
  const resolved = await resolveGuestListAssignmentAccess(ctx, args.access);
  if (!resolved) throwAppError('UNAVAILABLE', 'Guest list is unavailable');
  const {assignment, actorKind, actorUserId} = resolved;
  await linkVerifiedAssignmentIfNeeded(ctx, resolved);
  const replay = await ctx.db
    .query('guests')
    .withIndex('by_sourceAssignmentId_and_sourceIdempotencyKey', (q) =>
      q
        .eq('sourceAssignmentId', assignment._id)
        .eq('sourceIdempotencyKey', args.idempotencyKey),
    )
    .unique();
  if (replay) {
    return {
      guest: sourcedGuestView(replay),
      usedSlots: assignment.usedSlots,
      grantedSlots: assignment.grantedSlots,
    };
  }
  await rateLimiter.limit(ctx, 'guestListDelegateAdd', {
    key: actorUserId ?? assignment.tokenPrefix ?? assignment._id,
    throws: true,
  });
  if (assignment.usedSlots >= assignment.grantedSlots) {
    throwAppError('QUOTA_FULL', 'No guest-list slots remain');
  }
  const {name, storedEmail, emailKey} = validateAssignmentInput(
    args.name,
    args.email,
  );
  const guestId = await ctx.db.insert('guests', {
    eventId: assignment.eventId,
    name,
    email: storedEmail,
    emailKey,
    type: 'guest',
    sourceAssignmentId: assignment._id,
    sourceKind: 'self_service',
    sourceRole: assignment.role,
    sourceDisplayName: assignment.displayName,
    sourceIdempotencyKey: args.idempotencyKey,
    ticketDeliveryState: 'queued',
  });
  const usedSlots = assignment.usedSlots + 1;
  await ctx.db.patch('guestListAssignments', assignment._id, {usedSlots});
  const stats = await getOrCreateStats(ctx, assignment.eventId);
  await ctx.db.patch('guestListEventStats', stats._id, {
    selfServiceGuestCount: stats.selfServiceGuestCount + 1,
    totalGuestAdmissionCount: stats.totalGuestAdmissionCount + 1,
    ...(assignment.role === 'artist'
      ? {activeArtistGuestCount: stats.activeArtistGuestCount + 1}
      : {activeStaffGuestCount: stats.activeStaffGuestCount + 1}),
  });
  await insertAudit(ctx, {
    eventId: assignment.eventId,
    assignmentId: assignment._id,
    actorKind,
    actorUserId,
    action: 'guest.add',
    beforeValue: assignment.usedSlots,
    afterValue: usedSlots,
  });
  await ctx.scheduler.runAfter(
    0,
    internal.events.guest_actions.sendAutomaticTicket,
    {
      guestId,
    },
  );
  const guest = await ctx.db.get('guests', guestId);
  if (!guest) throw new Error('Guest disappeared after creation');
  return {
    guest: sourcedGuestView(guest),
    usedSlots,
    grantedSlots: assignment.grantedSlots,
  };
}

export async function revokeAssignment(
  ctx: MutationCtx,
  assignmentId: Id<'guestListAssignments'>,
) {
  const assignment = await ctx.db.get('guestListAssignments', assignmentId);
  if (!assignment) throwAppError('UNAVAILABLE', 'Guest list is unavailable');
  const {user} = await requireEventForManage(ctx, assignment.eventId);
  await requireGuestListFeatureEnabled(ctx);
  if (assignment.status === 'revoked') {
    return {
      assignmentId,
      status: 'revoked' as const,
      retainedGuestCount: assignment.usedSlots,
    };
  }
  const now = Date.now();
  await ctx.db.patch('guestListAssignments', assignmentId, {
    status: 'revoked',
    revokedAt: now,
    revokedBy: user._id,
    tokenDigest: undefined,
    tokenPrefix: undefined,
    pendingTokenDigest: undefined,
    pendingTokenPrefix: undefined,
  });
  const stats = await getOrCreateStats(ctx, assignment.eventId);
  await ctx.db.patch('guestListEventStats', stats._id, {
    activeGrantedSlots: Math.max(
      0,
      stats.activeGrantedSlots - assignment.grantedSlots,
    ),
    activeAssignmentCount: Math.max(0, stats.activeAssignmentCount - 1),
    ...(assignment.role === 'artist'
      ? {
          activeArtistGuestCount: Math.max(
            0,
            stats.activeArtistGuestCount - assignment.usedSlots,
          ),
        }
      : {
          activeStaffGuestCount: Math.max(
            0,
            stats.activeStaffGuestCount - assignment.usedSlots,
          ),
        }),
  });
  await insertAudit(ctx, {
    eventId: assignment.eventId,
    assignmentId,
    actorKind: 'organizer',
    actorUserId: user._id,
    action: 'assignment.revoke',
    beforeValue: assignment.usedSlots,
    afterValue: assignment.usedSlots,
  });
  return {
    assignmentId,
    status: 'revoked' as const,
    retainedGuestCount: assignment.usedSlots,
  };
}

export async function updateDelegateGuest(
  ctx: MutationCtx,
  args: {
    access: GuestListDelegateAccess;
    guestId: Id<'guests'>;
    name: string;
    email: string;
  },
) {
  await requireGuestListFeatureEnabled(ctx);
  const resolved = await resolveGuestListAssignmentAccess(ctx, args.access);
  if (!resolved) throwAppError('UNAVAILABLE', 'Guest list is unavailable');
  await linkVerifiedAssignmentIfNeeded(ctx, resolved);
  await rateLimiter.limit(ctx, 'guestListDelegateEdit', {
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
  ) {
    throwAppError('UNAVAILABLE', 'Guest list is unavailable');
  }
  const {name, storedEmail, emailKey} = validateAssignmentInput(
    args.name,
    args.email,
  );
  const emailChanged = guest.emailKey !== emailKey;
  await ctx.db.patch('guests', guest._id, {
    name,
    email: storedEmail,
    emailKey,
    ...(emailChanged
      ? {
          emailedAt: undefined,
          emailSendLockedAt: null,
          ticketDeliveryState: 'queued' as const,
        }
      : {}),
  });
  await insertAudit(ctx, {
    eventId: resolved.assignment.eventId,
    assignmentId: resolved.assignment._id,
    actorKind: resolved.actorKind,
    actorUserId: resolved.actorUserId,
    action: 'guest.edit',
    beforeValue: resolved.assignment.usedSlots,
    afterValue: resolved.assignment.usedSlots,
  });
  if (emailChanged) {
    await ctx.scheduler.runAfter(
      0,
      internal.events.guest_actions.sendAutomaticTicket,
      {
        guestId: guest._id,
      },
    );
  }
  const updated = await ctx.db.get('guests', guest._id);
  if (!updated) throw new Error('Guest disappeared after update');
  return {
    guest: sourcedGuestView(updated),
    usedSlots: resolved.assignment.usedSlots,
    grantedSlots: resolved.assignment.grantedSlots,
  };
}

export async function removeSourcedGuestAndUpdateCounters(
  ctx: MutationCtx,
  args: {
    guest: Doc<'guests'>;
    actorKind: 'organizer' | 'signed_in_delegate' | 'token_delegate';
    actorUserId?: Id<'users'>;
  },
): Promise<number> {
  const assignmentId = args.guest.sourceAssignmentId;
  if (!assignmentId || args.guest.sourceKind !== 'self_service') {
    await ctx.db.delete('guests', args.guest._id);
    return 0;
  }
  const assignment = await ctx.db.get('guestListAssignments', assignmentId);
  if (!assignment) {
    await ctx.db.delete('guests', args.guest._id);
    return 0;
  }
  const usedSlots = Math.max(0, assignment.usedSlots - 1);
  await ctx.db.delete('guests', args.guest._id);
  await ctx.db.patch('guestListAssignments', assignmentId, {usedSlots});
  const stats = await ctx.db
    .query('guestListEventStats')
    .withIndex('by_eventId', (q) => q.eq('eventId', assignment.eventId))
    .unique();
  if (stats) {
    await ctx.db.patch('guestListEventStats', stats._id, {
      selfServiceGuestCount: Math.max(0, stats.selfServiceGuestCount - 1),
      totalGuestAdmissionCount: Math.max(0, stats.totalGuestAdmissionCount - 1),
      ...(assignment.status === 'active'
        ? assignment.role === 'artist'
          ? {
              activeArtistGuestCount: Math.max(
                0,
                stats.activeArtistGuestCount - 1,
              ),
            }
          : {
              activeStaffGuestCount: Math.max(
                0,
                stats.activeStaffGuestCount - 1,
              ),
            }
        : {}),
    });
  }
  await insertAudit(ctx, {
    eventId: assignment.eventId,
    assignmentId,
    actorKind: args.actorKind,
    actorUserId: args.actorUserId,
    action: 'guest.remove',
    beforeValue: assignment.usedSlots,
    afterValue: usedSlots,
  });
  return usedSlots;
}

export async function removeDelegateGuest(
  ctx: MutationCtx,
  args: {access: GuestListDelegateAccess; guestId: Id<'guests'>},
) {
  await requireGuestListFeatureEnabled(ctx);
  const resolved = await resolveGuestListAssignmentAccess(ctx, args.access);
  if (!resolved) throwAppError('UNAVAILABLE', 'Guest list is unavailable');
  await linkVerifiedAssignmentIfNeeded(ctx, resolved);
  await rateLimiter.limit(ctx, 'guestListDelegateRemove', {
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
  ) {
    throwAppError('UNAVAILABLE', 'Guest list is unavailable');
  }
  const usedSlots = await removeSourcedGuestAndUpdateCounters(ctx, {
    guest,
    actorKind: resolved.actorKind,
    actorUserId: resolved.actorUserId,
  });
  return {removed: true, usedSlots};
}
