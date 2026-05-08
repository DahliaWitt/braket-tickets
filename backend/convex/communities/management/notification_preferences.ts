import {v} from 'convex/values';
import {query, mutation} from '../../_generated/server';
import {adminNotificationPreferenceModeValidator} from '../../lib/validators/admin_notification_preferences';
import {
  getMyNotificationPreference as getMyNotificationPreferenceImpl,
  setMyNotificationPreference as setMyNotificationPreferenceImpl,
} from './_impl/notification_preferences';

export const getMyNotificationPreference = query({
  args: {organizerId: v.id('organizers')},
  returns: v.union(
    v.null(),
    v.object({
      mode: adminNotificationPreferenceModeValidator,
      digestHour: v.number(),
    }),
  ),
  handler: getMyNotificationPreferenceImpl,
});

export const setMyNotificationPreference = mutation({
  args: {
    organizerId: v.id('organizers'),
    mode: v.union(adminNotificationPreferenceModeValidator, v.literal('off')),
    digestHour: v.optional(v.number()),
  },
  returns: v.null(),
  handler: setMyNotificationPreferenceImpl,
});
