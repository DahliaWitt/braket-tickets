import type {CommunityPublicationStatus} from '@shared/domain/community-publication-status';
import type {Doc} from '../_generated/dataModel';

/**
 * Canonical publication status for a community.
 *
 * `status` is optional on the `organizers` schema. Legacy organizers predating
 * the status field are treated as `published` — see
 * `migrations/community_status_backfill.ts`, which backfills those rows. All
 * publication-aware logic MUST route through this helper (or
 * {@link isPublishedCommunity}) so the rule stays in one place.
 *
 * This lives in a dedicated file (rather than in `lib/access.ts`) to avoid a
 * circular import between `lib/authz.ts` and `lib/access.ts`; both need to
 * consult the publication rule but `access.ts` already depends on `authz.ts`.
 */
export function derivePublicationStatus(
  community: Pick<Doc<'organizers'>, 'status'>,
): CommunityPublicationStatus {
  return community.status ?? 'published';
}

/**
 * Whether a community is in the `published` state.
 *
 * Prefer this over raw `status !== 'draft'` — it handles the legacy-undefined
 * case identically to {@link derivePublicationStatus}.
 */
export function isPublishedCommunity(
  community: Pick<Doc<'organizers'>, 'status'>,
): boolean {
  return derivePublicationStatus(community) === 'published';
}
