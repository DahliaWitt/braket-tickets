export const COMMUNITY_PUBLICATION_STATUSES = ['draft', 'published'] as const;
export type CommunityPublicationStatus = typeof COMMUNITY_PUBLICATION_STATUSES[number];
