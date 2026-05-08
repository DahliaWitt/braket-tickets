import type {Id} from '../../../_generated/dataModel';
import type {MutationCtx, QueryCtx} from '../../../_generated/server';
import {requireUser} from '../../../lib/auth_identity';
import {canManageCommunity} from '../../../lib/access';
import {throwAppError} from '../../../lib/errors';
import type {AdminNotificationPreferenceMode} from '../../../lib/validators/admin_notification_preferences';

const DEFAULT_DIGEST_HOUR = 9;

export async function getMyNotificationPreference(
  ctx: QueryCtx,
  args: {
    organizerId: Id<'organizers'>;
  },
): Promise<
  | null
  | {
      mode: AdminNotificationPreferenceMode;
      digestHour: number;
    }
> {
  const {_id: userId} = await requireUser(ctx);

  const hasCommunityAdminAccess = await canManageCommunity(
    ctx,
    userId,
    args.organizerId,
  );
  if (!hasCommunityAdminAccess) {
    throwAppError('FORBIDDEN', 'Not a community admin');
  }

  const pref = await ctx.db
    .query('adminNotificationPreferences')
    .withIndex('by_user_and_community', (q) =>
      q.eq('userId', userId).eq('organizerId', args.organizerId),
    )
    .first();

  if (!pref) return null;
  return {mode: pref.mode, digestHour: pref.digestHour};
}

export async function setMyNotificationPreference(
  ctx: MutationCtx,
  args: {
    organizerId: Id<'organizers'>;
    mode: AdminNotificationPreferenceMode | 'off';
    digestHour?: number;
  },
): Promise<null> {
  const {_id: userId} = await requireUser(ctx);

  const hasCommunityAdminAccess = await canManageCommunity(
    ctx,
    userId,
    args.organizerId,
  );
  if (!hasCommunityAdminAccess) {
    throwAppError('FORBIDDEN', 'Not a community admin');
  }

  if (args.digestHour !== undefined) {
    if (
      !Number.isInteger(args.digestHour) ||
      args.digestHour < 0 ||
      args.digestHour > 23
    ) {
      throwAppError('INVALID_INPUT', 'digestHour must be an integer 0–23');
    }
  }

  const existing = await ctx.db
    .query('adminNotificationPreferences')
    .withIndex('by_user_and_community', (q) =>
      q.eq('userId', userId).eq('organizerId', args.organizerId),
    )
    .first();

  if (args.mode === 'off') {
    if (existing) {
      await ctx.db.delete('adminNotificationPreferences', existing._id);
    }
    return null;
  }

  const digestHour = args.digestHour ?? DEFAULT_DIGEST_HOUR;

  if (existing) {
    await ctx.db.patch('adminNotificationPreferences', existing._id, {
      mode: args.mode,
      digestHour,
    });
  } else {
    await ctx.db.insert('adminNotificationPreferences', {
      userId,
      organizerId: args.organizerId,
      mode: args.mode,
      digestHour,
    });
  }

  return null;
}
