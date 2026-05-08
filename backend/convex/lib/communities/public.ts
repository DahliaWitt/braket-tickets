import type {Doc} from '../../_generated/dataModel';
import {isPublishedCommunity} from '../../lib/community_status';

export function isEligibleForPublicDirectory(
  community: Pick<Doc<'organizers'>, 'status' | 'isPublicDirectory'>,
): boolean {
  return isPublishedCommunity(community) && community.isPublicDirectory;
}
