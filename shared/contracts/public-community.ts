import {v, type Infer} from 'convex/values';
import {COMMUNITY_PUBLICATION_STATUSES} from '@shared/domain/community-publication-status';

/**
 * Public-safe community shape shared between Convex HTTP handlers and the
 * frontend HTTP client.
 */
export const publicCommunityValidator = v.object({
  _id: v.id('organizers'),
  name: v.string(),
  status: v.union(
    v.literal(COMMUNITY_PUBLICATION_STATUSES[0]),
    v.literal(COMMUNITY_PUBLICATION_STATUSES[1]),
  ),
  description: v.optional(v.string()),
  website: v.optional(v.string()),
  slug: v.optional(v.string()),
  logoUrl: v.optional(v.string()),
  codeOfConduct: v.optional(v.string()),
});

export type PublicCommunity = Infer<typeof publicCommunityValidator>;
