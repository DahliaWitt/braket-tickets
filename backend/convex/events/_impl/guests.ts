import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import {throwNotFound} from '../../lib/errors';
import {validateGuestFields} from '../../lib/events/guest_fields';
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

  validateGuestFields(args);

  const guestId = await ctx.db.insert('guests', {
    ...args,
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

  return guestId;
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

export async function markAsEmailed(
  ctx: MutationCtx,
  args: {
    id: Id<'guests'>;
  },
): Promise<null> {
  await ctx.db.patch('guests', args.id, {emailedAt: Date.now()});
  return null;
}
