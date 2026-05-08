import type {EventStatus} from '@shared/domain/event-status';
import type {Id} from '../../_generated/dataModel';
import type {QueryCtx} from '../../_generated/server';
import {isPublishedCommunity} from '../../lib/community_status';
import {throwInvalidState} from '../../lib/errors';

/**
 * Throws if the event's parent community is in draft mode.
 * Only checks when the event status would be 'published'.
 *
 * Uses Pick<QueryCtx['db'], 'get'> so it accepts narrow db adapters.
 */
export async function assertCommunityNotDraft(
  db: Pick<QueryCtx['db'], 'get'>,
  organizerId: Id<'organizers'>,
  eventStatus: EventStatus,
): Promise<void> {
  if (eventStatus !== 'published') return;

  const organizer = await db.get('organizers', organizerId);
  if (organizer && !isPublishedCommunity(organizer)) {
    throwInvalidState(
      'Cannot publish an event while the community is in draft mode',
    );
  }
}
