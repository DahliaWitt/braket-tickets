import {v, type Infer} from 'convex/values';
import type {AssertEqual} from '../type_utils';

export const EMAIL_DELIVERY_SOURCES = [
  'announcement',
  'broadcast',
  'digest',
  'reminder',
  'application',
  'admin_invite',
  'event',
  'ticket',
  'payout',
  'resale_available',
  'auth',
] as const;
export type EmailDeliverySource = typeof EMAIL_DELIVERY_SOURCES[number];

export const emailDeliverySourceValidator = v.union(
  v.literal(EMAIL_DELIVERY_SOURCES[0]),
  v.literal(EMAIL_DELIVERY_SOURCES[1]),
  v.literal(EMAIL_DELIVERY_SOURCES[2]),
  v.literal(EMAIL_DELIVERY_SOURCES[3]),
  v.literal(EMAIL_DELIVERY_SOURCES[4]),
  v.literal(EMAIL_DELIVERY_SOURCES[5]),
  v.literal(EMAIL_DELIVERY_SOURCES[6]),
  v.literal(EMAIL_DELIVERY_SOURCES[7]),
  v.literal(EMAIL_DELIVERY_SOURCES[8]),
  v.literal(EMAIL_DELIVERY_SOURCES[9]),
  v.literal(EMAIL_DELIVERY_SOURCES[10]),
);

const _emailDeliverySourceValidatorMatchesType: AssertEqual<
  Infer<typeof emailDeliverySourceValidator>,
  EmailDeliverySource
> = true;
