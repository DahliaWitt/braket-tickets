import {v, type Infer} from 'convex/values';
import {
  COMMUNITY_PUBLICATION_STATUSES,
  type CommunityPublicationStatus as SharedCommunityPublicationStatus,
} from '@shared/domain/community-publication-status';
import type {AssertEqual} from '../type_utils';

export type CommunityPublicationStatus = SharedCommunityPublicationStatus;

export const ORGANIZER_DIRECTORY_JOB_STATUSES = ['queued', 'running'] as const;
export type OrganizerDirectoryJobStatus =
  typeof ORGANIZER_DIRECTORY_JOB_STATUSES[number];

export const communityPublicationStatusValueValidator = v.union(
  v.literal(COMMUNITY_PUBLICATION_STATUSES[0]),
  v.literal(COMMUNITY_PUBLICATION_STATUSES[1]),
);

export const communityPublicationStatusValidator = v.optional(
  communityPublicationStatusValueValidator,
);

const _communityPublicationStatusValidatorMatchesShared: AssertEqual<
  Infer<typeof communityPublicationStatusValueValidator>,
  SharedCommunityPublicationStatus
> = true;

export const organizerDirectoryJobStatusValidator = v.union(
  v.literal(ORGANIZER_DIRECTORY_JOB_STATUSES[0]),
  v.literal(ORGANIZER_DIRECTORY_JOB_STATUSES[1]),
);

const _organizerDirectoryJobStatusValidatorMatchesType: AssertEqual<
  Infer<typeof organizerDirectoryJobStatusValidator>,
  OrganizerDirectoryJobStatus
> = true;
