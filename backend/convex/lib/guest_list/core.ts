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
import {
  DEFAULT_GUEST_LIST_SLOTS,
  MAX_GUEST_LIST_SLOTS,
} from '../../communities/management/guest_list_settings';
import {internal} from '../../_generated/api';
import {rateLimiter} from '../rate_limits';
import {getIdempotencyKeyValidationError} from '../idempotency';
import {lookupUserByNormalizedEmail} from '../auth_helpers';
import {requireGuestListEventActive} from './lifecycle';
import {
  assertActiveAssignmentCapacity,
  assertGuestAdmissionCapacity,
  getExistingGuestListEventStats,
  getOrCreateGuestListEventStats,
  updateGuestListEventStatsAfterReduction,
  updateGuestListEventStats,
} from './event_stats';

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

export function assertValidGuestListIdempotencyKey(
  value: string,
  label = 'Idempotency key',
): void {
  const error = getIdempotencyKeyValidationError(value, label);
  if (error) throwInvalidInput(error);
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
  await linkGuestListAssignmentToVerifiedUser(
    ctx,
    resolved.assignment,
    resolved.actorUserId,
  );
}

export async function linkGuestListAssignmentToVerifiedUser(
  ctx: MutationCtx,
  assignment: Doc<'guestListAssignments'>,
  userId: Id<'users'>,
): Promise<void> {
  if (assignment.userId !== undefined) return;
  await ctx.db.patch('guestListAssignments', assignment._id, {
    userId,
    redeemedAt: assignment.redeemedAt ?? Date.now(),
  });
  await insertAudit(ctx, {
    eventId: assignment.eventId,
    assignmentId: assignment._id,
    actorKind: 'signed_in_delegate',
    actorUserId: userId,
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

/**
 * Single audit-write shape for every guest-list action. All callers — including
 * the registered mutations in `guest_list/assignments.ts` — must route through
 * this helper so the stamped `createdAt` and the closed action union stay
 * consistent across the feature.
 */
export async function insertAudit(
  ctx: MutationCtx,
  args: Omit<
    Doc<'guestListAuditEvents'>,
    '_id' | '_creationTime' | 'createdAt'
  >,
): Promise<void> {
  await ctx.db.insert('guestListAuditEvents', {...args, createdAt: Date.now()});
}

/**
 * Bounded number of recent resend idempotency keys retained per assignment.
 *
 * Remembering only the most recent key lets an out-of-order replay of an
 * earlier key mint a third credential and a third email, so a short history is
 * required.
 */
export const MAX_TRACKED_RESEND_IDEMPOTENCY_KEYS = 5;

export function appendRecentResendIdempotencyKey(
  stored: readonly string[] | undefined,
  key: string,
): string[] {
  return [key, ...(stored ?? []).filter((existing) => existing !== key)].slice(
    0,
    MAX_TRACKED_RESEND_IDEMPOTENCY_KEYS,
  );
}

async function hasTicketForUser(
  ctx: MutationCtx,
  eventId: Id<'events'>,
  userId: Id<'users'>,
): Promise<boolean> {
  for (const status of ['valid', 'used'] as const) {
    const ticket = await ctx.db
      .query('tickets')
      .withIndex('by_userId_and_eventId_and_status', (q) =>
        q.eq('userId', userId).eq('eventId', eventId).eq('status', status),
      )
      .first();
    if (ticket) return true;
  }
  return false;
}

async function hasValidTicketForAssignment(
  ctx: MutationCtx,
  eventId: Id<'events'>,
  emailKey: string,
  userId?: Id<'users'>,
): Promise<boolean> {
  if (userId && (await hasTicketForUser(ctx, eventId, userId))) return true;
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
  // `rosterEmailLower` is only written by `lib/ticket_roster_projection.ts` on
  // ticket create/update and no migration backfills it, so tickets issued
  // before the projection shipped are invisible to the roster-email rule above.
  // When the invite carries no selected `userId` that legacy ticket would be
  // missed entirely and the delegate would receive a duplicate admission plus a
  // second ticket email. Resolving the verified account for the normalized
  // email keeps the fallback to two point lookups on existing indexes (users
  // `email`, then `by_userId_and_eventId_and_status`) with no scan.
  const {user} = await lookupUserByNormalizedEmail(ctx, emailKey);
  if (!user || user._id === userId || !user.authEmailVerified) return false;
  return await hasTicketForUser(ctx, eventId, user._id);
}

/**
 * Organizer-authorized context shared by every assignment write in one
 * transaction. Resolving it once keeps bulk staff creation to a single
 * authorization component round-trip, feature-state read, lifecycle check, and
 * organizer read instead of repeating all four per row.
 */
export type GuestListAssignmentContext = {
  actor: Doc<'users'>;
  event: Doc<'events'>;
  organizer: Doc<'organizers'>;
};

export async function resolveGuestListAssignmentContext(
  ctx: MutationCtx,
  eventId: Id<'events'>,
): Promise<GuestListAssignmentContext> {
  const {user: actor, event} = await requireEventForManage(ctx, eventId);
  await requireGuestListFeatureEnabled(ctx);
  requireGuestListEventActive(event);
  const organizer = await ctx.db.get('organizers', event.organizerId);
  if (!organizer) {
    return throwAppError(
      'UNAVAILABLE',
      'Self-service guest lists are unavailable',
    );
  }
  return {actor, event, organizer};
}

export type CreateAssignmentArgs = {
  role: 'artist' | 'staff';
  displayName: string;
  email: string;
  userId?: Id<'users'>;
  grantedSlots?: number;
  idempotencyKey: string;
  skipRateLimit?: boolean;
};

export async function createAssignment(
  ctx: MutationCtx,
  args: CreateAssignmentArgs & {eventId: Id<'events'>},
) {
  assertValidGuestListIdempotencyKey(args.idempotencyKey);
  const context = await resolveGuestListAssignmentContext(ctx, args.eventId);
  return await createAssignmentWithContext(ctx, context, args);
}

/**
 * Creates one assignment against an already-authorized
 * {@link GuestListAssignmentContext}. Authorization is not weakened: the
 * caller must have resolved the context through
 * {@link resolveGuestListAssignmentContext}, which performs the manage check,
 * the feature-state gate, and the event lifecycle gate.
 */
export async function createAssignmentWithContext(
  ctx: MutationCtx,
  context: GuestListAssignmentContext,
  args: CreateAssignmentArgs,
) {
  const {actor, event, organizer} = context;
  const eventId = event._id;
  const replay = await ctx.db
    .query('guestListAssignments')
    .withIndex('by_eventId_and_idempotencyKey', (q) =>
      q.eq('eventId', eventId).eq('idempotencyKey', args.idempotencyKey),
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
      q.eq('eventId', eventId).eq('emailKey', emailKey).eq('status', 'active'),
    )
    .unique();
  if (duplicate)
    throwConflict('An active assignment already exists for this email');

  const grantedSlots =
    args.grantedSlots ??
    (args.role === 'artist'
      ? (organizer.defaultArtistGuestSlots ?? DEFAULT_GUEST_LIST_SLOTS)
      : (organizer.defaultStaffGuestSlots ?? DEFAULT_GUEST_LIST_SLOTS));
  validateGuestListSlots(grantedSlots);
  const stats = await getOrCreateGuestListEventStats(ctx, eventId);
  assertActiveAssignmentCapacity(stats);
  const [validTicket, existingGuest] = await Promise.all([
    hasValidTicketForAssignment(ctx, eventId, emailKey, args.userId),
    ctx.db
      .query('guests')
      .withIndex('by_event_and_emailKey', (q) =>
        q.eq('eventId', eventId).eq('emailKey', emailKey),
      )
      .first(),
  ]);
  const needsAdmission = !validTicket && !existingGuest;
  if (needsAdmission) {
    assertGuestAdmissionCapacity(stats, 1);
  }
  // Re-inviting a revoked identity reuses the admission row the revoked
  // assignment created. Without re-attribution the new active assignment would
  // carry no `admissionGuestId` while the guest row still pointed at the
  // revoked assignment, so `events/_impl/guests.ts` `remove` would happily
  // delete the admission the active assignment now depends on.
  const reusableAdmission =
    !validTicket &&
    existingGuest?.sourceKind === 'assignment_admission' &&
    existingGuest.sourceAssignmentId !== undefined
      ? existingGuest
      : null;
  const priorAdmissionAssignment = reusableAdmission?.sourceAssignmentId
    ? await ctx.db.get(
        'guestListAssignments',
        reusableAdmission.sourceAssignmentId,
      )
    : null;
  const reattributedAdmission =
    reusableAdmission &&
    (!priorAdmissionAssignment || priorAdmissionAssignment.status === 'revoked')
      ? reusableAdmission
      : null;
  const now = Date.now();
  const assignmentId = await ctx.db.insert('guestListAssignments', {
    eventId,
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
  let insertedAdmission = false;
  if (needsAdmission) {
    insertedAdmission = true;
    admissionGuestId = await ctx.db.insert('guests', {
      eventId,
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
  } else if (reattributedAdmission) {
    // Pure re-attribution of an existing row: no insert, so admission counters
    // stay untouched. The delegate's name/email on the guest row are left as
    // they are so an organizer correction and its recipient-scoped delivery
    // state survive the re-invite.
    admissionGuestId = reattributedAdmission._id;
    await ctx.db.patch('guests', reattributedAdmission._id, {
      sourceAssignmentId: assignmentId,
      sourceRole: args.role,
      sourceDisplayName: name,
    });
    await ctx.db.patch('guestListAssignments', assignmentId, {
      admissionGuestId,
    });
    if (
      priorAdmissionAssignment &&
      priorAdmissionAssignment.admissionGuestId === reattributedAdmission._id
    ) {
      await ctx.db.patch('guestListAssignments', priorAdmissionAssignment._id, {
        admissionGuestId: undefined,
      });
    }
  }

  await updateGuestListEventStats(ctx, stats, (current) => ({
    activeGrantedSlots: current.activeGrantedSlots + grantedSlots,
    activeAssignmentCount: current.activeAssignmentCount + 1,
    totalGuestAdmissionCount:
      current.totalGuestAdmissionCount + (insertedAdmission ? 1 : 0),
  }));
  await insertAudit(ctx, {
    eventId,
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
  // Only a freshly inserted admission is scheduled. A re-attributed row already
  // ran (or is still running) its own delivery, so re-scheduling would risk a
  // duplicate ticket email for the same guest.
  if (insertedAdmission && admissionGuestId) {
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
  assertValidGuestListIdempotencyKey(args.idempotencyKey);
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
  const stats = await getOrCreateGuestListEventStats(ctx, assignment.eventId);
  assertGuestAdmissionCapacity(stats, 1);
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
  await updateGuestListEventStats(ctx, stats, (current) => ({
    selfServiceGuestCount: current.selfServiceGuestCount + 1,
    totalGuestAdmissionCount: current.totalGuestAdmissionCount + 1,
    ...(assignment.role === 'artist'
      ? {activeArtistGuestCount: current.activeArtistGuestCount + 1}
      : {activeStaffGuestCount: current.activeStaffGuestCount + 1}),
  }));
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

/**
 * Revokes an assignment and permanently invalidates its credentials.
 *
 * Deliberately NOT gated on {@link requireGuestListFeatureEnabled}. Disabling
 * the feature flag is the containment lever ops reaches for when a management
 * link leaks, and every read/write path a delegate could use is already dead
 * behind that gate. If revocation were gated too, flipping the kill switch
 * would leave the organizer unable to permanently invalidate the leaked
 * credential — the one operation that must survive the flag. Organizer
 * authorization is still required.
 *
 * `retainedGuestCount` reports the assignment's live `usedSlots`, i.e. the
 * number of self-service guests currently retained under this assignment — not
 * a snapshot frozen at revocation time. Removing a retained guest decrements
 * `usedSlots` through the shared removal helper, so a later replayed revoke
 * reports the smaller, still-correct current count. Accuracy is preferred over
 * stability here because the value is used to tell the organizer how many
 * guests remain, and freezing it would require a new persisted field that would
 * immediately drift from the guest rows it describes.
 */
export async function revokeAssignment(
  ctx: MutationCtx,
  assignmentId: Id<'guestListAssignments'>,
) {
  const assignment = await ctx.db.get('guestListAssignments', assignmentId);
  if (!assignment) throwAppError('UNAVAILABLE', 'Guest list is unavailable');
  const {user} = await requireEventForManage(ctx, assignment.eventId);
  if (assignment.status === 'revoked') {
    return {
      assignmentId,
      status: 'revoked' as const,
      retainedGuestCount: assignment.usedSlots,
    };
  }
  const stats = await getExistingGuestListEventStats(ctx, assignment.eventId);
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
  await updateGuestListEventStatsAfterReduction(
    ctx,
    assignment.eventId,
    stats,
    (current) => ({
      activeGrantedSlots: Math.max(
        0,
        current.activeGrantedSlots - assignment.grantedSlots,
      ),
      activeAssignmentCount: Math.max(0, current.activeAssignmentCount - 1),
      ...(assignment.role === 'artist'
        ? {
            activeArtistGuestCount: Math.max(
              0,
              current.activeArtistGuestCount - assignment.usedSlots,
            ),
          }
        : {
            activeStaffGuestCount: Math.max(
              0,
              current.activeStaffGuestCount - assignment.usedSlots,
            ),
          }),
    }),
  );
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
  const stats = await getExistingGuestListEventStats(ctx, args.guest.eventId);
  if (!assignmentId || args.guest.sourceKind !== 'self_service') {
    await ctx.db.delete('guests', args.guest._id);
    await updateGuestListEventStatsAfterReduction(
      ctx,
      args.guest.eventId,
      stats,
      (current) => ({
        totalGuestAdmissionCount: Math.max(
          0,
          current.totalGuestAdmissionCount - 1,
        ),
      }),
    );
    return 0;
  }
  const assignment = await ctx.db.get('guestListAssignments', assignmentId);
  if (!assignment) {
    await ctx.db.delete('guests', args.guest._id);
    await updateGuestListEventStatsAfterReduction(
      ctx,
      args.guest.eventId,
      stats,
      (current) => ({
        selfServiceGuestCount: Math.max(0, current.selfServiceGuestCount - 1),
        totalGuestAdmissionCount: Math.max(
          0,
          current.totalGuestAdmissionCount - 1,
        ),
      }),
    );
    return 0;
  }
  const usedSlots = Math.max(0, assignment.usedSlots - 1);
  await ctx.db.delete('guests', args.guest._id);
  await ctx.db.patch('guestListAssignments', assignmentId, {usedSlots});
  await updateGuestListEventStatsAfterReduction(
    ctx,
    args.guest.eventId,
    stats,
    (current) => ({
      selfServiceGuestCount: Math.max(0, current.selfServiceGuestCount - 1),
      totalGuestAdmissionCount: Math.max(
        0,
        current.totalGuestAdmissionCount - 1,
      ),
      ...(assignment.status === 'active'
        ? assignment.role === 'artist'
          ? {
              activeArtistGuestCount: Math.max(
                0,
                current.activeArtistGuestCount - 1,
              ),
            }
          : {
              activeStaffGuestCount: Math.max(
                0,
                current.activeStaffGuestCount - 1,
              ),
            }
        : {}),
    }),
  );
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
