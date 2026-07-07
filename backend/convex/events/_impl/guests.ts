import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import {scheduleBroadcastCatchup} from '../../lib/broadcast_catchup';
import {internal} from '../../_generated/api';
import {throwNotFound} from '../../lib/errors';
import {
  validateEmail,
  validateRequiredString,
  validateStringLength,
  MAX_GUEST_NAME_LENGTH,
  MAX_GUEST_EMAIL_LENGTH,
  MAX_GUEST_NOTES_LENGTH,
} from '../../lib/validation';
import {requireEventForEdit, requireEventForRoster} from '../../lib/access';
import {ADMIN_AUDIT_ACTIONS} from '../../lib/admin_audit_actions';
import {insertAdminAuditLog} from '../../lib/admin_audit_log';
import {loadManagementDatasetWithinLimit} from '../../lib/management_limits';

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

  validateRequiredString(args.name, 'Name');
  validateStringLength(args.name, 'Name', MAX_GUEST_NAME_LENGTH);
  validateStringLength(args.email, 'Email', MAX_GUEST_EMAIL_LENGTH);
  validateStringLength(args.notes, 'Notes', MAX_GUEST_NOTES_LENGTH);

  // The admin UI trims and requires a plausible address before submitting;
  // enforce the same here so direct API calls cannot enqueue broadcast
  // sends (immediate or catch-up) to non-address strings.
  const trimmedEmail = args.email?.trim();
  if (trimmedEmail) {
    validateEmail(trimmedEmail, 'Email');
  }

  // Persist the trimmed, validated email so the stored record matches the
  // value used by scheduling and the broadcast audience lookups downstream.
  const guestId = await ctx.db.insert('guests', {
    ...args,
    email: trimmedEmail || undefined,
  });

  await insertAdminAuditLog(
    {db: ctx.db},
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
    email: trimmedEmail,
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

  validateRequiredString(args.name, 'Name');
  validateStringLength(args.name, 'Name', MAX_GUEST_NAME_LENGTH);
  validateStringLength(args.email, 'Email', MAX_GUEST_EMAIL_LENGTH);
  validateStringLength(args.notes, 'Notes', MAX_GUEST_NOTES_LENGTH);

  await ctx.db.replace('guests', args.id, {
    eventId: guest.eventId,
    name: args.name,
    email: args.email,
    type: args.type,
    notes: args.notes,
    emailedAt: guest.emailedAt,
    checkedInAt: guest.checkedInAt,
    checkedInBy: guest.checkedInBy,
  });

  await insertAdminAuditLog(
    {db: ctx.db},
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

  await requireEventForEdit(ctx, guest.eventId);

  await ctx.db.delete('guests', args.id);
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

/**
 * How long a guest ticket-email send lock is honored before it is treated as
 * abandoned. A normal send (PDF build + email dispatch) completes in seconds; a
 * lock older than this only survives when the send action crashed between
 * claiming and releasing, so reclaiming it lets a retry proceed. Kept well above
 * realistic send latency so a genuinely in-flight send is never stolen.
 */
export const GUEST_TICKET_SEND_LOCK_STALE_MS = 5 * 60 * 1000;

export type BeginGuestTicketSendResult = {
  claimed: boolean;
  reason: 'claimed' | 'already_sent' | 'in_flight' | 'not_found';
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
  if (!guest) return {claimed: false, reason: 'not_found'};

  if (args.requireUnsent) {
    if (guest.emailedAt !== undefined) {
      return {claimed: false, reason: 'already_sent'};
    }
    const alreadyDelivered = await ctx.runQuery(
      internal.email.email_delivery.hasDelivery,
      {source: 'ticket', sourceId: args.id},
    );
    if (alreadyDelivered) {
      return {claimed: false, reason: 'already_sent'};
    }
  }

  const now = Date.now();
  const lockedAt = guest.emailSendLockedAt;
  if (
    typeof lockedAt === 'number' &&
    now - lockedAt < GUEST_TICKET_SEND_LOCK_STALE_MS
  ) {
    return {claimed: false, reason: 'in_flight'};
  }

  await ctx.db.patch('guests', args.id, {emailSendLockedAt: now});
  return {claimed: true, reason: 'claimed'};
}

export async function markAsEmailed(
  ctx: MutationCtx,
  args: {
    id: Id<'guests'>;
  },
): Promise<null> {
  await ctx.db.patch('guests', args.id, {
    emailedAt: Date.now(),
    emailSendLockedAt: null,
  });
  return null;
}

/**
 * Releases the in-flight send lock without marking the guest emailed. Called on
 * the failure path so a failed send can be retried immediately instead of
 * waiting out the staleness window. `null` (not `undefined`) is used because
 * `ctx.db.patch` does not clear fields set to `undefined` in this codebase.
 */
export async function clearGuestTicketSendLock(
  ctx: MutationCtx,
  args: {
    id: Id<'guests'>;
  },
): Promise<null> {
  await ctx.db.patch('guests', args.id, {emailSendLockedAt: null});
  return null;
}
