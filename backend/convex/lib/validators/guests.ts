import {v, type Infer} from 'convex/values';
import type {AssertEqual} from '../type_utils';

export const GUEST_TYPES = ['guest', 'artist guest', 'staff'] as const;
export type GuestType = (typeof GUEST_TYPES)[number];

export const guestTypeValidator = v.union(
  v.literal(GUEST_TYPES[0]),
  v.literal(GUEST_TYPES[1]),
  v.literal(GUEST_TYPES[2]),
);

const _guestTypeValidatorMatchesType: AssertEqual<
  Infer<typeof guestTypeValidator>,
  GuestType
> = true;
