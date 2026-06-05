import type {Doc, Id} from '../../_generated/dataModel';
import type {ActionCtx} from '../../_generated/server';
import {internal} from '../../_generated/api';
import {
  throwAppError,
  throwNotFound,
  throwUnauthenticated,
  throwUnauthorized,
} from '../../lib/errors';

type GuestWithEmail = Doc<'guests'> & {email: string};

export async function requireGuestTicketSendAccess(
  ctx: Pick<ActionCtx, 'runQuery'>,
  guestId: Id<'guests'>,
): Promise<GuestWithEmail> {
  const userId = await ctx.runQuery(
    internal.lib.auth_helpers.getAuthUserIdInternal,
    {},
  );
  if (!userId) throwUnauthenticated();

  const guest = await ctx.runQuery(internal.events.guests.getInternal, {
    id: guestId,
  });
  if (!guest) throwNotFound('Guest');
  if (!guest.email)
    throwAppError('INVALID_STATE', 'Guest has no email provided');
  const guestWithEmail: GuestWithEmail = {...guest, email: guest.email};

  const isEventAdmin = await ctx.runQuery(internal.lib.access._isEventAdmin, {
    userId,
    eventId: guest.eventId,
  });
  if (!isEventAdmin) throwUnauthorized();

  return guestWithEmail;
}
