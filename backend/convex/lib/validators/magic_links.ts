import {v, type Infer} from 'convex/values';
import type {AssertEqual} from '../type_utils';

export const MAGIC_LINK_STATUSES = ['active', 'paused', 'disabled'] as const;
export type MagicLinkStatus = typeof MAGIC_LINK_STATUSES[number];

export const magicLinkStatusValidator = v.union(
  v.literal(MAGIC_LINK_STATUSES[0]),
  v.literal(MAGIC_LINK_STATUSES[1]),
  v.literal(MAGIC_LINK_STATUSES[2]),
);

const _magicLinkStatusValidatorMatchesType: AssertEqual<
  Infer<typeof magicLinkStatusValidator>,
  MagicLinkStatus
> = true;

export const MAGIC_LINK_VALIDATION_ERRORS = [
  'invalid',
  'paused',
  'disabled',
  'expired',
  'maxed',
] as const;
export type MagicLinkValidationError =
  typeof MAGIC_LINK_VALIDATION_ERRORS[number];

export const magicLinkValidationErrorValidator = v.union(
  v.literal(MAGIC_LINK_VALIDATION_ERRORS[0]),
  v.literal(MAGIC_LINK_VALIDATION_ERRORS[1]),
  v.literal(MAGIC_LINK_VALIDATION_ERRORS[2]),
  v.literal(MAGIC_LINK_VALIDATION_ERRORS[3]),
  v.literal(MAGIC_LINK_VALIDATION_ERRORS[4]),
);

const _magicLinkValidationErrorValidatorMatchesType: AssertEqual<
  Infer<typeof magicLinkValidationErrorValidator>,
  MagicLinkValidationError
> = true;
