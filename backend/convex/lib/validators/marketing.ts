import {v, type Infer} from 'convex/values';
import type {AssertEqual} from '../type_utils';

export const audienceScopeValidator = v.union(
  v.literal('community'),
  v.literal('community_and_trusted'),
);
export type AudienceScope = 'community' | 'community_and_trusted';

const _audienceScopeValidatorMatchesType: AssertEqual<
  Infer<typeof audienceScopeValidator>,
  AudienceScope
> = true;

export const MARKETING_EMAIL_STATUSES = [
  'scheduled',
  'sent',
  'cancelled',
] as const;
export type MarketingEmailStatus = typeof MARKETING_EMAIL_STATUSES[number];

export const marketingEmailStatusValidator = v.union(
  v.literal(MARKETING_EMAIL_STATUSES[0]),
  v.literal(MARKETING_EMAIL_STATUSES[1]),
  v.literal(MARKETING_EMAIL_STATUSES[2]),
);

const _marketingEmailStatusValidatorMatchesType: AssertEqual<
  Infer<typeof marketingEmailStatusValidator>,
  MarketingEmailStatus
> = true;
