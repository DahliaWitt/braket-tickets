import type {Doc, Id} from '../_generated/dataModel';
import type {DatabaseReader} from '../_generated/server';
import {collectAllQueryUnsafe} from './query_scan';
import {digestBearerToken} from './token_digests';

type QueryDb = Pick<DatabaseReader, 'query'>;

export function ticketsByGuestSessionQuery(
  db: QueryDb,
  guestSessionId: Id<'guest_sessions'>,
) {
  return db
    .query('tickets')
    .withIndex('by_guestSession', (q) =>
      q.eq('guestSessionId', guestSessionId),
    );
}

export async function loadAllTicketsByGuestSession(
  db: QueryDb,
  guestSessionId: Id<'guest_sessions'>,
): Promise<Array<Doc<'tickets'>>> {
  return await collectAllQueryUnsafe(
    ticketsByGuestSessionQuery(db, guestSessionId),
  );
}

export function ticketOrdersByGuestSessionQuery(
  db: QueryDb,
  guestSessionId: Id<'guest_sessions'>,
) {
  return db
    .query('ticket_orders')
    .withIndex('by_owner_guest_event_state', (q) =>
      q.eq('guestSessionId', guestSessionId),
    );
}

export async function loadAllTicketOrdersByGuestSession(
  db: QueryDb,
  guestSessionId: Id<'guest_sessions'>,
): Promise<Array<Doc<'ticket_orders'>>> {
  return await collectAllQueryUnsafe(
    ticketOrdersByGuestSessionQuery(db, guestSessionId),
  );
}

export function magicLinkRedemptionsByGuestSessionQuery(
  db: QueryDb,
  guestSessionId: Id<'guest_sessions'>,
) {
  return db
    .query('magic_link_redemption_log')
    .withIndex('by_guestSession', (q) =>
      q.eq('guestSessionId', guestSessionId),
    );
}

export async function loadAllMagicLinkRedemptionsByGuestSession(
  db: QueryDb,
  guestSessionId: Id<'guest_sessions'>,
): Promise<Array<Doc<'magic_link_redemption_log'>>> {
  return await collectAllQueryUnsafe(
    magicLinkRedemptionsByGuestSessionQuery(db, guestSessionId),
  );
}

export function magicLinkRedemptionsByMagicLinkQuery(
  db: QueryDb,
  linkId: Id<'magic_links'>,
) {
  return db
    .query('magic_link_redemption_log')
    .withIndex('by_magicLink', (q) => q.eq('magicLinkId', linkId));
}

export async function loadAllMagicLinkRedemptionsByMagicLink(
  db: QueryDb,
  linkId: Id<'magic_links'>,
): Promise<Array<Doc<'magic_link_redemption_log'>>> {
  return await collectAllQueryUnsafe(
    magicLinkRedemptionsByMagicLinkQuery(db, linkId),
  );
}

export async function loadAllMagicLinksByOrganizer(
  db: QueryDb,
  organizerId: Id<'organizers'>,
): Promise<Array<Doc<'magic_links'>>> {
  return await collectAllQueryUnsafe(
    db
      .query('magic_links')
      .withIndex('by_organizerId', (q) => q.eq('organizerId', organizerId)),
  );
}

export function magicLinkByTokenQuery(db: QueryDb, token: string) {
  return db
    .query('magic_links')
    .withIndex('by_token', (q) => q.eq('token', token));
}

export function magicLinkByTokenDigestQuery(db: QueryDb, tokenDigest: string) {
  return db
    .query('magic_links')
    .withIndex('by_tokenDigest', (q) => q.eq('tokenDigest', tokenDigest));
}

export async function loadFirstMagicLinkByToken(
  db: QueryDb,
  token: string,
): Promise<Doc<'magic_links'> | null> {
  const tokenDigest = await digestBearerToken('magic_link', token);
  return (
    (await magicLinkByTokenDigestQuery(db, tokenDigest).first()) ??
    (await magicLinkByTokenQuery(db, token).first())
  );
}
