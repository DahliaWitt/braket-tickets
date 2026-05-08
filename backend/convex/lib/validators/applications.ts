import {v, type Infer} from 'convex/values';
import {
  APPLICATION_STATUSES,
  type ApplicationStatus as SharedApplicationStatus,
} from '@shared/domain/application-status';
import type {AssertEqual} from '../type_utils';

export type ApplicationStatus = SharedApplicationStatus;

export const applicationStatusValidator = v.union(
  v.literal(APPLICATION_STATUSES[0]),
  v.literal(APPLICATION_STATUSES[1]),
  v.literal(APPLICATION_STATUSES[2]),
  v.literal(APPLICATION_STATUSES[3]),
);

export const applicationAnswersValidator = v.record(
  v.string(),
  v.union(v.string(), v.array(v.string()), v.boolean(), v.number()),
);

const _applicationStatusValidatorMatchesShared: AssertEqual<
  Infer<typeof applicationStatusValidator>,
  SharedApplicationStatus
> = true;
