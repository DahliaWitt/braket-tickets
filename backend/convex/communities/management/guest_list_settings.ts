import {v} from 'convex/values';
import {mutation, query} from '../../_generated/server';
import {requireManageCommunity} from '../../lib/access';
import {ADMIN_AUDIT_ACTIONS} from '../../lib/admin_audit_actions';
import {insertAdminAuditLog} from '../../lib/admin_audit_log';
import {requireUser} from '../../lib/auth_identity';
import {throwInvalidInput, throwNotFound} from '../../lib/errors';
import {rateLimiter} from '../../lib/rate_limits';

export const DEFAULT_GUEST_LIST_SLOTS = 2;
export const MAX_GUEST_LIST_SLOTS = 100;

const settingsValidator = v.object({
  artistSlots: v.number(),
  staffSlots: v.number(),
});

function validateSlotDefault(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_GUEST_LIST_SLOTS) {
    throwInvalidInput(
      `${label} must be a whole number between 0 and ${MAX_GUEST_LIST_SLOTS}`,
    );
  }
}

export const get = query({
  args: {organizerId: v.id('organizers')},
  returns: settingsValidator,
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await requireManageCommunity(ctx, user._id, args.organizerId);
    const organizer = await ctx.db.get('organizers', args.organizerId);
    if (!organizer) throwNotFound('Community');
    return {
      artistSlots:
        organizer.defaultArtistGuestSlots ?? DEFAULT_GUEST_LIST_SLOTS,
      staffSlots: organizer.defaultStaffGuestSlots ?? DEFAULT_GUEST_LIST_SLOTS,
    };
  },
});

export const update = mutation({
  args: {
    organizerId: v.id('organizers'),
    artistSlots: v.number(),
    staffSlots: v.number(),
  },
  returns: settingsValidator,
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await requireManageCommunity(ctx, user._id, args.organizerId);
    const organizer = await ctx.db.get('organizers', args.organizerId);
    if (!organizer) throwNotFound('Community');
    await rateLimiter.limit(ctx, 'updateOrganizer', {
      key: user._id,
      throws: true,
    });
    validateSlotDefault(args.artistSlots, 'Artist guest slots');
    validateSlotDefault(args.staffSlots, 'Staff guest slots');
    await ctx.db.patch('organizers', args.organizerId, {
      defaultArtistGuestSlots: args.artistSlots,
      defaultStaffGuestSlots: args.staffSlots,
    });
    await insertAdminAuditLog(
      {db: ctx.db, meta: ctx.meta},
      {
        adminId: user._id,
        action: ADMIN_AUDIT_ACTIONS.ORGANIZER_UPDATE,
        organizerId: args.organizerId,
      },
    );
    return {artistSlots: args.artistSlots, staffSlots: args.staffSlots};
  },
});
