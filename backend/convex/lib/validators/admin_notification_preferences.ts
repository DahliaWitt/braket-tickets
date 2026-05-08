import {v, type Infer} from 'convex/values';
import type {AssertEqual} from '../type_utils';

export const ADMIN_NOTIFICATION_PREFERENCE_MODES = ['all', 'digest'] as const;
export type AdminNotificationPreferenceMode =
  typeof ADMIN_NOTIFICATION_PREFERENCE_MODES[number];

export const adminNotificationPreferenceModeValidator = v.union(
  v.literal(ADMIN_NOTIFICATION_PREFERENCE_MODES[0]),
  v.literal(ADMIN_NOTIFICATION_PREFERENCE_MODES[1]),
);

const _adminNotificationPreferenceModeValidatorMatchesType: AssertEqual<
  Infer<typeof adminNotificationPreferenceModeValidator>,
  AdminNotificationPreferenceMode
> = true;
