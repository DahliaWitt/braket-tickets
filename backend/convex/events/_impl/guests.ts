import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import {scheduleBroadcastCatchup} from '../../lib/broadcast_catchup';
import {internal} from '../../_generated/api';
import {
  throwConflict,
  throwInvalidInput,
  throwNotFound,
} from '../../lib/errors';
import {validateGuestFieldsAndNormalizeEmail} from '../../lib/events/guest_fields';
import {validateEmail, normalizeEmailOrNull} from '../../lib/validation';
import {requireEventForEdit, requireEventForRoster} from '../../lib/access';
import {ADMIN_AUDIT_ACTIONS} from '../../lib/admin_audit_actions';
import {insertAdminAuditLog} from '../../lib/admin_audit_log';
import {loadManagementDatasetWithinLimit} from '../../lib/management_limits';
import {removeSourcedGuestAndUpdateCounters} from '../../lib/guest_list/core';
import {
  assertGuestAdmissionCapacity,
  getExistingGuestListEventStats,
  getOrCreateGuestListEventStats,
  updateGuestListEventStatsAfterReduction,
  updateGuestListEventStats,
} from '../../lib/guest_list/event_stats';
import {isGuestTicketSendInFlight} from '../../lib/guest_ticket_delivery';

export {GUEST_TICKET_SEND_LOCK_STALE_MS} from '../../lib/guest_ticket_delivery';

export async function add(
  ctx: MutationCtx,
  args: {
    eventId: Id<'events'>;
    name: string;
    email?: string;
    type: Doc<'guests'>['type'];
    notes?: string;
  },
): Promise<Id<'guests'>> {
  const {user, event} = await requireEventForEdit(ctx, args.eventId);

  // Validate all fields and get the trimmed email. The guest paths apply the
  // shared lenient `@`-presence rule (not the strict RFC regex) so unusual but
  // valid addresses the admin UI accepts are not rejected here; trimming keeps
  // the stored value aligned with scheduling and broadcast audience lookups.
  const email = validateGuestFieldsAndNormalizeEmail(args);

  // Persist the trimmed, validated email so the stored record matches the
  // value used by scheduling and the broadcast audience lookups downstream.
  //
  // The counter row is materialized on demand: `guest_list.getEventOverview`
  // reports zeros when it is absent, so an event whose only guests were added
  // manually must still get one. The first manual add for an event therefore
  // pays a one-time authoritative count (<=5,001 guests + <=501 assignments).
  const stats = await getOrCreateGuestListEventStats(ctx, args.eventId);
  assertGuestAdmissionCapacity(stats, 1);
  const guestId = await ctx.db.insert('guests', {
    ...args,
    email,
    emailKey: email?.toLowerCase(),
  });
  await updateGuestListEventStats(ctx, stats, (current) => ({
    totalGuestAdmissionCount: current.totalGuestAdmissionCount + 1,
  }));

  await insertAdminAuditLog(
    {db: ctx.db, meta: ctx.meta},
    {
      adminId: user._id,
      action: ADMIN_AUDIT_ACTIONS.GUEST_ADD,
      eventId: args.eventId,
      organizerId: event.organizerId,
      reason: args.name,
      source: 'admin-ui',
    },
  );

  // A late-added guest joins the broadcast audience after any prior sends;
  // catch them up on anything already sent.
  await scheduleBroadcastCatchup(ctx, {
    eventId: args.eventId,
    email,
  });

  return guestId;
}

export async function update(
  ctx: MutationCtx,
  args: {
    id: Id<'guests'>;
    name: string;
    email?: string;
    type: Doc<'guests'>['type'];
    notes?: string;
  },
): Promise<null> {
  const guest = await ctx.db.get('guests', args.id);
  if (!guest) throwNotFound('Guest');

  const {user, event} = await requireEventForEdit(ctx, guest.eventId);

  // Validate all fields and get the trimmed email, matching guests.add so an
  // update cannot persist an untrimmed value that would drift from what
  // scheduling and broadcast audience lookups use downstream. Uses the shared
  // lenient `@`-presence email rule the guest paths deliberately apply.
  const email = validateGuestFieldsAndNormalizeEmail(args);

  // Both guest-list-sourced kinds carry an automatic ticket delivery:
  // `self_service` rows are a delegate's invited guest, `assignment_admission`
  // rows are the artist's/staff member's OWN admission. Either way a corrected
  // address means the ticket that was already dispatched went somewhere wrong,
  // so the delivery state must reset and a fresh attempt must be queued.
  // Scoping this to `self_service` stranded admission rows: `emailedAt`
  // survived, `ticketDeliveryState` stayed `sent`, no send was queued, and
  // `guest_list/delegate.retryTicket` refuses non-`self_service` rows — leaving
  // no retry path at all.
  const isSourcedGuest =
    guest.sourceAssignmentId !== undefined && guest.sourceKind !== undefined;
  if (isSourcedGuest) {
    if (!email) throwInvalidInput('Email is required');
    validateEmail(email, 'Email');
  }
  const emailKey = email?.toLowerCase();
  const emailChanged = guest.emailKey !== emailKey;
  const resetTicketDelivery = isSourcedGuest && emailChanged;
  await ctx.db.replace('guests', args.id, {
    eventId: guest.eventId,
    name: args.name,
    email,
    emailKey,
    type: args.type,
    notes: args.notes,
    emailedAt: resetTicketDelivery ? undefined : guest.emailedAt,
    checkedInAt: guest.checkedInAt,
    checkedInBy: guest.checkedInBy,
    emailSendLockedAt: resetTicketDelivery ? null : guest.emailSendLockedAt,
    ticketDeliveryState: resetTicketDelivery
      ? 'queued'
      : guest.ticketDeliveryState,
    sourceAssignmentId: guest.sourceAssignmentId,
    sourceKind: guest.sourceKind,
    sourceRole: guest.sourceRole,
    sourceDisplayName: guest.sourceDisplayName,
    sourceIdempotencyKey: guest.sourceIdempotencyKey,
  });

  if (resetTicketDelivery) {
    await ctx.scheduler.runAfter(
      0,
      internal.events.guest_actions.sendAutomaticTicket,
      {
        guestId: guest._id,
      },
    );
  }

  await insertAdminAuditLog(
    {db: ctx.db, meta: ctx.meta},
    {
      adminId: user._id,
      action: ADMIN_AUDIT_ACTIONS.GUEST_UPDATE,
      eventId: guest.eventId,
      organizerId: event.organizerId,
      reason: args.name,
      source: 'admin-ui',
    },
  );

  return null;
}

export async function remove(
  ctx: MutationCtx,
  args: {
    id: Id<'guests'>;
  },
): Promise<null> {
  const guest = await ctx.db.get('guests', args.id);
  if (!guest) throwNotFound('Guest');

  const {user} = await requireEventForEdit(ctx, guest.eventId);

  let admissionAssignment: Doc<'guestListAssignments'> | null = null;
  if (guest.sourceAssignmentId && guest.sourceKind === 'assignment_admission') {
    admissionAssignment = await ctx.db.get(
      'guestListAssignments',
      guest.sourceAssignmentId,
    );
    if (
      admissionAssignment?.status === 'active' &&
      admissionAssignment.admissionGuestId === guest._id
    ) {
      throwConflict('Cannot remove an active assignment admission');
    }
  }

  if (guest.sourceAssignmentId && guest.sourceKind === 'self_service') {
    await removeSourcedGuestAndUpdateCounters(ctx, {
      guest,
      actorKind: 'organizer',
      actorUserId: user._id,
    });
  } else {
    const stats = await getExistingGuestListEventStats(ctx, guest.eventId);
    if (admissionAssignment?.admissionGuestId === guest._id) {
      await ctx.db.patch('guestListAssignments', admissionAssignment._id, {
        admissionGuestId: undefined,
      });
    }
    await ctx.db.delete('guests', args.id);
    await updateGuestListEventStatsAfterReduction(
      ctx,
      guest.eventId,
      stats,
      (current) => ({
        totalGuestAdmissionCount: Math.max(
          0,
          current.totalGuestAdmissionCount - 1,
        ),
      }),
    );
  }
  return null;
}

export async function listByEvent(
  ctx: QueryCtx,
  args: {
    eventId: Id<'events'>;
  },
): Promise<Doc<'guests'>[]> {
  await requireEventForRoster(ctx, args.eventId);

  return await loadManagementDatasetWithinLimit({
    dataset: 'guests',
    load: (limit) =>
      ctx.db
        .query('guests')
        .withIndex('by_event', (q) => q.eq('eventId', args.eventId))
        .take(limit),
  });
}

export async function getInternal(
  ctx: QueryCtx,
  args: {
    id: Id<'guests'>;
  },
): Promise<Doc<'guests'> | null> {
  return await ctx.db.get('guests', args.id);
}

export type BeginGuestTicketSendResult = {
  claimed: boolean;
  reason: 'claimed' | 'already_sent' | 'in_flight' | 'not_found';
  /**
   * Ownership token for the claim — the timestamp written to
   * `emailSendLockedAt`. Only the holder may release the lock, so an older
   * attempt that resumes after the stale window cannot clear a newer
   * reclaimed lock. `null` when the claim was not granted. The timestamp is a
   * sound token because a reclaim only happens once the prior lock is stale
   * (>5 min old), so the owner's and a reclaimer's tokens can never collide.
   */
  lockToken: number | null;
};

/**
 * Atomically claims the right to send a guest's ticket email so concurrent
 * admins/tabs cannot double-send.
 *
 * Two guards, because they cover different windows:
 * - The in-flight lock (`emailSendLockedAt`) serializes racing claims; since
 *   mutations are transactional, only one of any set wins and the losers are
 *   turned away `in_flight`. It expires (staleness) so a crashed send self-heals.
 * - For batch "send all" (`requireUnsent`), the guest is also skipped if a
 *   durable delivery record already exists OR `emailedAt` is set. The delivery
 *   record is written inside the send action the moment the provider accepts
 *   the email, so it closes the window where delivery succeeded but the
 *   post-send `emailedAt` write failed or the action crashed — the lock alone
 *   cannot, because it expires. A genuinely failed delivery records no delivery
 *   row, so it stays retryable (at-least-once for failures, no duplicates).
 *
 * Single resends pass `requireUnsent: false`: a deliberate resend bypasses both
 * the delivery-record and `emailedAt` checks and is gated only by the lock.
 */
export async function beginGuestTicketSend(
  ctx: MutationCtx,
  args: {
    id: Id<'guests'>;
    requireUnsent: boolean;
  },
): Promise<BeginGuestTicketSendResult> {
  const guest = await ctx.db.get('guests', args.id);
  if (!guest) return {claimed: false, reason: 'not_found', lockToken: null};

  if (args.requireUnsent) {
    if (guest.emailedAt !== undefined) {
      return {claimed: false, reason: 'already_sent', lockToken: null};
    }
    const alreadyDelivered = await ctx.runQuery(
      internal.email.email_delivery.hasDelivery,
      {
        source: 'ticket',
        sourceId: args.id,
        ...(guest.email ? {recipient: guest.email} : {}),
      },
    );
    if (alreadyDelivered) {
      if (guest.sourceAssignmentId && guest.ticketDeliveryState !== 'sent') {
        await ctx.db.patch('guests', args.id, {ticketDeliveryState: 'sent'});
      }
      return {claimed: false, reason: 'already_sent', lockToken: null};
    }
  }

  const now = Date.now();
  const lockedAt = guest.emailSendLockedAt;
  if (isGuestTicketSendInFlight(lockedAt, now)) {
    return {claimed: false, reason: 'in_flight', lockToken: null};
  }

  await ctx.db.patch('guests', args.id, {
    emailSendLockedAt: now,
    ...(guest.sourceAssignmentId
      ? {ticketDeliveryState: 'queued' as const}
      : {}),
  });
  return {claimed: true, reason: 'claimed', lockToken: now};
}

/**
 * Pre-dispatch revalidation for the organizer-initiated ("Resend") send path.
 *
 * `beginGuestTicketSend` claims the lock, then the action spends seconds
 * building the PDF. During that window a guest-list email correction
 * (`guests.update` / `delegate.updateGuest`) deliberately releases the lock so
 * the corrected address gets a fresh automatic attempt. Without this recheck
 * the already-claimed resend would still dispatch to the address the delegate
 * just removed — two emails, one to a stale recipient. `markAsEmailed`'s
 * recipient guard keeps the row consistent afterwards, but cannot un-send.
 *
 * Returns true only while this attempt still owns the lock AND the recipient it
 * snapshotted is still the guest's current address. The automatic path has its
 * own equivalent gate (`canDeliverAutomaticTicket`), which additionally
 * validates the assignment linkage.
 */
export async function isGuestTicketSendCurrent(
  ctx: QueryCtx,
  args: {
    id: Id<'guests'>;
    lockToken: number;
    recipient: string;
  },
): Promise<boolean> {
  const guest = await ctx.db.get('guests', args.id);
  if (!guest) return false;
  if (guest.emailSendLockedAt !== args.lockToken) return false;
  const currentEmailKey =
    guest.emailKey ?? normalizeEmailOrNull(guest.email ?? '');
  return normalizeEmailOrNull(args.recipient) === currentEmailKey;
}

/**
 * Records a successful send when it still targets the guest's current email.
 * A late success for a corrected address must not mark the new recipient as
 * sent. The lock is only released when this attempt still owns it, so a send
 * that resumed after being stale-reclaimed cannot clear the newer holder's
 * lock.
 */
export async function markAsEmailed(
  ctx: MutationCtx,
  args: {
    id: Id<'guests'>;
    lockToken: number;
    recipient?: string;
  },
): Promise<null> {
  const guest = await ctx.db.get('guests', args.id);
  if (!guest) return null;
  const currentEmailKey =
    guest.emailKey ?? normalizeEmailOrNull(guest.email ?? '');
  const recipientStillMatches =
    args.recipient === undefined ||
    normalizeEmailOrNull(args.recipient) === currentEmailKey;
  await ctx.db.patch('guests', args.id, {
    ...(recipientStillMatches
      ? {
          emailedAt: Date.now(),
          ...(guest.sourceAssignmentId
            ? {ticketDeliveryState: 'sent' as const}
            : {}),
        }
      : {}),
    ...(guest.emailSendLockedAt === args.lockToken
      ? {emailSendLockedAt: null}
      : {}),
  });
  return null;
}

/**
 * Releases the in-flight send lock without marking the guest emailed. Called on
 * the failure path so a failed send can be retried immediately instead of
 * waiting out the staleness window. Only clears the lock when this attempt
 * still owns it (`emailSendLockedAt === lockToken`), so an older attempt cannot
 * release a newer reclaimed lock. `null` (not `undefined`) is used to keep a
 * released lock distinguishable from a never-claimed one (absent field) — see
 * the schema doc for `guests.emailSendLockedAt`. (`ctx.db.patch` would remove
 * the field entirely if set to `undefined`.)
 */
export async function clearGuestTicketSendLock(
  ctx: MutationCtx,
  args: {
    id: Id<'guests'>;
    lockToken: number;
  },
): Promise<null> {
  const guest = await ctx.db.get('guests', args.id);
  if (guest && guest.emailSendLockedAt === args.lockToken) {
    await ctx.db.patch('guests', args.id, {emailSendLockedAt: null});
  }
  return null;
}

/** Marks an assignment-triggered automatic ticket attempt as retryable. */
export async function markGuestTicketSendFailed(
  ctx: MutationCtx,
  args: {id: Id<'guests'>; lockToken: number},
): Promise<null> {
  const guest = await ctx.db.get('guests', args.id);
  if (guest && guest.emailSendLockedAt === args.lockToken) {
    await ctx.db.patch('guests', args.id, {
      emailSendLockedAt: null,
      ...(guest.sourceAssignmentId
        ? {ticketDeliveryState: 'failed' as const}
        : {}),
    });
  }
  return null;
}
