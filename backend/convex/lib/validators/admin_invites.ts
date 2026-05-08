import {v, type Infer} from 'convex/values';
import type {AssertEqual} from '../type_utils';

export const ADMIN_INVITE_STATUSES = [
  'pending',
  'redeemed',
  'cancelled',
] as const;
export type AdminInviteStatus = typeof ADMIN_INVITE_STATUSES[number];

export const adminInviteStatusValidator = v.union(
  v.literal(ADMIN_INVITE_STATUSES[0]),
  v.literal(ADMIN_INVITE_STATUSES[1]),
  v.literal(ADMIN_INVITE_STATUSES[2]),
);

const _adminInviteStatusValidatorMatchesType: AssertEqual<
  Infer<typeof adminInviteStatusValidator>,
  AdminInviteStatus
> = true;
