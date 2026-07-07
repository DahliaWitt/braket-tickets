import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import {throwNotFound} from '../../lib/errors';
import {
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

export async function markAsEmailed(
  ctx: MutationCtx,
  args: {
    id: Id<'guests'>;
  },
): Promise<null> {
  await ctx.db.patch('guests', args.id, {emailedAt: Date.now()});
  return null;
}
